-- Módulo de Fiado: clientes con cuenta corriente / libreta
-- Reemplaza el prototipo localStorage de KioscoFiado con datos reales multi-tenant.

-- ── Clientes de fiado ─────────────────────────────────────────────
create table cliente_fiado (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid references empresa(id) on delete cascade,
  nombre        text not null,
  telefono      text,
  nota          text,
  limite_fiado  numeric(14,2),          -- null = sin límite
  saldo_actual  numeric(14,2) default 0, -- mantenido por trigger
  activo        boolean default true,
  es_simulacion boolean default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── Movimientos de fiado ──────────────────────────────────────────
-- tipo = 'fiado'  → el cliente se llevó algo a deuda  (saldo sube)
-- tipo = 'pago'   → el cliente pagó algo              (saldo baja)
create table movimiento_fiado (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid references empresa(id) on delete cascade,
  cliente_fiado_id  uuid references cliente_fiado(id) on delete cascade,
  tipo              text not null check (tipo in ('fiado','pago')),
  monto             numeric(14,2) not null check (monto > 0),
  descripcion       text,
  registrado_por    uuid references auth.users(id),
  es_simulacion     boolean default false,
  created_at        timestamptz default now()
);

-- ── Trigger: mantiene saldo_actual sincronizado ───────────────────
create or replace function fn_actualizar_saldo_fiado()
returns trigger
language plpgsql
security definer
as $$
begin
  update cliente_fiado
  set
    saldo_actual = (
      select coalesce(
        sum(case when tipo = 'fiado' then monto else -monto end),
        0
      )
      from movimiento_fiado
      where cliente_fiado_id = NEW.cliente_fiado_id
    ),
    updated_at = now()
  where id = NEW.cliente_fiado_id;
  return NEW;
end;
$$;

create trigger trg_actualizar_saldo_fiado
  after insert on movimiento_fiado
  for each row execute function fn_actualizar_saldo_fiado();

-- ── RLS ───────────────────────────────────────────────────────────
alter table cliente_fiado   enable row level security;
alter table movimiento_fiado enable row level security;

create policy cf_select on cliente_fiado
  for select using (empresa_id in (select empresas_del_usuario()));

create policy cf_insert on cliente_fiado
  for insert with check (empresa_id in (select empresas_del_usuario()));

create policy cf_update on cliente_fiado
  for update using (empresa_id in (select empresas_del_usuario()));

create policy mf_select on movimiento_fiado
  for select using (empresa_id in (select empresas_del_usuario()));

create policy mf_insert on movimiento_fiado
  for insert with check (empresa_id in (select empresas_del_usuario()));

-- ── Default modulos_activos incluye fiado ─────────────────────────
alter table empresa
  alter column modulos_activos
  set default array['ventas','caja','compras','equipo','stock','fiado'];
