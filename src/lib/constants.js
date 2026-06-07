/**
 * Constantes compartidas del sistema SAU.
 * Actualizar TECHO_MONO con cada resolución general de ARCA.
 *
 * Fuente: RG ARCA vigente.
 * Última actualización: junio 2026.
 */

// ── Fiscales ──────────────────────────────────────────────────────

// Techo de facturación anual por categoría de monotributo (en pesos)
export const TECHO_MONO = {
  A: 2_100_000,
  B: 3_100_000,
  C: 4_300_000,
  D: 5_700_000,
  E: 7_200_000,
  F: 9_300_000,
  G: 11_900_000,
  H: 14_800_000,
  I: 18_000_000,
  J: 21_900_000,
  K: 25_700_000,
}

export const CATEGORIAS_MONO = ['A','B','C','D','E','F','G','H','I','J','K']

// ── Empresa ───────────────────────────────────────────────────────

export const RUBROS = [
  { id: 'kiosco',       label: 'Kiosco / Almacén', icon: '🏪' },
  { id: 'gastronomia',  label: 'Gastronomía',       icon: '🍽️' },
  { id: 'indumentaria', label: 'Indumentaria',      icon: '👕' },
  { id: 'ferreteria',   label: 'Ferretería',        icon: '🔧' },
  { id: 'servicios',    label: 'Servicios',         icon: '💼' },
  { id: 'salud',        label: 'Salud / Estética',  icon: '💆' },
  { id: 'tecnologia',   label: 'Tecnología',        icon: '💻' },
  { id: 'otro',         label: 'Otro',              icon: '🏢' },
]

// ── Permisos ──────────────────────────────────────────────────────

// Permisos completos para rol admin / dueño
export const TODOS_PERMISOS = [
  'ventas.crear', 'ventas.confirmar', 'ventas.ver',
  'caja.crear',   'caja.ver',
  'compras.crear','compras.ver',
  'reportes.ver',
  'empresa.admin','empresa.rrhh',
]

// Permisos base para empleado que se une por invitación
export const PERMISOS_EMPLEADO_BASE = [
  'ventas.crear', 'ventas.ver', 'caja.ver', 'reportes.ver',
]
