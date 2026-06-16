/**
 * Definición de los módulos del sistema SAU.
 *
 * El "chaleco" funciona en dos capas:
 *   1. EMPRESA: qué módulos tiene habilitados (modulos_activos en DB)
 *   2. EMPLEADO: dentro de esos módulos, qué permisos tiene cada persona
 *
 * nucleo: true  → siempre activo, no se puede desactivar (es el ADN de SAU)
 * nucleo: false → opcional, el admin o la contadora lo habilita
 */

export const MODULOS = [
  {
    id:          'ventas',
    icon:        '🛒',
    titulo:      'Ventas & Historial',
    descripcion: 'Registrar ventas, emitir comprobantes y ver el historial fiscal mensual',
    nucleo:      true,   // no se puede sacar — es el corazón del sistema
  },
  {
    id:          'caja',
    icon:        '💵',
    titulo:      'Caja',
    descripcion: 'Control diario de ingresos y egresos en efectivo',
    nucleo:      false,
  },
  {
    id:          'compras',
    icon:        '🛍️',
    titulo:      'Compras & Gastos',
    descripcion: 'Registrar compras a proveedores y gastos operativos',
    nucleo:      false,
  },
  {
    id:          'equipo',
    icon:        '👥',
    titulo:      'Equipo',
    descripcion: 'Agregar empleados y configurar qué puede hacer cada uno',
    nucleo:      false,
  },
  {
    id:          'stock',
    icon:        '📦',
    titulo:      'Stock',
    descripcion: 'Inventario de productos, precios y control de movimientos',
    nucleo:      false,
  },
  {
    id:          'fiado',
    icon:        '📒',
    titulo:      'Fiado / Libreta',
    descripcion: 'Cuenta corriente de clientes de confianza, con historial y límites',
    nucleo:      false,
  },
  {
    id:          'presupuestos',
    icon:        '📄',
    titulo:      'Presupuestos',
    descripcion: 'Armá y enviá presupuestos por WhatsApp con catálogo de ítems y precios',
    nucleo:      false,
  },
  {
    id:          'agente',
    icon:        '🤖',
    titulo:      'Agente de WhatsApp',
    descripcion: 'Un asistente IA con nombre propio que atiende a tus clientes por WhatsApp y opera en SAU',
    nucleo:      false,
  },
]

/**
 * IDs de módulos que vienen activos por defecto al crear una empresa.
 * El agente es un módulo premium opt-in: NO viene por defecto.
 */
export const MODULOS_DEFAULT = MODULOS.filter(m => m.id !== 'agente').map(m => m.id)

/** Devuelve el objeto de módulo por ID */
export function getModulo(id) {
  return MODULOS.find(m => m.id === id) || null
}
