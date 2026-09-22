-- Guarda contra el doble marcado.
--
-- Sin esto, dos operarios habilitados para la misma etapa (o el mismo tocando
-- dos veces por nervios o mala señal) generaban varios eventos 'trabajo_hecho'
-- para una sola tanda de trabajo, y la bitácora dejaba de reflejar lo que pasó.
--
-- La fila ya se toma con FOR UPDATE, así que el chequeo también cubre el caso
-- de dos llamadas simultáneas: la segunda espera y encuentra el valor ya en true.

create or replace function taller_marcar_trabajo_hecho(p_vehiculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_hecho    boolean;
  v_etapas   text[];
  v_miembro  boolean;
begin
  select empresa_id, etapa, trabajo_hecho
    into v_empresa, v_etapa, v_hecho
    from vehiculo where id = p_vehiculo for update;

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

  -- Break-glass: el personal de SAU no tiene membresía en la empresa del cliente.
  -- Ver el comentario en tiene_permiso_taller y la sección de soporte del handoff.
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

  -- Después de resolver el permiso: el estado no se le cuenta a quien no puede verlo.
  if v_hecho then
    raise exception 'Este trabajo ya fue marcado como realizado';
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo set trabajo_hecho = true, updated_at = now() where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado');
end;
$$;

grant execute on function taller_marcar_trabajo_hecho(uuid) to authenticated;
