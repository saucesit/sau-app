-- Módulo de Stock: productos + movimientos
-- El trigger mantiene stock_actual sincronizado automáticamente.

-- ── Productos ─────────────────────────────────────────────────────
create table producto (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid references empresa(id) on delete cascade,
  nombre        text not null,
  descripcion   text,
  sku           text,
  categoria     text,
  precio_costo  numeric(14,2) default 0,
  precio_venta  numeric(14,2) default 0,
  stock_actual  numeric(10,2) default 0,
  stock_minimo  numeric(10,2) default 0,
  unidad        text default 'unidad',
  activo        boolean default true,
  es_simulacion boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── Movimientos de stock ──────────────────────────────────────────
-- tipo:
--   entrada  → suma al stock  (compra, recepción, devolución)
--   salida   → resta al stock (venta, merma, préstamo)
--   ajuste   → fija el stock en el valor de cantidad (inventario físico)
create table movimiento_stock (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid references empresa(id) on delete cascade,
  producto_id    uuid references producto(id) on delete cascade,
  tipo           text not null check (tipo in ('entrada','salida','ajuste')),
  cantidad       numeric(10,2) not null,
  precio_unitario numeric(14,2),
  motivo         text,            -- ej: 'venta', 'compra', 'ajuste manual'
  referencia_id  uuid,            -- venta_id o compra_id cuando aplica
  cargado_por    uuid references auth.users(id),
  es_simulacion  boolean default false,
  created_at     timestamptz default now()
);

-- ── Trigger: actualiza stock_actual automáticamente ───────────────
create or replace function fn_actualizar_stock()
returns trigger
language plpgsql
security definer
as $$
begin
  if    NEW.tipo = 'entrada' then
    update producto set stock_actual = stock_actual + NEW.cantidad,
                        updated_at   = now()
    where id = NEW.producto_id;

  elsif NEW.tipo = 'salida' then
    update producto set stock_actual = stock_actual - NEW.cantidad,
                        updated_at   = now()
    where id = NEW.producto_id;

  elsif NEW.tipo = 'ajuste' then
    -- ajuste fija el stock en el valor exacto
    update producto set stock_actual = NEW.cantidad,
                        updated_at   = now()
    where id = NEW.producto_id;
  end if;
  return NEW;
end;
$$;

create trigger trg_actualizar_stock
  after insert on movimiento_stock
  for each row execute function fn_actualizar_stock();

-- ── RLS ───────────────────────────────────────────────────────────
alter table producto         enable row level security;
alter table movimiento_stock enable row level security;

create policy producto_select on producto
  for select using (empresa_id in (select empresas_del_usuario()));

create policy producto_insert on producto
  for insert with check (empresa_id in (select empresas_del_usuario()));

create policy producto_update on producto
  for update using (empresa_id in (select empresas_del_usuario()));

create policy movstock_select on movimiento_stock
  for select using (empresa_id in (select empresas_del_usuario()));

create policy movstock_insert on movimiento_stock
  for insert with check (empresa_id in (select empresas_del_usuario()));

-- ── Default modulos_activos incluye stock para nuevas empresas ────
alter table empresa
  alter column modulos_activos
  set default array['ventas','caja','compras','equipo','stock'];
