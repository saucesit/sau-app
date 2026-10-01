-- Anular un adjunto deja de depender de taller.eliminar.
--
-- Al reservar taller.eliminar a SAU (0038), el perfil Completo perdió también
-- la anulación de adjuntos, que estaba colgada del mismo permiso en 0036. Eso
-- contradice lo acordado: Completo sí tiene que poder anular un papel cargado
-- por error.
--
-- Son dos cosas distintas y ahora tienen permisos distintos:
--
--   taller.eliminar  borra el vehículo y se lleva su historial completo.
--                    Irreversible. Reservado a SAU.
--   taller.anular    marca un adjunto como anulado con motivo y responsable.
--                    No borra nada: el archivo, la fila y la bitácora quedan.
--                    Lo tiene Completo.
--
-- taller.anular también lo asigna SAU, porque va con el perfil Completo y
-- Completo lo asigna SAU. Un cliente no puede dárselo a su Administrador.

create or replace function public.sau_permisos_reservados()
returns text[] language sql immutable as $$
  select array['empresa.admin', 'empresa.rrhh', 'taller.eliminar', 'taller.anular']
$$;

create or replace function public.taller_anular_archivo(p_archivo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_empresa  uuid;
  v_vehiculo uuid;
  v_etapa    text;
  v_tipo     text;
  v_nombre   text;
  v_anulado  timestamptz;
begin
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Hace falta decir por qué se anula';
  end if;

  select a.vehiculo_id, a.tipo, a.nombre, a.anulado_en, v.empresa_id, v.etapa
    into v_vehiculo, v_tipo, v_nombre, v_anulado, v_empresa, v_etapa
    from public.vehiculo_archivo a join public.vehiculo v on v.id = a.vehiculo_id
   where a.id = p_archivo
   for update of a;

  if v_empresa is null then raise exception 'El adjunto no existe'; end if;
  if not public.tiene_permiso_taller(v_empresa, 'taller.anular') then
    raise exception 'No tenés permiso para anular adjuntos';
  end if;
  if v_anulado is not null then
    raise exception 'Este adjunto ya estaba anulado';
  end if;

  perform set_config('taller.flujo', 'on', true);
  update public.vehiculo_archivo
     set anulado_en = now(), anulado_por = auth.uid(), anulado_motivo = trim(p_motivo)
   where id = p_archivo;
  perform set_config('taller.flujo', '', true);

  insert into public.vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (v_vehiculo, 'anulacion', v_etapa,
          'Anulado ' || coalesce(v_nombre, v_tipo) || ' (' || v_tipo || '): ' || trim(p_motivo));
end;
$$;

grant execute on function public.taller_anular_archivo(uuid, text) to authenticated;
