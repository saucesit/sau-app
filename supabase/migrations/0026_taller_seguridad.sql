-- Endurecimiento del módulo taller, previo a cargar vehículos reales.
--
-- Problema que resuelve: hasta acá el avance de etapa, las excepciones y la
-- entrega se hacían con UPDATE directo desde el navegador. Cualquiera con
-- permiso de escritura podía saltear etapas, entregar sin pasar por terminado
-- o marcar trabajo ajeno, llamando a la API sin pasar por la interfaz.
--
-- A partir de ahora el flujo se mueve SOLO por funciones del servidor, que
-- validan permiso, etapa actual y transición. Las columnas de flujo quedan
-- bloqueadas para el UPDATE directo mediante un trigger guardián.

-- ── Catálogo de etapas, en un solo lugar ──────────────────────────
create or replace function taller_etapas()
returns text[] language sql immutable as $$
  select array['recepcion','chapa','preparacion','pintura','pre_entrega','terminado','entregado']
$$;

-- Etapas donde efectivamente trabaja un operario. Recepción es administrativa y
-- Terminado es la antesala de la entrega: en esas dos no se exige trabajo_hecho.
create or replace function taller_etapas_con_operario()
returns text[] language sql immutable as $$
  select array['chapa','preparacion','pintura','pre_entrega']
$$;

-- ── Guardián de las columnas de flujo ─────────────────────────────
-- Deja editar los datos del vehículo (cliente, patente, fechas pactadas, etc.)
-- pero impide tocar el flujo salvo desde las funciones de abajo, que levantan
-- la bandera de sesión antes de escribir.
create or replace function taller_guardia_flujo()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('taller.flujo', true), '') <> 'on' then
    if new.etapa           is distinct from old.etapa
    or new.etapa_desde     is distinct from old.etapa_desde
    or new.trabajo_hecho   is distinct from old.trabajo_hecho
    or new.excepcion       is distinct from old.excepcion
    or new.excepcion_desde is distinct from old.excepcion_desde
    or new.fecha_entrega   is distinct from old.fecha_entrega
    or new.empresa_id      is distinct from old.empresa_id
    then
      raise exception 'El flujo del vehículo solo se modifica con las funciones del taller';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taller_guardia_flujo on vehiculo;
create trigger trg_taller_guardia_flujo
  before update on vehiculo
  for each row execute function taller_guardia_flujo();

-- ── Alta del vehículo: montos en cero y evento de ingreso ─────────
-- Aunque el vehículo lo cargue un coordinador (que no tiene taller.montos),
-- la fila de montos se crea igual, en cero, y con la empresa del vehículo.
-- El evento de ingreso también lo escribe el servidor: desde el navegador solo
-- se pueden insertar notas.
create or replace function taller_alta_vehiculo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into vehiculo_monto (vehiculo_id, empresa_id)
  values (new.id, new.empresa_id)
  on conflict (vehiculo_id) do nothing;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (new.id, 'ingreso', new.etapa, 'Vehículo ingresado al taller');

  return new;
end;
$$;

drop trigger if exists trg_taller_crear_monto  on vehiculo;
drop trigger if exists trg_taller_alta_vehiculo on vehiculo;
create trigger trg_taller_alta_vehiculo
  after insert on vehiculo
  for each row execute function taller_alta_vehiculo();

-- La empresa del monto nunca la elige el cliente: se copia del vehículo.
create or replace function taller_monto_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select v.empresa_id into new.empresa_id from vehiculo v where v.id = new.vehiculo_id;
  if new.empresa_id is null then
    raise exception 'El vehículo no existe';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_taller_monto_empresa on vehiculo_monto;
create trigger trg_taller_monto_empresa
  before insert or update on vehiculo_monto
  for each row execute function taller_monto_empresa();

-- ── Bitácora: el autor lo pone el servidor, nunca el navegador ────
create or replace function taller_evento_autor()
returns trigger language plpgsql as $$
begin
  new.autor_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_taller_evento_autor on vehiculo_evento;
create trigger trg_taller_evento_autor
  before insert on vehiculo_evento
  for each row execute function taller_evento_autor();

-- Mismo criterio para quién subió cada archivo.
drop trigger if exists trg_taller_archivo_autor on vehiculo_archivo;
create trigger trg_taller_archivo_autor
  before insert on vehiculo_archivo
  for each row execute function taller_evento_autor();

-- ── Funciones de flujo ────────────────────────────────────────────

-- El operario marca lo suyo. No mueve el vehículo.
create or replace function taller_marcar_trabajo_hecho(p_vehiculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text;
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

  perform set_config('taller.flujo', 'on', true);
  update vehiculo set trabajo_hecho = true, updated_at = now() where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado');
end;
$$;

-- La validación mueve el vehículo una sola etapa, y nunca hacia atrás ni salteando.
create or replace function taller_validar_avance(p_vehiculo uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid; v_etapa text; v_hecho boolean;
  v_etapas text[] := taller_etapas();
  v_idx int; v_siguiente text;
begin
  select empresa_id, etapa, trabajo_hecho
    into v_empresa, v_etapa, v_hecho
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'No tenés permiso para validar el avance';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;
  if v_etapa = 'terminado' then
    raise exception 'Para pasar a Entregado usá la función de entrega';
  end if;
  if v_etapa = any (taller_etapas_con_operario()) and not v_hecho then
    raise exception 'Falta que el operario marque el trabajo de % como realizado', v_etapa;
  end if;

  v_idx := array_position(v_etapas, v_etapa);
  v_siguiente := v_etapas[v_idx + 1];

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set etapa = v_siguiente, etapa_desde = now(), trabajo_hecho = false, updated_at = now()
   where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'avance', v_siguiente, v_etapa || ' validada — pasa a ' || v_siguiente);

  return v_siguiente;
end;
$$;

-- Excepción: etiqueta encima de la etapa. Nunca cambia la etapa.
create or replace function taller_cambiar_excepcion(p_vehiculo uuid, p_excepcion text)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text; v_actual text;
begin
  if p_excepcion is not null and p_excepcion not in ('mecanica','detenido','ampliacion') then
    raise exception 'Excepción inválida: %', p_excepcion;
  end if;

  select empresa_id, etapa, excepcion into v_empresa, v_etapa, v_actual
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not (tiene_permiso_taller(v_empresa, 'taller.validar')
       or tiene_permiso_taller(v_empresa, 'taller.trabajar')) then
    raise exception 'No tenés permiso para cambiar el estado del vehículo';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set excepcion = p_excepcion,
         excepcion_desde = case when p_excepcion is null then null else now() end,
         updated_at = now()
   where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'excepcion', v_etapa,
          case when p_excepcion is null
               then 'Levantado ' || coalesce(v_actual,'estado') || ' — retoma en ' || v_etapa
               else 'Activado ' || p_excepcion || ' (sigue en ' || v_etapa || ')' end);
end;
$$;

-- Entrega: solo desde terminado, y solo quien valida.
create or replace function taller_entregar(p_vehiculo uuid, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text;
begin
  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'No tenés permiso para entregar el vehículo';
  end if;
  if v_etapa <> 'terminado' then
    raise exception 'Solo se entrega desde Trabajo Terminado (está en %)', v_etapa;
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set etapa = 'entregado', etapa_desde = now(),
         fecha_entrega = coalesce(p_fecha, current_date), updated_at = now()
   where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'entrega', 'entregado', 'Vehículo entregado al cliente');
end;
$$;

-- Cobro: el evento lo escribe el servidor, no el navegador.
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

grant execute on function taller_marcar_trabajo_hecho(uuid)        to authenticated;
grant execute on function taller_validar_avance(uuid)              to authenticated;
grant execute on function taller_cambiar_excepcion(uuid, text)     to authenticated;
grant execute on function taller_entregar(uuid, date)              to authenticated;
grant execute on function taller_registrar_cobro(uuid, text, bool) to authenticated;

-- ── Policies ──────────────────────────────────────────────────────

-- UPDATE directo: solo para corregir datos del vehículo. El trigger guardián
-- impide que por esta vía se toque el flujo.
drop policy if exists vehiculo_update on vehiculo;
create policy vehiculo_update on vehiculo
  for update using (tiene_permiso_taller(empresa_id, 'taller.cargar'))
  with check (tiene_permiso_taller(empresa_id, 'taller.cargar'));

-- Desde el navegador solo se pueden agregar notas: el resto de los tipos de
-- evento los escriben las funciones de arriba.
drop policy if exists vehiculo_evento_insert on vehiculo_evento;
create policy vehiculo_evento_insert on vehiculo_evento
  for insert with check (
    tipo = 'nota'
    and vehiculo_id in (select id from vehiculo where tiene_permiso_taller(empresa_id, 'taller.ver'))
  );

-- ── Storage: aislamiento por empresa ──────────────────────────────
-- La ruta es {empresa_id}/{vehiculo_id}/archivo, así que el primer segmento
-- tiene que ser una empresa del usuario. Antes alcanzaba con estar logueado:
-- cualquiera de otra empresa que conociera una ruta podía pedir la URL firmada.
drop policy if exists taller_archivos_leer  on storage.objects;
drop policy if exists taller_archivos_subir on storage.objects;

create policy taller_archivos_leer on storage.objects
  for select using (
    bucket_id = 'taller'
    and exists (
      select 1 from empresa e
      where e.id::text = (storage.foldername(name))[1]
        and tiene_permiso_taller(e.id, 'taller.ver')
    )
  );

create policy taller_archivos_subir on storage.objects
  for insert with check (
    bucket_id = 'taller'
    and exists (
      select 1 from empresa e
      where e.id::text = (storage.foldername(name))[1]
        and tiene_permiso_taller(e.id, 'taller.cargar')
    )
  );
