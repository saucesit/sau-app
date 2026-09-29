-- Facturación por rubro y trabajo asignado al ingreso.
--
-- NO APLICADA TODAVÍA. Queda en la rama hasta que se pruebe en una base
-- separada. Es aditiva: columnas nuevas con default y una función nueva.
--
-- Dos cosas distintas que llegaron juntas en las definiciones de Tefo:
--
-- 1. Trabajo asignado. Paños y días de chapa se cargan al ingresar el vehículo
--    y describen el trabajo que hay que hacer. No se recalculan solos ni tienen
--    nada que ver con fecha_pactada, que sigue siendo el compromiso de entrega
--    y la que dispara "fuera de plazo". Paños ya existía desde 0025; acá solo
--    se suma días de chapa.
--
-- 2. Facturación. Es un concepto propio, separado del cobro. Cada rubro
--    —compañía, franquicia y particular— tiene su estado: pendiente, facturado
--    o no aplica, con su número de factura. Se puede facturar antes de entregar
--    el auto.
--
--    Los tildes de cobro de 0026 quedan exactamente como están y no se tocan
--    entre sí: marcar facturado no marca cobrado, y marcar cobrado no marca
--    facturado. Es una decisión tomada a propósito para esta prueba.

-- ── 1. Trabajo asignado ───────────────────────────────────────────

alter table vehiculo
  add column if not exists dias_chapa int;

comment on column vehiculo.dias_chapa is
  'Días de chapa asignados al trabajo, cargados al ingreso. Dato de planificación: no se recalcula con el tiempo transcurrido ni reemplaza a fecha_pactada.';

comment on column vehiculo.panos is
  'Paños asignados al trabajo, cargados al ingreso. Mismo criterio que dias_chapa.';

-- ── 2. Estado de facturación por rubro ────────────────────────────

alter table vehiculo_monto
  add column if not exists estado_compania    text not null default 'pendiente',
  add column if not exists estado_franquicia  text not null default 'pendiente',
  add column if not exists estado_particular  text not null default 'pendiente',
  add column if not exists factura_compania   text,
  add column if not exists factura_franquicia text,
  add column if not exists factura_particular text;

alter table vehiculo_monto drop constraint if exists vehiculo_monto_estados_facturacion;
alter table vehiculo_monto add constraint vehiculo_monto_estados_facturacion
  check (estado_compania   in ('pendiente', 'facturado', 'no_aplica')
     and estado_franquicia in ('pendiente', 'facturado', 'no_aplica')
     and estado_particular in ('pendiente', 'facturado', 'no_aplica'));

comment on column vehiculo_monto.estado_compania is
  'pendiente | facturado | no_aplica. Solo lo pendiente suma en los totales del tablero.';

-- La bitácora necesita poder registrar el movimiento de facturación.
alter table vehiculo_evento drop constraint if exists vehiculo_evento_tipo_check;
alter table vehiculo_evento add constraint vehiculo_evento_tipo_check
  check (tipo in ('ingreso', 'nota', 'trabajo_hecho', 'avance',
                  'excepcion', 'cobro', 'entrega', 'facturacion'));

-- ── 3. La guardia también cubre la facturación ────────────────────
-- Mismo motivo que con los cobros: si se pudieran cambiar por API directa,
-- quedarían vehículos facturados sin ningún registro de quién lo marcó.

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

    if new.estado_compania    is distinct from old.estado_compania
    or new.estado_franquicia  is distinct from old.estado_franquicia
    or new.estado_particular  is distinct from old.estado_particular
    or new.factura_compania   is distinct from old.factura_compania
    or new.factura_franquicia is distinct from old.factura_franquicia
    or new.factura_particular is distinct from old.factura_particular
    then
      raise exception 'La facturación se registra con taller_registrar_facturacion, para que quede el movimiento en la bitácora';
    end if;
  end if;
  return new;
end;
$$;

-- ── 4. Registrar facturación ──────────────────────────────────────
-- Se puede antes de entregar: facturar y entregar son momentos distintos y el
-- taller factura cuando la compañía le aprueba la orden, no cuando sale el auto.
-- Por eso tampoco hay restricción de etapa.

create or replace function taller_registrar_facturacion(
  p_vehiculo uuid,
  p_rubro    text,
  p_estado   text,
  p_factura  text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_empresa     uuid;
  v_etapa       text;
  v_label       text;
  v_estado      text;
  v_factura     text;
  v_estado_ant  text;
  v_factura_ant text;
  v_antes       text;
begin
  if p_rubro not in ('compania', 'franquicia', 'particular') then
    raise exception 'Rubro de facturación inválido: %', p_rubro;
  end if;
  if p_estado not in ('pendiente', 'facturado', 'no_aplica') then
    raise exception 'Estado de facturación inválido: %', p_estado;
  end if;

  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.montos') then
    raise exception 'No tenés permiso para registrar la facturación';
  end if;

  -- Lo que había antes, para que quede en la bitácora. El campo actual se
  -- borra al salir de facturado, pero el número con el que se facturó alguna
  -- vez no se pierde: queda escrito en el movimiento.
  execute format('select %I, %I from vehiculo_monto where vehiculo_id = $1',
                 'estado_' || p_rubro, 'factura_' || p_rubro)
    into v_estado_ant, v_factura_ant using p_vehiculo;

  -- El número de factura solo tiene sentido si está facturado: al volver a
  -- pendiente o a no aplica se borra, así no queda un número colgado.
  v_estado  := p_estado;
  v_factura := case when p_estado = 'facturado' then nullif(trim(coalesce(p_factura, '')), '')
                    else null end;

  -- El nombre de columna se arma entero antes de pasarlo por %I: %I encomilla
  -- lo que recibe, así que 'estado_' || %I daría estado_"compania". El rubro ya
  -- pasó por la lista blanca de arriba.
  perform set_config('taller.flujo', 'on', true);
  execute format(
    'update vehiculo_monto set %I = $1, %I = $2 where vehiculo_id = $3',
    'estado_' || p_rubro, 'factura_' || p_rubro)
    using v_estado, v_factura, p_vehiculo;
  perform set_config('taller.flujo', '', true);

  v_label := case p_rubro
    when 'compania'   then 'Compañía'
    when 'franquicia' then 'Franquicia'
    else 'Particular' end;

  v_antes := ' (antes: ' ||
    case coalesce(v_estado_ant, 'pendiente')
      when 'facturado' then 'facturado'
      when 'no_aplica' then 'no aplica'
      else 'pendiente'
    end ||
    coalesce(', factura ' || v_factura_ant, '') || ')';

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'facturacion', v_etapa,
          v_label || ': ' ||
          case v_estado
            when 'facturado' then 'facturado' ||
                 coalesce(' con factura ' || v_factura, ' (sin número de factura)')
            when 'no_aplica' then 'marcado como no aplica'
            else 'vuelve a pendiente de facturar'
          end
          || v_antes);
end;
$$;

grant execute on function taller_registrar_facturacion(uuid, text, text, text) to authenticated;

-- ── 5. Aclaración de lo que ya existía ────────────────────────────
-- Los tildes de 0026 son de COBRO, no de facturación. El texto que dejaban en
-- la bitácora decía "Orden de compañía facturada", que ahora se confunde con lo
-- de arriba. Se corrige el texto; el comportamiento no cambia en nada.

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
    when 'cobro_compania'   then 'Cobro de la compañía'
    when 'cobro_franquicia' then 'Cobro de la franquicia'
    else 'Cobro del particular' end;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'cobro', v_etapa,
          v_label || ': ' || case when p_valor then 'validado' else 'desmarcado' end);
end;
$$;
