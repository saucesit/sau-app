import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const ANIM_CSS = `
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes popIn {
    from { opacity: 0; transform: scale(0.92); }
    to   { opacity: 1; transform: scale(1);    }
  }
  .slide-in { animation: slideIn 0.25s cubic-bezier(.22,.68,0,1.2); }
  .pop-in   { animation: popIn  0.3s  cubic-bezier(.22,.68,0,1.2); }
`

// ─────────────────────────────────────────────────────────────────────
// Banco de preguntas POR MÓDULO.
// El cliente solo ve las preguntas de los módulos que tiene activos,
// así cada negocio responde sobre lo suyo (Fede sobre presupuestos,
// una pañalera sobre stock y ventas, etc.). Es el "chaleco de bolsillos".
// ─────────────────────────────────────────────────────────────────────
const BANCOS = {
  ventas: {
    grupo: 'Ventas',
    preguntas: [
      {
        id: 'venta_memoria', emoji: '🛒',
        pregunta: '¿Llevás las ventas de memoria o en un cuaderno?',
        detalle:  'Sin un registro digital de lo que vendés cada día',
        si_label: 'Sí, a mano o de memoria', no_label: 'No, ya uso un sistema',
        si_resuelve: '🛒 Registrás cada venta desde el celular en segundos',
        no_resuelve: '🚀 SAU reemplaza tu sistema por algo más rápido',
      },
      {
        id: 'sabe_cuanto_vendio', emoji: '📊',
        pregunta: '¿Sabés cuánto vendiste esta semana sin sacar cuentas?',
        detalle:  'El total, los días flojos y los fuertes',
        si_label: 'No, no lo tengo claro', no_label: 'Sí, lo sé de memoria',
        si_resuelve: '📊 Totales del día y la semana, siempre a la vista',
        no_resuelve: '📊 SAU lo mantiene actualizado solo',
        invertida: true,
      },
    ],
  },

  stock: {
    grupo: 'Stock',
    preguntas: [
      {
        id: 'queda_sin_stock', emoji: '📦',
        pregunta: '¿Te quedás sin mercadería sin darte cuenta?',
        detalle:  'Te enterás que falta algo recién cuando ya no hay',
        si_label: 'Sí, me pasa seguido', no_label: 'No, lo tengo controlado',
        si_resuelve: '📦 Aviso cuando un producto se está por acabar',
        no_resuelve: '📦 SAU mantiene tu control al día sin esfuerzo',
      },
      {
        id: 'sabe_que_tiene', emoji: '🔎',
        pregunta: '¿Sabés siempre qué productos tenés disponibles?',
        detalle:  'Para no prometer algo que no está',
        si_label: 'No, a veces dudo', no_label: 'Sí, lo sé al detalle',
        si_resuelve: '🔎 Listado de productos con disponible / sin stock',
        no_resuelve: '🔎 SAU lo refleja al instante en cada venta',
        invertida: true,
      },
    ],
  },

  presupuestos: {
    grupo: 'Presupuestos',
    preguntas: [
      {
        id: 'hace_manual', emoji: '📋',
        pregunta: '¿Armás los presupuestos a mano o de memoria?',
        detalle:  'Papel, mensaje, o los calculás en la cabeza',
        si_label: 'Sí, a mano o de memoria', no_label: 'No, tengo algún sistema',
        si_resuelve: '⚡ Presupuestos digitales en 2 minutos desde el celu',
        no_resuelve: '🚀 SAU reemplaza tu sistema con algo más rápido',
      },
      {
        id: 'precios_cambian', emoji: '🏷️',
        pregunta: '¿Los precios de lo que cotizás cambian seguido?',
        detalle:  'Tenés que estar actualizándolos a cada rato',
        si_label: 'Sí, cambian seguido', no_label: 'No, son bastante fijos',
        si_resuelve: '🏷️ Actualizás precios una vez y quedan en todos lados',
        no_resuelve: '📋 Lista de precios estable lista para usar',
      },
      {
        id: 'perdio_cliente', emoji: '😬',
        pregunta: '¿Perdiste alguna venta por tardar en pasar el precio?',
        detalle:  'El cliente se fue con otro que respondió antes',
        si_label: 'Sí, me pasó', no_label: 'No, respondo rápido',
        si_resuelve: '🎯 Presupuesto listo para enviar en el momento',
        no_resuelve: '✅ SAU mantiene esa velocidad con mejor presentación',
      },
      {
        id: 'usa_whatsapp', emoji: '📲',
        pregunta: '¿Mandás los presupuestos por WhatsApp?',
        detalle:  'Para enviárselos rápido a los clientes',
        si_label: 'Sí, siempre por WA', no_label: 'No, uso otro medio',
        si_resuelve: '📲 Botón de envío directo por WhatsApp',
        no_resuelve: '📄 PDF listo para enviar por donde quieras',
      },
      {
        id: 'hace_seguimiento', emoji: '🔔',
        pregunta: '¿Hacés seguimiento de si el cliente aceptó o no?',
        detalle:  'Llamado, mensaje, recordatorio...',
        si_label: 'Sí, les hago seguimiento', no_label: 'No, mando y espero',
        si_resuelve: '✅ Seguimiento integrado en cada presupuesto',
        no_resuelve: '🔔 SAU te marca los presupuestos sin respuesta',
      },
    ],
  },

  compras: {
    grupo: 'Compras y gastos',
    preguntas: [
      {
        id: 'registra_gastos', emoji: '🧾',
        pregunta: '¿Llevás registro de lo que gastás en mercadería?',
        detalle:  'Para saber cuánto te cuesta de verdad lo que vendés',
        si_label: 'Sí, lo anoto', no_label: 'No, calculo aproximado',
        si_resuelve: '🧾 Registro de compras y gastos ordenado',
        no_resuelve: '📉 SAU te muestra el costo real de tu negocio',
      },
    ],
  },

  caja: {
    grupo: 'Caja',
    preguntas: [
      {
        id: 'cierra_caja', emoji: '💵',
        pregunta: '¿Te cuesta saber cuánta plata te quedó al final del día?',
        detalle:  'Entre lo que entró, lo que saliste a pagar y el vuelto',
        si_label: 'Sí, es un lío', no_label: 'No, lo tengo claro',
        si_resuelve: '💵 Cierre de caja diario, claro y al toque',
        no_resuelve: '💵 SAU mantiene ese orden automáticamente',
      },
    ],
  },

  fiado: {
    grupo: 'Fiado',
    preguntas: [
      {
        id: 'clientes_deben', emoji: '📒',
        pregunta: '¿Tenés clientes que compran y te pagan después?',
        detalle:  'El típico fiado de confianza',
        si_label: 'Sí, fío bastante', no_label: 'No, cobro al momento',
        si_resuelve: '📒 Libreta de fiado por cliente, con historial y límites',
        no_resuelve: '💵 Control de cobros al día',
      },
      {
        id: 'anota_papelitos', emoji: '🗒️',
        pregunta: '¿Anotás el fiado en un cuaderno o papelitos?',
        detalle:  'Y a veces se pierden o no te acordás quién debe',
        si_label: 'Sí, todo a papel', no_label: 'No, ya lo tengo digital',
        si_resuelve: '🗒️ Todo el fiado en el celu, sin papelitos perdidos',
        no_resuelve: '🚀 SAU ordena lo que ya venías haciendo',
      },
    ],
  },

  equipo: {
    grupo: 'Equipo',
    preguntas: [
      {
        id: 'tiene_equipo', emoji: '👥',
        pregunta: '¿Trabajás con empleados o ayudantes?',
        detalle:  'Gente que carga ventas o atiende por vos',
        si_label: 'Sí, tengo gente', no_label: 'No, trabajo solo',
        si_resuelve: '👷 Cada empleado con su usuario y sus permisos',
        no_resuelve: '💪 SAU configurado para trabajar solo',
      },
    ],
  },
}

// Orden en que aparecen los grupos (los que no estén acá van al final)
const ORDEN = ['ventas', 'presupuestos', 'stock', 'compras', 'caja', 'fiado', 'equipo']

/** Arma la lista de preguntas según los módulos activos de la empresa. */
export function preguntasParaModulos(modulos = []) {
  const ids = ORDEN.filter(id => modulos.includes(id))
  // por las dudas, agregar cualquier módulo activo que no esté en ORDEN
  for (const m of modulos) if (!ids.includes(m) && BANCOS[m]) ids.push(m)
  return ids.flatMap(id =>
    (BANCOS[id]?.preguntas || []).map(p => ({ ...p, grupo: BANCOS[id].grupo }))
  )
}

export default function Cuestionario() {
  const { empresaActiva, empresaActivaId, recargarEmpresa } = useAuth()
  const navigate    = useNavigate()
  const [intro,      setIntro]      = useState(true)
  const [paso,       setPaso]       = useState(0)
  const [respuestas, setRespuestas] = useState({})
  const [animKey,    setAnimKey]    = useState(0)
  const [listo,      setListo]      = useState(false)
  const [guardando,  setGuardando]  = useState(false)

  const PREGUNTAS = preguntasParaModulos(empresaActiva?.modulos_activos || [])
  const pregunta  = PREGUNTAS[paso]
  const progreso  = PREGUNTAS.length ? (paso / PREGUNTAS.length) * 100 : 0
  const nombre    = empresaActiva?.nombre_fantasia?.split(' ')[0] || 'acá'

  async function responder(valor) {
    const nuevas = { ...respuestas, [pregunta.id]: valor }
    setRespuestas(nuevas)
    if (paso < PREGUNTAS.length - 1) {
      setAnimKey(k => k + 1)
      setPaso(p => p + 1)
    } else {
      await guardar(nuevas)
    }
  }

  async function guardar(config) {
    setGuardando(true)
    await supabase.from('empresa').update({ configuracion: config }).eq('id', empresaActivaId)
    await recargarEmpresa()
    setListo(true)
    setGuardando(false)
  }

  // ── Sin preguntas para sus módulos: entra directo ─────────────────
  if (PREGUNTAS.length === 0 && !listo) {
    guardar({})
    return null
  }

  // ── Cargando ──────────────────────────────────────────────────────
  if (guardando) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        <p className="text-zinc-400 font-semibold">Configurando tu SAU...</p>
      </div>
    )
  }

  // ── Pantalla intro ────────────────────────────────────────────────
  if (intro) {
    // Mostramos los temas (grupos) que va a tocar, según sus módulos
    const temas = [...new Set(PREGUNTAS.map(p => p.grupo))]
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <style>{ANIM_CSS}</style>
        <div className="pop-in w-full max-w-sm grid gap-6 text-center">

          <div>
            <p className="text-5xl mb-4">👋</p>
            <h1 className="text-white font-extrabold text-3xl leading-tight">
              Antes de arrancar,<br />
              <span className="text-emerald-400">necesito conocer<br />tu negocio</span>
            </h1>
            <p className="text-zinc-500 text-sm mt-3 leading-relaxed">
              {PREGUNTAS.length} preguntas. Solo SÍ o NO.<br />
              Con eso SAU se configura para vos.
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-left grid gap-2">
            {temas.map((t, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-emerald-500 text-xs font-black shrink-0">→</span>
                <p className="text-zinc-400 text-sm">{t}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setIntro(false)}
            className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-xl shadow-2xl shadow-emerald-500/30 active:scale-95 transition-all">
            Arrancar →
          </button>

          <p className="text-zinc-700 text-xs">Menos de 2 minutos</p>
        </div>
      </div>
    )
  }

  // ── Resultado final ───────────────────────────────────────────────
  if (listo) {
    const soluciones = PREGUNTAS.map(p => {
      const r = respuestas[p.id]
      return r ? p.si_resuelve : p.no_resuelve
    })

    return (
      <div className="min-h-screen bg-zinc-950 overflow-y-auto">
        <style>{ANIM_CSS}</style>
        <div className="max-w-sm mx-auto px-6 py-10 grid gap-6">

          <div className="pop-in text-center">
            <p className="text-6xl mb-3">🎯</p>
            <h2 className="text-white font-extrabold text-2xl">¡Listo, {nombre}!</h2>
            <p className="text-zinc-500 text-sm mt-2">
              Basado en cómo trabajás, SAU quedó configurado para resolver tus problemas reales
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
            <p className="text-zinc-600 text-[0.6rem] font-bold uppercase tracking-widest mb-1">SAU configurado para vos</p>
            {soluciones.map((s, i) => (
              <div key={i} className="flex items-center gap-3 py-1 border-b border-zinc-800/50 last:border-0">
                <span className="text-emerald-500 font-black text-sm shrink-0">✓</span>
                <p className="text-zinc-300 text-sm">{s}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-xl shadow-2xl shadow-emerald-500/30 active:scale-95 transition-all">
            Entrar a SAU →
          </button>
        </div>
      </div>
    )
  }

  // ── Pregunta activa ───────────────────────────────────────────────
  const grupoActual = pregunta.grupo
  const grupoCambio = paso === 0 || PREGUNTAS[paso - 1]?.grupo !== grupoActual

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <style>{ANIM_CSS}</style>

      {/* Barra de progreso */}
      <div className="w-full h-1.5 bg-zinc-800 shrink-0">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${progreso}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex justify-between items-center px-6 pt-4 pb-2">
        <div className="flex gap-1.5 items-center">
          {PREGUNTAS.map((_, i) => (
            <div key={i} className={`rounded-full transition-all duration-300 ${
              i < paso   ? 'w-4 h-2 bg-emerald-500' :
              i === paso ? 'w-4 h-2 bg-white' :
                           'w-2 h-2 bg-zinc-800'
            }`} />
          ))}
        </div>
        <p className="text-zinc-600 text-xs font-mono">{paso + 1} / {PREGUNTAS.length}</p>
      </div>

      {/* Grupo (si cambia) */}
      {grupoCambio && (
        <div className="px-6 pt-2">
          <span className="text-[0.6rem] font-bold uppercase tracking-widest text-zinc-600 bg-zinc-900 px-2.5 py-1 rounded-full border border-zinc-800">
            {grupoActual}
          </span>
        </div>
      )}

      {/* Pregunta */}
      <div className="flex-1 flex items-center justify-center px-6 py-6">
        <div key={animKey} className="slide-in w-full max-w-sm grid gap-8">

          <div className="text-center grid gap-3">
            <div className="text-7xl leading-none">{pregunta.emoji}</div>
            <h2 className="text-white font-extrabold text-2xl leading-snug">
              {pregunta.pregunta}
            </h2>
            <p className="text-zinc-500 text-sm leading-relaxed">{pregunta.detalle}</p>
          </div>

          <div className="grid gap-3">
            {/* SÍ */}
            <button
              onClick={() => responder(true)}
              className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-xl shadow-emerald-500/20 active:scale-95 transition-all">
              ✓ &nbsp; Sí
            </button>

            {/* NO */}
            <button
              onClick={() => responder(false)}
              className="w-full py-5 rounded-3xl bg-zinc-900 border-2 border-zinc-700 text-zinc-300 font-extrabold text-lg active:scale-95 transition-all">
              ✗ &nbsp; No
            </button>
          </div>

          {/* Label descriptivo debajo */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <p className="text-zinc-700 text-xs leading-snug">{pregunta.si_label}</p>
            <p className="text-zinc-700 text-xs leading-snug">{pregunta.no_label}</p>
          </div>

        </div>
      </div>
    </div>
  )
}
