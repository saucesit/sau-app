-- Cobranzas: seguimiento de pagos mensuales por cliente SAU.
-- Facundo asigna el abono a cada empresa y marca manualmente cada pago.
-- Los datos quedan para análisis con IA en el futuro.

-- Campos en empresa
alter table empresa
  add column if not exists abono_mensual       integer,         -- monto en pesos
  add column if not exists abono_dia_vencimiento integer default 5; -- día del mes que vence

-- Tabla de pagos (una fila por empresa por mes)
create table if not exists pago_abono (
  id          uuid        primary key default gen_random_uuid(),
  empresa_id  uuid        not null references empresa(id) on delete cascade,
  periodo     text        not null,  -- 'YYYY-MM', ej: '2026-06'
  monto       integer     not null,
  pagado      boolean     not null default false,
  fecha_pago  timestamptz,
  notas       text,
  created_at  timestamptz not null default now(),
  unique (empresa_id, periodo)
);

-- Solo el dueño de SAU puede leer/escribir cobranzas
alter table pago_abono enable row level security;

create policy "sau_admin_cobranzas" on pago_abono
  using (
    exists (
      select 1 from profile
      where profile.id = auth.uid()
        and profile.es_sau_admin = true
    )
  )
  with check (
    exists (
      select 1 from profile
      where profile.id = auth.uid()
        and profile.es_sau_admin = true
    )
  );
