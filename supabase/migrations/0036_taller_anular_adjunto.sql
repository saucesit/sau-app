-- Anular un adjunto cargado por error.
--
-- IMPACTO SOBRE ACCESOS EXISTENTES: NINGUNO. No cambia ninguna policy ni
-- ningún permiso de los que ya estaban: agrega columnas y una función nueva,
-- reservada a quien tenga taller.eliminar, que hoy no tiene ninguna cuenta real.
--
-- Anular NO es borrar. El archivo sigue en el bucket, la fila sigue en la
-- tabla y el movimiento queda en la bitácora. Lo único que cambia es que deja
-- de contar como documento válido de la ficha, con el motivo escrito, quién lo
-- anuló y cuándo. Nada se borra: ni el adjunto, ni la bitácora.

alter table vehiculo_archivo
  add column if not exists anulado_en    timestamptz,
  add column if not exists anulado_por   uuid references auth.users(id) on delete set null,
  add column if not exists anulado_motivo text;

comment on column vehiculo_archivo.anulado_en is
  'Si está cargada, el adjunto se anuló. El archivo y la fila se conservan igual.';

-- La bitácora necesita poder registrarlo.
alter table vehiculo_evento drop constraint if exists vehiculo_evento_tipo_check;
alter table vehiculo_evento add constraint vehiculo_evento_tipo_check
  check (tipo in ('ingreso', 'nota', 'trabajo_hecho', 'avance', 'excepcion',
                  'cobro', 'entrega', 'facturacion', 'edicion', 'anulacion'));

-- Que no se pueda anular por API directa: si se pudiera, quedarían documentos
-- anulados sin motivo y sin saber quién fue. Mismo criterio que los cobros.
create or replace function taller_guardia_anulacion()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('taller.flujo', true), '') <> 'on' then
    if new.anulado_en     is distinct from old.anulado_en
    or new.anulado_por    is distinct from old.anulado_por
    or new.anulado_motivo is distinct from old.anulado_motivo
    then
      raise exception 'Los adjuntos se anulan con taller_anular_archivo, para que quede el motivo y el responsable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taller_guardia_anulacion on vehiculo_archivo;
create trigger trg_taller_guardia_anulacion
  before update on vehiculo_archivo
  for each row execute function taller_guardia_anulacion();

-- ── Anular ────────────────────────────────────────────────────────
-- Reservado a quien puede eliminar, que es el perfil Completo. Administrador
-- y Operario no, a propósito.

create or replace function taller_anular_archivo(p_archivo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_vehiculo uuid;
  v_etapa   text;
  v_tipo    text;
  v_nombre  text;
  v_anulado timestamptz;
begin
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Hace falta decir por qué se anula';
  end if;

  select a.vehiculo_id, a.tipo, a.nombre, a.anulado_en, v.empresa_id, v.etapa
    into v_vehiculo, v_tipo, v_nombre, v_anulado, v_empresa, v_etapa
    from vehiculo_archivo a join vehiculo v on v.id = a.vehiculo_id
   where a.id = p_archivo
   for update of a;

  if v_empresa is null then raise exception 'El adjunto no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.eliminar') then
    raise exception 'No tenés permiso para anular adjuntos';
  end if;
  if v_anulado is not null then
    raise exception 'Este adjunto ya estaba anulado';
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo_archivo
     set anulado_en = now(), anulado_por = auth.uid(), anulado_motivo = trim(p_motivo)
   where id = p_archivo;
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (v_vehiculo, 'anulacion', v_etapa,
          'Anulado ' || coalesce(v_nombre, v_tipo) || ' (' || v_tipo || '): ' || trim(p_motivo));
end;
$$;

grant execute on function taller_anular_archivo(uuid, text) to authenticated;
