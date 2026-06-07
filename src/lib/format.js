// Formato de pesos argentinos: $1.234,50
export function formatPesos(n) {
  const v = Number(n) || 0
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Fecha corta: 06/06/26
export function formatFecha(f) {
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// Fecha de hoy en formato ISO (YYYY-MM-DD), para guardar y filtrar.
export function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}
