-- =====================================================================
--  MVP Fase 1 — Ventas + Caja
--  Sistema de gestión comercial multi-empresa
--  Base: PostgreSQL (Supabase). Aislamiento por empresa con RLS.
-- =====================================================================

-- ---------- Tipos enumerados ----------
create type condicion_fiscal as enum ('monotributo', 'responsable_inscripto', 'exento');
create type rol_empresa      as enum ('empleado', 'dueno', 'contadora', 'admin');
create type tipo_registro    as enum ('fiscal', 'interno');          -- el "blanco/negro"
create type medio_pago       as enum ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'cuenta_corriente', 'otro');
create type tipo_movimiento  as enum ('ingreso', 'egreso');


-- ---------- Empresas (los negocios clientes) ----------
create table empresa (
  id                  uuid primary key default gen_random_uuid(),
  razon_social        text not null,
  nombre_fantasia     text,
  cuit                text unique,
  condicion_fiscal    condicion_fiscal not null default 'monotributo',
  categoria_monotributo text,                    -- A..K (null si es RI/exento)
  actividad           text,
  domicilio_fiscal    text,
  activa              boolean not null default true,
  creado_en           timestamptz not null default now()
);


-- ---------- Perfil de usuario (extiende auth.users de Supabase) ----------
create table profile (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  apellido    text,
  telefono    text,
  creado_en   timestamptz not null default now()
);


-- ---------- Membresía: relación usuario <-> empresa con rol ----------
-- El rol vive acá, no en el usuario: la contadora está en N empresas,
-- un dueño puede tener varias, un empleado queda atado a una.
create table membresia (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references profile(id) on delete cascade,
  empresa_id  uuid not null references empresa(id) on delete cascade,
  rol         rol_empresa not null,
  activa      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (usuario_id, empresa_id)
);


-- ---------- Ventas ----------
create table venta (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id) on delete cascade,
  fecha         date not null default current_date,
  tipo_registro tipo_registro not null default 'interno',
  neto          numeric(14,2) not null default 0,
  iva           numeric(14,2) not null default 0,
  total         numeric(14,2) not null,
  medio_pago    medio_pago not null default 'efectivo',
  descripcion   text,
  cargado_por   uuid not null references profile(id),
  creado_en     timestamptz not null default now()
);
create index on venta (empresa_id, fecha);


-- ---------- Movimientos de caja ----------
create table movimiento_caja (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresa(id) on delete cascade,
  fecha        date not null default current_date,
  tipo         tipo_movimiento not null,
  monto        numeric(14,2) not null,
  concepto     text not null,
  categoria    text,
  responsable  uuid not null references profile(id),
  creado_en    timestamptz not null default now()
);
create index on movimiento_caja (empresa_id, fecha);


-- =====================================================================
--  Seguridad a nivel de fila (RLS) — el corazón del multi-empresa
-- =====================================================================

-- Empresas a las que pertenece el usuario logueado.
create or replace function empresas_del_usuario()
  returns setof uuid language sql security definer stable as $$
  select empresa_id from membresia
  where usuario_id = auth.uid() and activa = true
$$;

-- ¿El usuario es contadora o admin? (ve TODAS las empresas)
create or replace function es_contadora_o_admin()
  returns boolean language sql security definer stable as $$
  select exists (
    select 1 from membresia
    where usuario_id = auth.uid() and activa = true
      and rol in ('contadora', 'admin')
  )
$$;

alter table empresa         enable row level security;
alter table profile         enable row level security;
alter table membresia       enable row level security;
alter table venta           enable row level security;
alter table movimiento_caja enable row level security;

-- Cada uno ve su propio perfil.
create policy profile_self on profile
  for select using (id = auth.uid());
create policy profile_update_self on profile
  for update using (id = auth.uid());

-- Empresas: las propias, o todas si es contadora/admin.
create policy empresa_select on empresa
  for select using (id in (select empresas_del_usuario()) or es_contadora_o_admin());

-- Membresías: las del usuario, o todas si es contadora/admin.
create policy membresia_select on membresia
  for select using (usuario_id = auth.uid() or es_contadora_o_admin());

-- Ventas: ver las de mis empresas (o todas si contadora/admin); cargar solo en mis empresas.
create policy venta_select on venta
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy venta_insert on venta
  for insert with check (empresa_id in (select empresas_del_usuario()));

-- Caja: misma lógica.
create policy caja_select on movimiento_caja
  for select using (empresa_id in (select empresas_del_usuario()) or es_contadora_o_admin());
create policy caja_insert on movimiento_caja
  for insert with check (empresa_id in (select empresas_del_usuario()));
