-- Volver una etapa atrás, y reabrir un vehículo entregado.
--
-- "¿Se pueden volver los estados?", preguntó Tefo. Pasa por dos motivos
-- distintos y los dos son reales: se apretó avanzar de más, o hay que rehacer
-- un trabajo que ya se había dado por terminado.
--
-- Hasta hoy no había forma: taller_validar_avance solo suma uno en la cadena y
-- taller_guardia_flujo rechaza cualquier UPDATE directo de la etapa.
--
-- Son dos operaciones separadas a propósito:
--
--   taller_retroceder_etapa   una etapa para atrás, entre etapas activas.
--                             Lo hace quien valida el avance: es quien avanza
--                             y por lo tanto quien se equivoca.
--
--   taller_reabrir_vehiculo   sacar un auto del archivo y devolverlo al taller.
--                             Reservado a empresa.admin: reabre un trabajo
--                             cerrado, borra la fecha de entrega y devuelve sus
--                             importes pendientes a los totales del tablero.
--
-- Las dos exigen motivo. Si alguien desarma el flujo, queda escrito por qué.
--
-- Lo que NUNCA se toca: el movimiento de avance anterior —la bitácora es
-- append-only y el retroceso suma su propia línea—, ni la facturación, ni los
-- cobros, ni los importes, ni los adjuntos.

-- ── 1. Dos tipos de movimiento propios ────────────────────────────
-- Separados de 'avance' para poder auditarlos aparte: "cuántas veces volvimos
-- atrás este mes" es una pregunta que se va a hacer.

alter table vehiculo_evento drop constraint if exists vehiculo_evento_tipo_check;
alter table vehiculo_evento add constraint vehiculo_evento_tipo_check
  check (tipo in ('ingreso', 'nota', 'trabajo_hecho', 'avance', 'excepcion',
                  'cobro', 'entrega', 'facturacion', 'edicion', 'anulacion',
                  'monto', 'retroceso', 'reapertura'));

-- ── 2. Retroceder una etapa ───────────────────────────────────────

create or replace function taller_retroceder_etapa(
  p_vehiculo uuid,
  p_motivo   text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_etapas   text[] := taller_etapas();
  v_idx      int;
  v_anterior text;
  v_motivo   text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then
    raise exception 'Decí por qué volvés el vehículo de etapa: queda registrado en el reporte diario';
  end if;

  select empresa_id, etapa into v_empresa, v_etapa
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;

  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'Solo quien valida el avance puede volver un vehículo de etapa';
  end if;

  -- Un entregado no retrocede: se reabre, que es otra operación y otra llave.
  if v_etapa = 'entregado' then
    raise exception 'Este vehículo ya fue entregado. Para devolverlo al taller usá la reapertura';
  end if;

  v_idx := array_position(v_etapas, v_etapa);
  if v_idx is null or v_idx = 1 then
    raise exception 'El vehículo ya está en la primera etapa (%)', v_etapa;
  end if;
  v_anterior := v_etapas[v_idx - 1];

  -- El trabajo marcado se refería a la etapa que se deja: si no se limpia, el
  -- auto podría volver a avanzar sin que nadie trabaje.
  -- La excepción se conserva: "Detenido" es del auto, no de la etapa.
  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set etapa = v_anterior,
         etapa_desde = now(),
         trabajo_hecho = false,
         updated_at = now()
   where id = p_vehiculo;
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'retroceso', v_anterior,
          'Volvió de ' || v_etapa || ' a ' || v_anterior || ' — ' || v_motivo);

  return v_anterior;
end;
$$;

comment on function taller_retroceder_etapa(uuid, text) is
  'Devuelve el vehículo una etapa atrás. Exige taller.validar y motivo. No toca facturación, cobros, importes ni adjuntos.';

grant execute on function taller_retroceder_etapa(uuid, text) to authenticated;

-- ── 3. Reabrir un vehículo entregado ──────────────────────────────
-- Vuelve a Control de Calidad, que es de donde salió, y se le borra la fecha
-- de entrega: si quedara, diasEnTaller seguiría congelado en el día que se
-- entregó y el auto figuraría en la pizarra con los días de entonces.

create or replace function taller_reabrir_vehiculo(
  p_vehiculo uuid,
  p_motivo   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_patente  text;
  v_adicional boolean;
  v_otra     record;
  v_motivo   text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then
    raise exception 'Decí por qué volvés este vehículo al taller: queda registrado en el reporte diario';
  end if;

  select empresa_id, etapa, patente, orden_adicional
    into v_empresa, v_etapa, v_patente, v_adicional
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;

  -- Reabrir no es corregir un clic: devuelve a la pizarra un trabajo cerrado y
  -- sus importes pendientes vuelven a los totales. Va con empresa.admin.
  if not tiene_permiso_taller(v_empresa, 'empresa.admin') then
    raise exception 'Reabrir un vehículo entregado lo hace quien administra el taller';
  end if;

  if v_etapa <> 'entregado' then
    raise exception 'Este vehículo no está entregado (está en %)', v_etapa;
  end if;

  -- La guardia de duplicados dejaría pasar esto si el vehículo tiene la marca
  -- de orden adicional, así que acá se mira siempre: reabrir nunca puede
  -- terminar en dos órdenes activas de la misma patente.
  select v.patente, v.fecha_ingreso, v.etapa into v_otra
    from vehiculo v
   where v.empresa_id = v_empresa
     and v.patente = v_patente
     and v.etapa <> 'entregado'
     and v.id <> p_vehiculo
   order by v.fecha_ingreso desc
   limit 1;

  if found then
    raise exception 'No se puede reabrir: % ya tiene una orden activa (ingresó el %, está en %). Cerrá o resolvé esa antes.',
      v_patente, to_char(v_otra.fecha_ingreso, 'DD/MM/YYYY'), v_otra.etapa;
  end if;

  -- Facturación, cobros, importes y adjuntos quedan exactamente como estaban.
  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set etapa = 'control_calidad',
         etapa_desde = now(),
         fecha_entrega = null,
         trabajo_hecho = false,
         updated_at = now()
   where id = p_vehiculo;
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'reapertura', 'control_calidad',
          'Reabierto: vuelve al taller en Control de Calidad — ' || v_motivo);
end;
$$;

comment on function taller_reabrir_vehiculo(uuid, text) is
  'Saca un vehículo del archivo y lo devuelve a Control de Calidad. Exige empresa.admin y motivo. Rechaza si la patente ya tiene otra orden activa.';

grant execute on function taller_reabrir_vehiculo(uuid, text) to authenticated;

-- Control: las dos funciones vivas y los tipos nuevos aceptados.
select json_build_object(
  'retroceder', (select count(*) from pg_proc where proname = 'taller_retroceder_etapa'),
  'reabrir',    (select count(*) from pg_proc where proname = 'taller_reabrir_vehiculo'),
  'tipos_de_evento', (select pg_get_constraintdef(oid) like '%retroceso%'
     and pg_get_constraintdef(oid) like '%reapertura%'
     from pg_constraint where conname = 'vehiculo_evento_tipo_check')
) as resultado;
