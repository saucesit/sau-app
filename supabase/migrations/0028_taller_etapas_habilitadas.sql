-- Etapas habilitadas por operario, y cierre del modo permisivo.
--
-- Cambia dos cosas respecto de 0027:
--
--   1. La especialidad pasa de ser una sola etapa a una lista. En la práctica
--      mucha gente del taller hace dos cosas (chapa y preparación, por ejemplo).
--   2. Se termina el "sin especialidad puede cualquier etapa". Quien tiene
--      taller.trabajar y no tiene etapas cargadas ya no puede marcar nada: el
--      permiso deja de alcanzar por sí solo y hay que configurar el oficio.
--
-- Ojo con el orden de puesta en producción: al aplicar esto, cualquiera con
-- taller.trabajar y la lista vacía queda bloqueado para marcar trabajo hasta
-- que el encargado le cargue sus etapas.

alter table membresia
  add column if not exists taller_etapas text[] not null default '{}';

-- Arrastra lo cargado con el modelo anterior, si esa columna todavía existe.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'membresia'
      and column_name = 'taller_especialidad'
  ) then
    execute $q$
      update membresia
         set taller_etapas = array[taller_especialidad]
       where taller_especialidad is not null
         and coalesce(array_length(taller_etapas, 1), 0) = 0
    $q$;
    execute 'alter table membresia drop column taller_especialidad';
  end if;
end $$;

alter table membresia drop constraint if exists membresia_taller_etapas_validas;
alter table membresia add constraint membresia_taller_etapas_validas
  check (taller_etapas <@ array['chapa','preparacion','pintura','pre_entrega']);

comment on column membresia.taller_etapas is
  'Etapas del taller en las que esta persona puede marcar trabajo realizado. Vacío = no puede marcar ninguna.';

-- ── Marcado de trabajo ────────────────────────────────────────────
create or replace function taller_marcar_trabajo_hecho(p_vehiculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_etapas   text[];
  v_miembro  boolean;
begin
  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.trabajar') then
    raise exception 'No tenés permiso para marcar trabajo realizado';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;
  if not (v_etapa = any (taller_etapas_con_operario())) then
    raise exception 'En % no hay trabajo de operario para marcar', v_etapa;
  end if;

  select true, coalesce(m.taller_etapas, '{}')
    into v_miembro, v_etapas
    from membresia m
   where m.usuario_id = auth.uid() and m.empresa_id = v_empresa and m.activa
   limit 1;

  -- Personal de SAU dando soporte: no tiene membresía en la empresa del cliente.
  if v_miembro is null then
    if not es_contadora_o_admin() then
      raise exception 'No pertenecés a esta empresa';
    end if;
  else
    if coalesce(array_length(v_etapas, 1), 0) = 0 then
      raise exception 'Todavía no tenés etapas habilitadas. Pedile al encargado que configure tu oficio en el taller';
    end if;
    if not (v_etapa = any (v_etapas)) then
      raise exception 'No estás habilitado para marcar trabajo en %', v_etapa;
    end if;
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo set trabajo_hecho = true, updated_at = now() where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado');
end;
$$;

grant execute on function taller_marcar_trabajo_hecho(uuid) to authenticated;

-- ── Los cobros solo se tocan desde taller_registrar_cobro ─────────
-- Si se pudieran cambiar por API directa, quedarían montos saldados sin ningún
-- registro en la bitácora de quién los dio por cobrados.
create or replace function taller_guardia_cobro()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('taller.flujo', true), '') <> 'on' then
    if new.cobro_compania   is distinct from old.cobro_compania
    or new.cobro_franquicia is distinct from old.cobro_franquicia
    or new.cobro_particular is distinct from old.cobro_particular
    then
      raise exception 'Las validaciones de cobro se registran con taller_registrar_cobro, para que quede el movimiento en la bitácora';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taller_guardia_cobro on vehiculo_monto;
create trigger trg_taller_guardia_cobro
  before update on vehiculo_monto
  for each row execute function taller_guardia_cobro();

-- La función de cobro levanta la bandera antes de escribir.
create or replace function taller_registrar_cobro(p_vehiculo uuid, p_campo text, p_valor boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text; v_label text;
begin
  if p_campo not in ('cobro_compania','cobro_franquicia','cobro_particular') then
    raise exception 'Campo de cobro inválido: %', p_campo;
  end if;

  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.montos') then
    raise exception 'No tenés permiso para registrar cobros';
  end if;

  perform set_config('taller.flujo', 'on', true);
  execute format('update vehiculo_monto set %I = $1 where vehiculo_id = $2', p_campo)
    using p_valor, p_vehiculo;

  v_label := case p_campo
    when 'cobro_compania'   then 'Orden de compañía facturada'
    when 'cobro_franquicia' then 'Franquicia cobrada'
    else 'Reparación particular pagada' end;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'cobro', v_etapa,
          v_label || ': ' || case when p_valor then 'validado' else 'desmarcado' end);
end;
$$;

grant execute on function taller_registrar_cobro(uuid, text, bool) to authenticated;
