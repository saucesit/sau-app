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

/**
 * Etapas donde efectivamente trabaja un operario, y por lo tanto las únicas que
 * pueden ser su especialidad. Recepción es administrativa y Terminado es la
 * antesala de la entrega. Tiene que coincidir con taller_etapas_con_operario()
 * en la base, que es quien realmente lo hace cumplir.
 */
export const ETAPAS_CON_OPERARIO = ETAPAS.filter(e =>
  ['chapa', 'preparacion', 'pintura', 'pre_entrega'].includes(e.id)
)

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

/**
 * Las columnas `date` de Postgres llegan como '2026-09-22', y `new Date()` las
 * interpreta como medianoche UTC: en Argentina eso cae el día anterior a las
 * 21:00, y el taller veía todas las fechas y los plazos corridos un día.
 * Los timestamptz vienen completos y se parsean normal.
 */
export function aFecha(valor) {
  if (!valor) return null
  if (typeof valor === 'string' && valor.length === 10) {
    const [a, m, d] = valor.split('-').map(Number)
    return new Date(a, m - 1, d)
  }
  return new Date(valor)
}

function diasDesde(fecha) {
  const f = aFecha(fecha)
  if (!f) return 0
  return Math.floor((Date.now() - f.getTime()) / 86400000)
}

/** Días que faltan para una fecha pactada. Negativo si ya venció. */
function diasHasta(fecha) {
  const f = aFecha(fecha)
  if (!f) return null
  return Math.ceil((f.getTime() - Date.now()) / 86400000)
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
    const faltan = diasHasta(v.fecha_pactada)
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

/**
 * Severidad de un vehículo, en un solo lugar: la usan la tarjeta de la pizarra,
 * la cola de decisiones y la ficha, así los tres dicen lo mismo del mismo auto.
 * Devuelve `motivo` solo cuando hay algo que decidir — eso arma la cola.
 */
export function estado(v) {
  const enTaller = diasEnTaller(v)
  const enEtapa  = diasEnEtapa(v)
  const vence    = diasHasta(v.fecha_pactada)

  if (enTaller > DIAS_ALERTA_TALLER)
    return { s: 'urgent', tag: 'DEMORA CRÍTICA', motivo: `${enTaller} días en taller` }
  if (vence !== null && vence < 0)
    return { s: 'urgent', tag: 'VENCIDO', motivo: `vencido hace ${-vence} días` }
  if (enEtapa > DIAS_ALERTA_ETAPA)
    return { s: 'warn', tag: 'SIN AVANZAR', motivo: `${enEtapa} días sin avanzar` }
  if (vence !== null && vence <= 2)
    return { s: 'warn', tag: 'VENCE PRONTO', motivo: vence === 0 ? 'vence hoy' : `vence en ${vence} días` }
  if (v.etapa === 'terminado')
    return { s: 'ready', tag: 'LISTO PARA ENTREGAR', motivo: null }
  if (v.trabajo_hecho)
    return { s: 'ok', tag: 'ESPERA VALIDACIÓN', motivo: null }
  return { s: 'ok', tag: 'EN PROCESO', motivo: null }
}

/**
 * Qué hay que hacer con este auto ahora. Espeja las reglas que aplica la base
 * en taller_validar_avance y taller_marcar_trabajo_hecho: si acá dice una cosa
 * y el servidor rechaza otra, es que se desincronizaron.
 */
export function proximaAccion(v) {
  if (v.excepcion) {
    const label = excepcionCfg(v.excepcion)?.label.toLowerCase() || v.excepcion
    return {
      bloqueado: true,
      titulo: `Levantar ${label}`,
      detalle: `Mientras esté activo, el auto sigue en ${etapaLabel(v.etapa)} y no avanza.`,
    }
  }
  if (v.etapa === 'entregado')
    return { bloqueado: false, titulo: 'Entregado', detalle: 'Ya salió del taller.' }
  if (v.etapa === 'terminado')
    return {
      bloqueado: false,
      titulo: 'Registrar cobros y entregar',
      detalle: 'Se puede entregar aunque queden montos pendientes.',
    }
  if (ETAPAS_CON_OPERARIO.some(e => e.id === v.etapa)) {
    if (!v.trabajo_hecho)
      return {
        bloqueado: false,
        titulo: `Esperando al operario de ${etapaLabel(v.etapa).toLowerCase()}`,
        detalle: 'Tiene que marcar su trabajo como realizado antes de que alguien lo valide.',
      }
    return {
      bloqueado: false,
      titulo: `Validar y pasar a ${etapaLabel(etapaSiguiente(v.etapa))}`,
      detalle: 'El operario ya marcó el trabajo. Falta la confirmación.',
    }
  }
  return {
    bloqueado: false,
    titulo: 'Validar recepción y pasar a Chapa',
    detalle: 'Recepción no tiene operario: la valida administración o el coordinador.',
  }
}

/** AF937ER → AF 937 ER. La base guarda sin espacios; esto es solo para leer. */
export function patenteLegible(p) {
  if (!p) return ''
  return p
    .replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1 $2 $3')
    .replace(/^([A-Z]{3})(\d{3})$/, '$1 $2')
}

export function fmtFecha(iso) {
  const f = aFecha(iso)
  if (!f) return '—'
  return f.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Compañías más usadas — el alta deja escribir otra igual */
export const COMPANIAS = [
  'Zurich', 'Mapfre', 'San Cristóbal', 'Sancor', 'Federación Patronal',
  'Nivel', 'Norte', 'Particular', 'Flota interna',
]
