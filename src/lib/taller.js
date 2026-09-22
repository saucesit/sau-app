/**
 * Reglas del módulo Taller.
 *
 * La cadena de etapas es secuencial y validada: el operario marca su trabajo como
 * hecho, pero el vehículo NO avanza hasta que otro rol lo valida. Esa doble
 * confirmación es a propósito — evita que un auto avance por apuro del operario.
 *
 * Los estados de excepción (mecánica, detenido, ampliación) son una etiqueta
 * encima de la etapa, no la reemplazan: al levantarse, el auto sigue donde estaba.
 */

export const ETAPAS = [
  { id: 'recepcion',   label: 'Recepción'   },
  { id: 'chapa',       label: 'Chapa'       },
  { id: 'preparacion', label: 'Preparación' },
  { id: 'pintura',     label: 'Pintura'     },
  { id: 'pre_entrega', label: 'Pre Entrega' },
  { id: 'terminado',   label: 'Terminado'   },
  { id: 'entregado',   label: 'Entregado'   },
]

/** Etapas que cuentan como "en el taller" (entregado ya salió) */
export const ETAPAS_ACTIVAS = ETAPAS.filter(e => e.id !== 'entregado')

export const EXCEPCIONES = [
  { id: 'mecanica',   label: 'Mecánica',   color: 'text-sky-400 bg-sky-500/15'     },
  { id: 'detenido',   label: 'Detenido',   color: 'text-red-400 bg-red-500/15'     },
  { id: 'ampliacion', label: 'Ampliación', color: 'text-amber-400 bg-amber-500/15' },
]

/** Umbrales de alerta definidos por el taller */
export const DIAS_ALERTA_TALLER = 20   // demasiado tiempo adentro
export const DIAS_ALERTA_ETAPA  = 7    // estancado sin avanzar

export function etapaLabel(id) {
  return ETAPAS.find(e => e.id === id)?.label || id
}

export function excepcionCfg(id) {
  return EXCEPCIONES.find(e => e.id === id) || null
}

/** La etapa que sigue en la cadena, o null si es la última */
export function etapaSiguiente(id) {
  const i = ETAPAS.findIndex(e => e.id === id)
  return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1].id : null
}

function diasDesde(fecha) {
  if (!fecha) return 0
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
}

export const diasEnTaller = (v) => diasDesde(v.fecha_ingreso)
export const diasEnEtapa  = (v) => diasDesde(v.etapa_desde)

/**
 * Alertas de un vehículo, ordenadas de más grave a menos.
 * Devuelve [] si está todo en plazo.
 */
export function alertas(v) {
  const out = []
  const enTaller = diasEnTaller(v)
  const enEtapa  = diasEnEtapa(v)

  if (enTaller > DIAS_ALERTA_TALLER) {
    out.push({ nivel: 'alto', texto: `${enTaller} días en taller` })
  }
  if (enEtapa > DIAS_ALERTA_ETAPA) {
    out.push({ nivel: 'medio', texto: `${enEtapa} días sin avanzar` })
  }
  if (v.fecha_pactada && !v.fecha_entrega) {
    const faltan = Math.ceil((new Date(v.fecha_pactada).getTime() - Date.now()) / 86400000)
    if (faltan < 0)       out.push({ nivel: 'alto',  texto: `vencido hace ${-faltan} días` })
    else if (faltan <= 2) out.push({ nivel: 'medio', texto: faltan === 0 ? 'vence hoy' : `vence en ${faltan} días` })
  }
  return out
}

/** Lo que falta cobrar de un vehículo: cada validación tildada descuenta su monto */
export function pendiente(v) {
  return (v.cobro_compania   ? 0 : Number(v.monto_compania   || 0))
       + (v.cobro_franquicia ? 0 : Number(v.monto_franquicia || 0))
       + (v.cobro_particular ? 0 : Number(v.monto_particular || 0))
}

export function total(v) {
  return Number(v.monto_compania || 0) + Number(v.monto_franquicia || 0) + Number(v.monto_particular || 0)
}

export function fmtMonto(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n || 0)
}

export function fmtFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Compañías más usadas — el alta deja escribir otra igual */
export const COMPANIAS = [
  'Zurich', 'Mapfre', 'San Cristóbal', 'Sancor', 'Federación Patronal',
  'Nivel', 'Norte', 'Particular', 'Flota interna',
]
