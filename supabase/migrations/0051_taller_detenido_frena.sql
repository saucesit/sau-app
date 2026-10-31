-- Un vehículo Detenido no avanza, y eso ahora lo hace cumplir la base.
--
-- La pantalla ya escondía "Validar y avanzar" cuando el auto tenía una
-- excepción activa, y el cartel dice textualmente que mientras esté puesta el
-- auto sigue donde está. Pero el servidor nunca lo miraba: una llamada directa
-- a taller_validar_avance pasaba por encima del Detenido sin decir nada. Es el
-- mismo tipo de hueco que cerramos con la fecha de ingreso de un entregado —
-- una garantía que el producto promete y que vivía solo en el navegador.
--
-- SOLO Detenido. Las otras dos excepciones NO se tocan en esta migración:
--
--   * `detenido` es, por definición, el auto frenado. Que pudiera avanzar es
--     una contradicción con su propio nombre.
--   * `mecanica` es el auto que salió a otro taller. Que no pueda avanzar
--     parece razonable, pero no está escrito en ningún lado y bloquearlo puede
--     trabar un caso real: el chapista termina su parte mientras el auto está
--     con el mecánico.
--   * `ampliacion` es la espera de que la compañía autorice trabajo extra. En
--     Forani se usa como una marca corta —se pone y se levanta el mismo día—
--     y es la más frecuente de las tres: 8 de 16 movimientos.
--
-- Para esas dos la interfaz sigue como está: esconde el botón. Lo que no hay
-- es una regla de servidor, porque todavía no está decidido que deban tenerla.
--
-- Qué NO bloquea, también a propósito:
--   * Retroceder: un auto detenido tiene que poder volver una etapa si se
--     cargó mal. Trabarlo lo dejaría encerrado hasta que alguien lo libere.
--   * Marcar trabajo: no mueve al vehículo de etapa.
--   * Adjuntar, facturar, cobrar, editar: nada de eso es avanzar.

create or replace function public.taller_validar_avance(p_vehiculo uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid; v_etapa text; v_hecho boolean; v_excepcion text;
  v_etapas text[] := taller_etapas();
  v_idx int; v_siguiente text;
begin
  select empresa_id, etapa, trabajo_hecho, excepcion
    into v_empresa, v_etapa, v_hecho, v_excepcion
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'No tenés permiso para validar el avance';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;
  if v_etapa = 'control_calidad' then
    raise exception 'Para pasar a Entregado usá la función de entrega';
  end if;
  if v_excepcion = 'detenido' then
    raise exception 'El vehículo está detenido: levantá el estado antes de avanzarlo';
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

-- Entregar es el último avance de la cadena, así que vale la misma regla: un
-- auto detenido no sale del taller sin que alguien levante el estado primero.
create or replace function public.taller_entregar(p_vehiculo uuid, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text; v_excepcion text;
begin
  select empresa_id, etapa, excepcion into v_empresa, v_etapa, v_excepcion
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'No tenés permiso para entregar el vehículo';
  end if;
  if v_etapa <> 'control_calidad' then
    raise exception 'Solo se entrega desde Control de Calidad (está en %)', v_etapa;
  end if;
  if v_excepcion = 'detenido' then
    raise exception 'El vehículo está detenido: levantá el estado antes de entregarlo';
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

grant execute on function public.taller_validar_avance(uuid)     to authenticated;
grant execute on function public.taller_entregar(uuid, date)     to authenticated;
