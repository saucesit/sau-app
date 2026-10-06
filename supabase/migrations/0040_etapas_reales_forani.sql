-- La cadena de etapas pasa a ser la que el taller usa de verdad.
--
-- El Excel de Grupo Forani muestra el flujo real, y no es el que armamos:
--
--   Recepción · Chapa · Preparación · Pintura · Terminación · Control Calidad
--
-- Nosotros teníamos "Pre Entrega" y "Terminado" en esas dos últimas posiciones.
-- No son lo mismo: terminación es el armado y pulido después de pintar, y
-- control de calidad es la revisión antes de entregar. Son dos pasos distintos
-- del taller, no dos nombres para el mismo.
--
-- "Detenido" aparece como etapa en el Excel pero NO se convierte en etapa acá:
-- sigue siendo estado paralelo, como mecánica y ampliación. Un auto detenido
-- está detenido EN alguna etapa, y cuando se libera retoma donde estaba. Esa
-- distinción es la que hace que no se pierda el lugar en la cadena.
--
-- Remapeo de lo que ya existe, por POSICIÓN y no por nombre, para que ningún
-- vehículo avance ni retroceda:
--
--   pre_entrega (5ª) -> terminacion     (5ª)
--   terminado   (6ª) -> control_calidad (6ª)
--
-- Afecta 2 vehículos en pre_entrega y 2 en terminado; de esos, 1 y 1 son de
-- Forani y el resto de las empresas de prueba.
--
-- El orden importa: primero se sueltan los checks, después se mueven los datos,
-- y recién al final se vuelven a apretar con los valores nuevos.

-- ── 1. Soltar los checks ──────────────────────────────────────────

alter table vehiculo  drop constraint if exists vehiculo_etapa_check;
alter table membresia drop constraint if exists membresia_taller_etapas_validas;

-- ── 2. Mover los datos ────────────────────────────────────────────
-- La guardia de flujo impide tocar `etapa` fuera de las funciones del taller.
-- Acá hay que pasarla a propósito: esto no es mover un vehículo de etapa, es
-- renombrar la casilla donde ya estaba.

select set_config('taller.flujo', 'on', false);

update vehiculo set etapa = 'terminacion'      where etapa = 'pre_entrega';
update vehiculo set etapa = 'control_calidad'  where etapa = 'terminado';

select set_config('taller.flujo', '', false);

update membresia
   set taller_etapas = array_replace(taller_etapas, 'pre_entrega', 'terminacion')
 where 'pre_entrega' = any(taller_etapas);

-- Las excepciones no se tocan: un auto con 'detenido' lo conserva, y ahora el
-- Excel confirma que ese es el uso correcto.

-- ── 3. Apretar los checks con los valores nuevos ──────────────────

alter table vehiculo add constraint vehiculo_etapa_check
  check (etapa in ('recepcion','chapa','preparacion','pintura',
                   'terminacion','control_calidad','entregado'));

alter table membresia add constraint membresia_taller_etapas_validas
  check (taller_etapas <@ array['chapa','preparacion','pintura','terminacion']);

-- ── 4. La cadena ──────────────────────────────────────────────────

create or replace function public.taller_etapas()
returns text[] language sql immutable as $$
  select array['recepcion','chapa','preparacion','pintura',
               'terminacion','control_calidad','entregado']
$$;

-- Donde hay un operario que marca su trabajo. Control de calidad no está, por
-- el mismo motivo por el que no estaba "terminado": es la antesala de la
-- entrega y la valida quien coordina, no un operario marcando lo suyo.
create or replace function public.taller_etapas_con_operario()
returns text[] language sql immutable as $$
  select array['chapa','preparacion','pintura','terminacion']
$$;

-- ── 5. Las dos funciones con el nombre viejo escrito a mano ───────
--
-- Las dos salen de la versión que corre hoy en producción, cambiando ÚNICAMENTE
-- el nombre de la etapa y el texto del mensaje. Nada más.
--
-- taller_validar_avance es la importante: si no se cambia, desde
-- control_calidad avanzaría derecho a 'entregado' en vez de frenar, salteando
-- taller_entregar y dejando el vehículo entregado sin fecha de entrega.

create or replace function public.taller_entregar(p_vehiculo uuid, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text;
begin
  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'No tenés permiso para entregar el vehículo';
  end if;
  if v_etapa <> 'control_calidad' then
    raise exception 'Solo se entrega desde Control de Calidad (está en %)', v_etapa;
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

create or replace function public.taller_validar_avance(p_vehiculo uuid)
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
  if v_etapa = 'control_calidad' then
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

grant execute on function public.taller_entregar(uuid, date) to authenticated;
grant execute on function public.taller_validar_avance(uuid) to authenticated;

-- ── 6. La patente deja de ser única entre los activos ─────────────
--
-- Teníamos un índice único parcial: dos vehículos activos no podían compartir
-- patente. La idea era evitar dos fichas del mismo auto.
--
-- El Excel de Forani tiene cuatro patentes repetidas entre los activos
-- (AC287SF, AD331UC, AD673ZD, AA403JQ). En un taller eso pasa de verdad: el
-- mismo auto puede tener dos órdenes abiertas, o volver por un retrabajo antes
-- de que se cierre la anterior. Rechazarlas sería perder trabajo real.
--
-- Se reemplaza por un índice común, que sirve para buscar pero no impide
-- repetir. La contrapartida, y hay que decirla: ya nada frena cargar dos veces
-- el mismo auto por error. Eso pasa a ser un aviso de la pantalla, no una
-- garantía de la base.

drop index if exists idx_vehiculo_patente_activa;
create index if not exists idx_vehiculo_patente on vehiculo (empresa_id, patente);

comment on index idx_vehiculo_patente is
  'Búsqueda por patente. NO es único a propósito: el mismo auto puede tener dos órdenes abiertas.';
