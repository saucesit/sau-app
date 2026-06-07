-- Migración 0006: Campos fiscales para ARCA
-- NOTA: cuit, condicion_fiscal y categoria_monotributo ya existen en empresa (0001)
--       neto, iva, total ya existen en venta y compra (0001/0004)

-- ── Empresa: agregar solo lo que falta ───────────────────────────
alter table empresa
  add column if not exists punto_de_venta     smallint default 1,
  add column if not exists actividad_iibb     text,
  add column if not exists inicio_actividades date;

comment on column empresa.punto_de_venta     is 'Número de punto de venta habilitado en ARCA (1-9999)';

-- ── Venta: campos para factura electrónica ────────────────────────
-- tipo_comprobante: 1=Factura A, 6=Factura B, 11=Factura C, 3=NC A, 8=NC B, 13=NC C
alter table venta
  add column if not exists tipo_comprobante        smallint,
  add column if not exists numero_comprobante      integer,
  add column if not exists cae                     text,
  add column if not exists cae_vencimiento         date,
  add column if not exists cuit_comprador          text,
  add column if not exists condicion_iva_comprador text check (condicion_iva_comprador in (
    'responsable_inscripto', 'consumidor_final', 'exento', 'monotributo', 'no_categorizado'
  )),
  add column if not exists alicuota_iva            numeric(5,2) default 21,
  add column if not exists otros_tributos          numeric(14,2) default 0,
  add column if not exists moneda                  char(3) default 'ARS',
  add column if not exists cotizacion              numeric(10,4) default 1;

comment on column venta.tipo_comprobante  is 'Código ARCA: 1=Fact.A, 6=Fact.B, 11=Fact.C';
comment on column venta.cae              is 'Código de Autorización Electrónico — sin esto la factura no es válida';

-- ── Compra: datos fiscales del proveedor ─────────────────────────
alter table compra
  add column if not exists cuit_proveedor        text,
  add column if not exists condicion_fiscal_prov text check (condicion_fiscal_prov in (
    'responsable_inscripto', 'monotributo', 'exento', 'no_inscripto'
  )),
  add column if not exists tipo_comprobante      smallint,
  add column if not exists numero_comprobante    integer;

-- ── Vista: Libro IVA Ventas ───────────────────────────────────────
create or replace view libro_iva_ventas as
  select
    v.id,
    v.empresa_id,
    v.fecha,
    v.tipo_comprobante,
    v.numero_comprobante,
    v.cae,
    v.cae_vencimiento,
    v.cuit_comprador,
    v.condicion_iva_comprador,
    v.neto              as importe_neto,
    v.alicuota_iva,
    v.iva,
    v.otros_tributos,
    v.total,
    v.moneda,
    v.cotizacion,
    e.cuit              as cuit_vendedor,
    e.punto_de_venta,
    e.condicion_fiscal  as condicion_fiscal_vendedor
  from venta v
  join empresa e on e.id = v.empresa_id
  where v.tipo_registro = 'fiscal'
    and v.cae is not null;

-- ── Vista: Libro IVA Compras ──────────────────────────────────────
create or replace view libro_iva_compras as
  select
    c.id,
    c.empresa_id,
    c.fecha,
    c.tipo_comprobante,
    c.numero_comprobante,
    p.nombre            as proveedor_nombre,
    c.cuit_proveedor,
    c.condicion_fiscal_prov,
    c.neto              as importe_neto,
    c.iva,
    c.total
  from compra c
  left join proveedor p on p.id = c.proveedor_id;

-- ── Vista: Posición IVA mensual ───────────────────────────────────
create or replace view posicion_iva_mensual as
  select
    empresa_id,
    date_trunc('month', fecha)::date  as periodo,
    sum(iva)                           as iva_debito_fiscal
  from libro_iva_ventas
  group by empresa_id, date_trunc('month', fecha);
