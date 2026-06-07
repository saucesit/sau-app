-- Migración 0007: Modo práctica / simulación
-- Las empresas nuevas arrancan en modo práctica (modo_simulacion = true).
-- Las empresas existentes quedan en modo real (default false).

alter table empresa
  add column if not exists modo_simulacion boolean not null default false;

-- Marcar cada transacción como práctica o real
alter table venta          add column if not exists es_simulacion boolean not null default false;
alter table compra         add column if not exists es_simulacion boolean not null default false;
alter table gasto          add column if not exists es_simulacion boolean not null default false;
alter table movimiento_caja add column if not exists es_simulacion boolean not null default false;

-- Índices para filtrar rápido por modo
create index if not exists venta_simulacion           on venta(empresa_id, es_simulacion, fecha);
create index if not exists compra_simulacion          on compra(empresa_id, es_simulacion, fecha);
create index if not exists gasto_simulacion           on gasto(empresa_id, es_simulacion, fecha);
create index if not exists movimiento_caja_simulacion on movimiento_caja(empresa_id, es_simulacion, fecha);
