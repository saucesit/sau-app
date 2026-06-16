-- Modo de stock "simple": disponibilidad sin contar unidades.
-- Pensado para comercios que no llevan inventario numérico (ej: pañalera Cokito).
--   simple   → cada producto es Disponible / Sin stock (un interruptor)
--   completo → stock numérico con movimientos y semáforo (lo que ya existía)

-- ── Modo de stock por empresa ─────────────────────────────────────
alter table empresa
  add column if not exists modo_stock text not null default 'completo'
  check (modo_stock in ('simple', 'completo'));

-- ── Disponibilidad por producto (solo se usa en modo simple) ──────
alter table producto
  add column if not exists disponible boolean not null default true;
