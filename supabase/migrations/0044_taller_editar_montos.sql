-- Los importes se corrigen después del alta, y cada corrección deja rastro.
--
-- Forani da de alta rápido, muchas veces con los tres importes en cero, y los
-- completa cuando la compañía aprueba la orden. Hasta hoy no podía: la ficha
-- mostraba los montos como texto. La base, en cambio, ya los dejaba cambiar
-- —`vehiculo_monto_write` es ALL con taller.montos y `monto_*` no estaba en
-- ninguna guardia—, así que el importe podía pasar de $0 a millones por API
-- sin dejar una línea en la bitácora. Eso se cierra acá.
--
-- Queda igual que facturación y cobro: una función que valida, escribe y
-- registra, y una guardia que impide hacerlo por afuera.
--
-- Lo que este cambio NO hace:
--   * No toca el estado de facturación ni el número de factura. Cambiar el
--     importe de un concepto ya facturado se permite —si no, habría que
--     volverlo a pendiente y se perdería el número— pero queda escrito en la
--     bitácora con esa advertencia adentro.
--   * No abre ningún permiso nuevo: todo esto ya lo gobierna taller.montos.
--   * No toca los demás campos del alta, que siguen sin editor.

-- ── 1. Un tipo de movimiento propio ───────────────────────────────
-- Separado de 'facturacion' y de 'edicion': cambiar cuánto vale un trabajo no
-- es lo mismo que marcarlo facturado ni que corregirle el teléfono al cliente,
-- y quien audite la bitácora tiene que poder filtrarlos aparte.

alter table vehiculo_evento drop constraint if exists vehiculo_evento_tipo_check;
alter table vehiculo_evento add constraint vehiculo_evento_tipo_check
  check (tipo in ('ingreso', 'nota', 'trabajo_hecho', 'avance', 'excepcion',
                  'cobro', 'entrega', 'facturacion', 'edicion', 'anulacion',
                  'monto'));

-- ── 2. Plata escrita como la lee un argentino ─────────────────────
-- to_char usa el locale del servidor para el separador de miles (G) y el
-- decimal (D) —hoy en_US, o sea al revés de como se escribe acá. En vez de
-- asumir cuáles son, se le preguntan y se traducen. Así el texto de la
-- bitácora no cambia si mañana cambia la configuración del servidor.

create or replace function taller_pesos(p_monto numeric)
returns text language sql stable as $$
  with sep as (
    select substr(to_char(1000.5, 'FM9G999D0'), 2, 1) as g,
           substr(to_char(1000.5, 'FM9G999D0'), 6, 1) as d
  )
  select '$' || translate(to_char(coalesce(p_monto, 0), 'FM999G999G999G990D00'),
                          (select g || d from sep), '.,')
$$;

grant execute on function taller_pesos(numeric) to authenticated;

-- ── 3. La función que corrige un importe ──────────────────────────
-- Espejo de taller_registrar_facturacion: misma validación, misma manera de
-- armar el nombre de columna, misma bandera de flujo, mismo registro.

create or replace function taller_registrar_monto(
  p_vehiculo uuid,
  p_rubro    text,
  p_monto    numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_etapa   text;
  v_label   text;
  v_antes   numeric;
  v_estado  text;
begin
  -- Lista blanca antes de que el rubro llegue a format(%I).
  if p_rubro not in ('compania', 'franquicia', 'particular') then
    raise exception 'Rubro de facturación inválido: %', p_rubro;
  end if;
  if p_monto is null or p_monto < 0 then
    raise exception 'El importe tiene que ser un número de cero para arriba';
  end if;

  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.montos') then
    raise exception 'No tenés permiso para modificar importes';
  end if;

  execute format('select %I, %I from vehiculo_monto where vehiculo_id = $1',
                 'monto_' || p_rubro, 'estado_' || p_rubro)
    into v_antes, v_estado using p_vehiculo;

  -- Guardar el mismo número no es un cambio: no ensucia la bitácora.
  if v_antes is not distinct from p_monto then
    return;
  end if;

  perform set_config('taller.flujo', 'on', true);
  execute format('update vehiculo_monto set %I = $1, updated_at = now() where vehiculo_id = $2',
                 'monto_' || p_rubro)
    using p_monto, p_vehiculo;
  perform set_config('taller.flujo', '', true);

  v_label := case p_rubro
    when 'compania'   then 'Compañía'
    when 'franquicia' then 'Franquicia'
    else 'Particular' end;

  -- El autor y la fecha los pone trg_taller_evento_autor con auth.uid(), que
  -- adentro de una función definer sigue siendo quien llamó.
  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'monto', v_etapa,
          v_label || ': importe ' || taller_pesos(v_antes) ||
          ' → ' || taller_pesos(p_monto) ||
          case when coalesce(v_estado, 'pendiente') = 'facturado'
               then ' · ATENCIÓN: este concepto ya estaba facturado, el número de factura no se tocó'
               else '' end);
end;
$$;

comment on function taller_registrar_monto(uuid, text, numeric) is
  'Corrige el importe de un rubro dejando el movimiento en la bitácora. No toca el estado de facturación ni el número de factura.';

grant execute on function taller_registrar_monto(uuid, text, numeric) to authenticated;

-- ── 4. La carga inicial, al dar de alta ───────────────────────────
-- El alta escribe los tres importes de una, sobre una fila recién creada en
-- cero. Pasarla por taller_registrar_monto dejaría tres movimientos "de $0 a
-- X" en un vehículo que acaba de entrar, al lado del evento de ingreso que ya
-- dice todo. Va por su propia función, que solo sirve para eso: exige que los
-- tres estén en cero y que no haya ningún movimiento de importe todavía. Si
-- esas dos cosas no se cumplen, ya no es un alta y hay que usar la otra.

create or replace function taller_montos_iniciales(
  p_vehiculo   uuid,
  p_compania   numeric,
  p_franquicia numeric,
  p_particular numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_fila    vehiculo_monto%rowtype;
begin
  if p_compania < 0 or p_franquicia < 0 or p_particular < 0
     or p_compania is null or p_franquicia is null or p_particular is null then
    raise exception 'Los importes tienen que ser números de cero para arriba';
  end if;

  select empresa_id into v_empresa from vehiculo where id = p_vehiculo;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.montos') then
    raise exception 'No tenés permiso para cargar importes';
  end if;

  select * into v_fila from vehiculo_monto where vehiculo_id = p_vehiculo;
  if v_fila.vehiculo_id is null then
    raise exception 'El vehículo todavía no tiene fila de importes';
  end if;

  if coalesce(v_fila.monto_compania, 0)   <> 0
  or coalesce(v_fila.monto_franquicia, 0) <> 0
  or coalesce(v_fila.monto_particular, 0) <> 0
  or exists (select 1 from vehiculo_evento
              where vehiculo_id = p_vehiculo and tipo = 'monto') then
    raise exception 'Este vehículo ya tiene importes cargados. Corregilos de a uno con taller_registrar_monto, que deja el movimiento en la bitácora.';
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo_monto
     set monto_compania   = p_compania,
         monto_franquicia = p_franquicia,
         monto_particular = p_particular,
         updated_at       = now()
   where vehiculo_id = p_vehiculo;
  perform set_config('taller.flujo', '', true);
end;
$$;

comment on function taller_montos_iniciales(uuid, numeric, numeric, numeric) is
  'Carga los importes al dar de alta. Solo funciona sobre una fila en cero y sin movimientos de importe: después hay que usar taller_registrar_monto.';

grant execute on function taller_montos_iniciales(uuid, numeric, numeric, numeric) to authenticated;

-- ── 5. La guardia ─────────────────────────────────────────────────
-- Se le suman los tres monto_*. A partir de acá la única forma de mover un
-- importe es por una de las dos funciones de arriba, igual que ya pasaba con
-- los cobros, los estados y los números de factura.

create or replace function public.taller_guardia_cobro()
returns trigger
language plpgsql
as $$
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

    if new.monto_compania   is distinct from old.monto_compania
    or new.monto_franquicia is distinct from old.monto_franquicia
    or new.monto_particular is distinct from old.monto_particular
    then
      raise exception 'Los importes se modifican con taller_registrar_monto, para que quede quién, cuándo y de cuánto a cuánto';
    end if;
  end if;
  return new;
end;
$$;

-- Control: la guardia tiene que estar viva sobre vehiculo_monto.
select 'guardia de importes activa: ' ||
       (select count(*) from pg_trigger
         where tgname = 'trg_taller_guardia_cobro'
           and tgrelid = 'vehiculo_monto'::regclass)::text as resultado;
