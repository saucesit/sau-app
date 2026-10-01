-- Los tres perfiles de Grupo Forani, con el control en el servidor.
--
-- IMPACTO SOBRE CUENTAS REALES: NINGUNO. Verificado antes de escribirla.
--   * Las únicas tres empresas con módulo taller son TALLER FORANI y las dos
--     ZZ PRUEBA.
--   * La única membresía real del taller es la de Forani, y tiene
--     taller.montos y taller.validar, así que nada de lo de abajo la toca.
--   * Nadie con empresa.admin en una empresa con taller es una cuenta real.
--   * No existe ni un solo archivo orden_compania ni orden_firmada cargado.
-- Lo que sí cambia son los usuarios ZZ PRUEBA, que es donde se prueba.

-- ── 1. Eliminar deja de ir pegado a administrar ───────────────────
-- Administrador tiene que ver todo sin poder borrar nada, y hoy borrar
-- vehículos va atado a empresa.admin, el mismo permiso que abre ADMIN. Se
-- separa en un permiso propio para que los dos perfiles puedan existir.

drop policy if exists vehiculo_delete on vehiculo;
create policy vehiculo_delete on vehiculo
  for delete using (tiene_permiso_taller(empresa_id, 'taller.eliminar'));

-- Las otras vías de borrado ya estaban cerradas y se dejan así: vehiculo_monto,
-- vehiculo_evento y vehiculo_archivo tienen RLS activo y ninguna policy de
-- delete, y el bucket tampoco tiene una. Es decir: hoy NADIE borra adjuntos ni
-- bitácora, ni siquiera el perfil Completo. Es deliberado — la bitácora no
-- sirve de nada si se puede limpiar — y queda anotado por si hace falta
-- revisarlo. Lo comprueban las pruebas, no se da por sentado.

-- ── 2. La orden de la compañía es documento económico ─────────────
-- Trae el detalle de lo que paga la compañía. Alcanza con agregarla a la
-- lista: las policies de 0034 y la comprobación por nombre de archivo la
-- toman sola, así que los documentos YA cargados quedan cubiertos sin migrar
-- ni mover un solo archivo.

create or replace function taller_tipos_economicos()
returns text[] language sql immutable as $$
  select array['orden_compania', 'orden_firmada', 'recibo', 'factura']
$$;

-- ── 3. Las excepciones las pone quien valida ──────────────────────
-- Mecánica, detenido y ampliación frenan el auto: son una decisión de
-- coordinación. El operario informa por el reporte diario, que sigue abierto
-- para él. Antes alcanzaba con taller.trabajar.

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
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'Solo quien valida el avance puede frenar o liberar un vehículo';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set excepcion = p_excepcion,
         excepcion_desde = case when p_excepcion is null then null else now() end,
         updated_at = now()
   where id = p_vehiculo;

  -- Texto idéntico al que ya venía: lo único que cambia acá arriba es quién puede.
  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'excepcion', v_etapa,
          case when p_excepcion is null
               then 'Levantado ' || coalesce(v_actual,'estado') || ' — retoma en ' || v_etapa
               else 'Activado ' || p_excepcion || ' (sigue en ' || v_etapa || ')' end);
end;
$$;

grant execute on function taller_cambiar_excepcion(uuid, text) to authenticated;

-- ── 4. Editar datos del vehículo deja rastro ──────────────────────
-- Cliente, teléfono, paños, días de chapa y fecha pactada se corrigen seguido
-- —un teléfono mal anotado, un plazo que se renegocia— y hasta ahora el cambio
-- no quedaba en ningún lado. Quién puede editar no cambia: lo sigue decidiendo
-- la policy vehiculo_update, que exige taller.cargar y que el operario no tiene.

alter table vehiculo_evento drop constraint if exists vehiculo_evento_tipo_check;
alter table vehiculo_evento add constraint vehiculo_evento_tipo_check
  check (tipo in ('ingreso', 'nota', 'trabajo_hecho', 'avance',
                  'excepcion', 'cobro', 'entrega', 'facturacion', 'edicion'));

create or replace function taller_registrar_edicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cambios text[] := '{}';
  v_texto   text;
begin
  if new.cliente_nombre is distinct from old.cliente_nombre then
    v_cambios := v_cambios || ('cliente: ' || coalesce(old.cliente_nombre,'—') ||
                               ' → ' || coalesce(new.cliente_nombre,'—'));
  end if;
  if new.telefono is distinct from old.telefono then
    v_cambios := v_cambios || ('teléfono: ' || coalesce(old.telefono,'—') ||
                               ' → ' || coalesce(new.telefono,'—'));
  end if;
  if new.panos is distinct from old.panos then
    v_cambios := v_cambios || ('paños: ' || coalesce(old.panos::text,'—') ||
                               ' → ' || coalesce(new.panos::text,'—'));
  end if;
  if new.dias_chapa is distinct from old.dias_chapa then
    v_cambios := v_cambios || ('días de chapa: ' || coalesce(old.dias_chapa::text,'—') ||
                               ' → ' || coalesce(new.dias_chapa::text,'—'));
  end if;
  if new.fecha_pactada is distinct from old.fecha_pactada then
    v_cambios := v_cambios || ('fecha pactada: ' || coalesce(old.fecha_pactada::text,'—') ||
                               ' → ' || coalesce(new.fecha_pactada::text,'—'));
  end if;

  if array_length(v_cambios, 1) > 0 then
    v_texto := array_to_string(v_cambios, ' · ');
    insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
    values (new.id, 'edicion', new.etapa, v_texto);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taller_registrar_edicion on vehiculo;
create trigger trg_taller_registrar_edicion
  after update on vehiculo
  for each row execute function taller_registrar_edicion();
