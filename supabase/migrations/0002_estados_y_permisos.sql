-- =====================================================================
--  Migración 0002 — Estados de venta + Permisos granulares
-- =====================================================================


-- ---------- 1. Estado de la venta ----------
-- Una venta ahora tiene un ciclo de vida:
--   borrador    → creada pero no confirmada (ej: pedido de preventista)
--   confirmada  → se concretó, entra al negocio
--   facturada   → ya tiene CAE / comprobante fiscal emitido
--   cancelada   → no se realizó

create type estado_venta as enum ('borrador', 'confirmada', 'facturada', 'cancelada');

alter table venta
  add column estado estado_venta not null default 'confirmada';
-- default 'confirmada' para no romper las ventas ya cargadas:
-- las que están eran ventas directas (no preventista), así que ya estaban confirmadas.

create index on venta (empresa_id, estado);


-- ---------- 2. Permisos granulares en membresía ----------
-- Cada usuario dentro de una empresa tiene un array de permisos
-- que define exactamente a qué módulos puede acceder.
-- El dueño los asigna al dar de alta un usuario en su empresa.
--
-- Permisos disponibles (convención: modulo.accion):
--   ventas.crear      → puede cargar ventas
--   ventas.confirmar  → puede confirmar borradores
--   ventas.ver        → puede ver el historial de ventas
--   caja.crear        → puede registrar movimientos de caja
--   caja.ver          → puede ver la caja
--   compras.crear     → puede cargar facturas de proveedores / gastos
--   compras.ver       → puede ver compras y gastos
--   reportes.ver      → puede ver reportes y dashboard
--   empresa.admin     → puede gestionar usuarios y configuración

alter table membresia
  add column permisos text[] not null default '{}';

-- Permisos por defecto según el rol base.
-- Los roles ya existentes arrancan con sus permisos "naturales".
update membresia set permisos = array[
  'ventas.crear', 'ventas.ver',
  'caja.crear', 'caja.ver',
  'compras.crear', 'compras.ver',
  'reportes.ver'
] where rol = 'empleado';

update membresia set permisos = array[
  'ventas.crear', 'ventas.confirmar', 'ventas.ver',
  'caja.crear', 'caja.ver',
  'compras.crear', 'compras.ver',
  'reportes.ver',
  'empresa.admin'
] where rol = 'dueno';

update membresia set permisos = array[
  'ventas.crear', 'ventas.confirmar', 'ventas.ver',
  'caja.crear', 'caja.ver',
  'compras.crear', 'compras.ver',
  'reportes.ver',
  'empresa.admin'
] where rol = 'contadora';

update membresia set permisos = array[
  'ventas.crear', 'ventas.confirmar', 'ventas.ver',
  'caja.crear', 'caja.ver',
  'compras.crear', 'compras.ver',
  'reportes.ver',
  'empresa.admin'
] where rol = 'admin';


-- ---------- 3. Función helper: ¿el usuario tiene un permiso? ----------
-- Útil para RLS en los módulos que vienen (compras, reportes, etc.)
create or replace function tiene_permiso(p text)
  returns boolean language sql security definer stable as $$
  select exists (
    select 1 from membresia
    where usuario_id = auth.uid()
      and activa = true
      and (p = any(permisos) or rol in ('contadora', 'admin'))
  )
$$;
