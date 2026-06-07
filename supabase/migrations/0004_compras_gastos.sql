-- =====================================================================
--  Migración 0004 — Compras y Gastos
-- =====================================================================

-- ---------- Tipos ----------
create type estado_compra as enum ('pendiente', 'pagada', 'anulada');

create type categoria_gasto as enum (
  'mercaderia',
  'servicios',
  'alquiler',
  'servicios_publicos',
  'transporte',
  'limpieza',
  'mantenimiento',
  'personal',
  'impuestos',
  'otro'
);


-- ---------- Proveedores ----------
create table proveedor (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  nombre      text not null,
  cuit        text,
  telefono    text,
  email       text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, cuit)
);
create index on proveedor (empresa_id);


-- ---------- Compras (facturas de proveedores) ----------
-- Estas entran al Libro IVA compras y afectan la posición fiscal.
create table compra (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresa(id) on delete cascade,
  proveedor_id    uuid references proveedor(id) on delete set null,
  fecha           date not null default current_date,
  nro_factura     text,
  neto            numeric(14,2) not null default 0,
  iva             numeric(14,2) not null default 0,
  total           numeric(14,2) not null,
  categoria       categoria_gasto not null default 'mercaderia',
  medio_pago      medio_pago not null default 'efectivo',
  estado          estado_compra not null default 'pendiente',
  foto_url        text,                    -- Storage de Supabase (fase siguiente)
  descripcion     text,
  cargado_por     uuid not null references profile(id),
  creado_en       timestamptz not null default now()
);
create index on compra (empresa_id, fecha);
create index on compra (empresa_id, estado);


-- ---------- Gastos (sin factura formal) ----------
-- Caja chica, viáticos, gastos menores. No siempre tienen IVA discriminado.
create table gasto (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  fecha       date not null default current_date,
  concepto    text not null,
  monto       numeric(14,2) not null,
  categoria   categoria_gasto not null default 'otro',
  medio_pago  medio_pago not null default 'efectivo',
  foto_url    text,
  cargado_por uuid not null references profile(id),
  creado_en   timestamptz not null default now()
);
create index on gasto (empresa_id, fecha);


-- =====================================================================
--  RLS
-- =====================================================================
alter table proveedor enable row level security;
alter table compra     enable row level security;
alter table gasto      enable row level security;

-- Proveedores: ver y crear los de mi empresa
create policy proveedor_select on proveedor
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy proveedor_insert on proveedor
  for insert with check (empresa_id in (select empresas_del_usuario()));
create policy proveedor_update on proveedor
  for update using (empresa_id in (select empresas_del_usuario()));

-- Compras: ver y crear las de mi empresa
create policy compra_select on compra
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy compra_insert on compra
  for insert with check (empresa_id in (select empresas_del_usuario()));
create policy compra_update on compra
  for update using (empresa_id in (select empresas_del_usuario()));

-- Gastos: misma lógica
create policy gasto_select on gasto
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy gasto_insert on gasto
  for insert with check (empresa_id in (select empresas_del_usuario()));
