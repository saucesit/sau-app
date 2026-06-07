import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, hoyISO } from '../lib/format'

// ── Gráfico de barras (últimos 7 días) ───────────────────────────
function BarChart({ datos }) {
  const max = Math.max(...datos.map(d => d.total), 1)
  const hoy = hoyISO()
  const DIAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

  return (
    <div>
      <div className="flex items-end gap-2 h-14">
        {datos.map((d, i) => {
          const esHoy = d.fecha === hoy
          const h = Math.max((d.total / max) * 100, d.total > 0 ? 6 : 2)
          return (
            <div key={i} className="flex-1 flex flex-col justify-end">
              <div
                className={`w-full rounded-t-lg transition-all duration-500 ${
                  esHoy ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
                style={{ height: `${h}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 mt-2">
        {datos.map((d, i) => {
          const esHoy = d.fecha === hoy
          return (
            <div key={i} className="flex-1 text-center">
              <span className={`text-[0.6rem] font-bold ${esHoy ? 'text-emerald-500' : 'text-slate-300'}`}>
                {DIAS[new Date(d.fecha + 'T12:00').getDay()]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Insight chip ──────────────────────────────────────────────────
function Insight({ icon, texto, tipo }) {
  const estilos = {
    bueno:  'bg-emerald-50 border-emerald-100 text-emerald-700',
    malo:   'bg-red-50 border-red-100 text-red-600',
    aviso:  'bg-amber-50 border-amber-100 text-amber-700',
    neutro: 'bg-indigo-50 border-indigo-100 text-indigo-700',
  }
  return (
    <div className={`flex items-start gap-3 px-4 py-3.5 rounded-2xl border ${estilos[tipo] || estilos.neutro}`}>
      <span className="text-lg shrink-0">{icon}</span>
      <p className="text-sm font-medium leading-snug">{texto}</p>
    </div>
  )
}

// ── Lógica de períodos ────────────────────────────────────────────
const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: '7 días' },
  { id: 'mes',    label: 'Este mes' },
]

function rangoPeriodo(id) {
  const hoy = new Date()
  const fHoy = hoy.toISOString().slice(0, 10)
  if (id === 'hoy') {
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1)
    return { inicio: fHoy, inicioPrev: ayer.toISOString().slice(0, 10), finPrev: fHoy }
  }
  if (id === 'semana') {
    const d6 = new Date(hoy); d6.setDate(d6.getDate() - 6)
    const d13 = new Date(hoy); d13.setDate(d13.getDate() - 13)
    return { inicio: d6.toISOString().slice(0, 10), inicioPrev: d13.toISOString().slice(0, 10), finPrev: d6.toISOString().slice(0, 10) }
  }
  const primerMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const mesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  return { inicio: primerMes, inicioPrev: mesAnt.toISOString().slice(0, 10), finPrev: primerMes }
}

// ── Modal activar modo real ───────────────────────────────────────
function ModalActivar({ onConfirmar, onCerrar, activando }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-5">
      <div className="bg-white rounded-3xl p-6 w-full max-w-[400px] shadow-2xl">
        <p className="text-5xl text-center mb-4">🚀</p>
        <h3 className="text-xl font-extrabold text-slate-800 text-center mb-2">¿Listo para empezar de verdad?</h3>
        <p className="text-sm text-slate-500 text-center leading-relaxed mb-6">
          Vas a activar el modo real. Los datos de práctica quedan archivados y no afectan nada.
          Desde este momento, <strong>todo lo que cargues cuenta para tus declaraciones fiscales.</strong>
        </p>
        <div className="grid gap-3">
          <button onClick={onConfirmar} disabled={activando}
            className="w-full py-4 rounded-3xl bg-emerald-600 text-white font-extrabold shadow-lg shadow-emerald-100 active:scale-95 transition-all disabled:opacity-50"
          >
            {activando ? 'Activando…' : '🚀 Sí, activar modo real'}
          </button>
          <button onClick={onCerrar}
            className="w-full py-3 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all"
          >
            Todavía no
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────
export default function Dashboard() {
  const { empresaActivaId, empresaActiva, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const [periodo, setPeriodo]         = useState('hoy')
  const [datos, setDatos]             = useState(null)
  const [cargando, setCargando]       = useState(true)
  const [modalActivar, setModalActivar] = useState(false)
  const [activando, setActivando]     = useState(false)

  const esPractica = empresaActiva?.modo_simulacion ?? false

  useEffect(() => {
    if (!empresaActivaId) { setCargando(false); return }
    let cancelado = false
    ;(async () => {
      setCargando(true)
      const { inicio, inicioPrev, finPrev } = rangoPeriodo(periodo)
      const hoy = hoyISO()
      const hace30 = new Date(); hace30.setDate(hace30.getDate() - 29)
      const hace30ISO = hace30.toISOString().slice(0, 10)

      const [
        { data: ventasPeriodo },
        { data: ventasPrev },
        { data: comprasPeriodo },
        { data: gastosPeriodo },
        { data: cajaPeriodo },
        { data: ventasDiarias },
      ] = await Promise.all([
        supabase.from('venta').select('total, tipo_registro, medio_pago')
          .eq('empresa_id', empresaActivaId).eq('es_simulacion', esPractica)
          .gte('fecha', inicio).lte('fecha', hoy),
        supabase.from('venta').select('total')
          .eq('empresa_id', empresaActivaId).eq('es_simulacion', esPractica)
          .gte('fecha', inicioPrev).lt('fecha', finPrev),
        supabase.from('compra').select('total')
          .eq('empresa_id', empresaActivaId).eq('es_simulacion', esPractica)
          .gte('fecha', inicio).lte('fecha', hoy),
        supabase.from('gasto').select('monto')
          .eq('empresa_id', empresaActivaId).eq('es_simulacion', esPractica)
          .gte('fecha', inicio).lte('fecha', hoy),
        supabase.from('movimiento_caja').select('tipo, monto')
          .eq('empresa_id', empresaActivaId).eq('es_simulacion', esPractica)
          .gte('fecha', inicio).lte('fecha', hoy),
        supabase.from('venta').select('fecha, total')
          .eq('empresa_id', empresaActivaId).eq('es_simulacion', esPractica)
          .gte('fecha', hace30ISO).lte('fecha', hoy).order('fecha'),
      ])

      if (cancelado) return
      setDatos({ ventasPeriodo, ventasPrev, comprasPeriodo, gastosPeriodo, cajaPeriodo, ventasDiarias })
      setCargando(false)
    })()
    return () => { cancelado = true }
  }, [empresaActivaId, periodo, esPractica])

  const metricas = useMemo(() => {
    if (!datos) return null
    const { ventasPeriodo, ventasPrev, comprasPeriodo, gastosPeriodo, cajaPeriodo } = datos
    const ventas    = (ventasPeriodo || []).reduce((s, v) => s + Number(v.total), 0)
    const ventasAnt = (ventasPrev   || []).reduce((s, v) => s + Number(v.total), 0)
    const compras   = (comprasPeriodo|| []).reduce((s, v) => s + Number(v.total), 0)
    const gastos    = (gastosPeriodo || []).reduce((s, v) => s + Number(v.monto), 0)
    const egresos   = compras + gastos
    const margen    = ventas > 0 ? ((ventas - egresos) / ventas * 100) : null
    const caja      = (cajaPeriodo  || []).reduce(
      (s, m) => s + (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto)), 0,
    )
    const tendencia  = ventasAnt > 0 ? ((ventas - ventasAnt) / ventasAnt * 100) : null
    const fiscal     = (ventasPeriodo || []).filter(v => v.tipo_registro === 'fiscal').reduce((s, v) => s + Number(v.total), 0)
    const cantVentas = (ventasPeriodo || []).length
    return { ventas, ventasAnt, compras, gastos, egresos, margen, caja, tendencia, fiscal, cantVentas }
  }, [datos])

  const chart7dias = useMemo(() => {
    const porDia = {}
    ;(datos?.ventasDiarias || []).forEach(v => {
      porDia[v.fecha] = (porDia[v.fecha] || 0) + Number(v.total)
    })
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 6 + i)
      const fecha = d.toISOString().slice(0, 10)
      return { fecha, total: porDia[fecha] || 0 }
    })
  }, [datos])

  const insights = useMemo(() => {
    if (!metricas || cargando || esPractica) return []
    const { ventas, tendencia, margen, egresos, compras, gastos, fiscal } = metricas
    const result = []
    if (tendencia !== null) {
      const pct = Math.abs(tendencia).toFixed(0)
      const sube = tendencia > 0
      const ref = { hoy: 'ayer', semana: 'la semana pasada', mes: 'el mes pasado' }[periodo]
      result.push({
        icon: sube ? '📈' : tendencia < -5 ? '📉' : '➡️',
        tipo: sube ? 'bueno' : tendencia < -10 ? 'malo' : 'aviso',
        texto: `Ventas ${sube ? '+' : '-'}${pct}% respecto a ${ref}`,
      })
    }
    if (margen !== null && egresos > 0) {
      result.push({
        icon: margen >= 35 ? '✅' : margen >= 15 ? '⚠️' : '🚨',
        tipo: margen >= 35 ? 'bueno' : margen >= 15 ? 'aviso' : 'malo',
        texto: `Margen bruto ${margen.toFixed(1)}%${margen < 15 ? ' — revisá tus gastos' : margen >= 40 ? ' — muy saludable' : ''}`,
      })
    }
    if (ventas > 0 && fiscal < ventas * 0.9 && egresos > 0) {
      result.push({
        icon: '🧾',
        tipo: 'aviso',
        texto: `${(fiscal / ventas * 100).toFixed(0)}% de las ventas son fiscales (${formatPesos(fiscal)})`,
      })
    }
    return result.slice(0, 3)
  }, [metricas, periodo, cargando, esPractica])

  async function activarModoReal() {
    setActivando(true)
    await supabase.from('empresa').update({ modo_simulacion: false }).eq('id', empresaActivaId)
    setActivando(false)
    setModalActivar(false)
    window.location.reload()
  }

  if (!empresaActivaId) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-5xl mb-3">🏢</p>
        <p className="font-medium">No estás asignado a ninguna empresa.</p>
      </div>
    )
  }

  const V = metricas?.ventas ?? 0
  const G = metricas?.egresos ?? 0
  const M = metricas?.margen ?? null
  const C = metricas?.caja ?? 0
  const T = metricas?.tendencia ?? null
  const topInsight = insights[0] ?? null

  return (
    <div className="grid gap-6 pb-2">

      {/* Banner modo práctica — discreto */}
      {esPractica && (
        <button onClick={() => setModalActivar(true)}
          className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">🟡</span>
            <p className="text-sm font-bold text-amber-700">Modo práctica activo</p>
          </div>
          <span className="text-xs text-amber-500 font-semibold">Activar real →</span>
        </button>
      )}

      {/* Selector de período — minimal */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1">
        {PERIODOS.map(p => (
          <button key={p.id} onClick={() => setPeriodo(p.id)}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
              periodo === p.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-400'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Número protagonista */}
      <div className="px-1">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
          Ventas{esPractica ? ' · práctica' : ''}
          {metricas && !cargando &&
            <span className="ml-2 normal-case font-normal">
              · {metricas.cantVentas} {metricas.cantVentas === 1 ? 'operación' : 'operaciones'}
            </span>
          }
        </p>

        <p className={`font-black tracking-tight leading-none transition-all ${
          cargando ? 'text-slate-200' : 'text-slate-900'
        }`}
          style={{ fontSize: 'clamp(2.8rem, 12vw, 3.8rem)' }}
        >
          {cargando ? '···' : formatPesos(V)}
        </p>

        {T !== null && !cargando && (
          <p className={`text-sm font-bold mt-2 ${T >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
            {T >= 0 ? '▲' : '▼'} {Math.abs(T).toFixed(1)}% vs período anterior
          </p>
        )}

        {/* Bar chart integrado, sin wrapper */}
        <div className="mt-5">
          <BarChart datos={chart7dias} />
        </div>
      </div>

      {/* Sub-métricas en una línea */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4 px-1">
        <div className="text-center">
          <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-1">Gastos</p>
          <p className="text-sm font-extrabold text-rose-500">
            {cargando ? '—' : formatPesos(G)}
          </p>
        </div>
        <div className="w-px h-8 bg-slate-100" />
        <div className="text-center">
          <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-1">Margen</p>
          <p className={`text-sm font-extrabold ${
            M === null ? 'text-slate-300'
            : M >= 30 ? 'text-emerald-600'
            : M >= 15 ? 'text-amber-500'
            : 'text-red-500'
          }`}>
            {cargando ? '—' : M === null ? '—' : `${M.toFixed(0)}%`}
          </p>
        </div>
        <div className="w-px h-8 bg-slate-100" />
        <div className="text-center">
          <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-1">Caja</p>
          <p className={`text-sm font-extrabold ${C < 0 ? 'text-red-500' : 'text-slate-800'}`}>
            {cargando ? '—' : formatPesos(C)}
          </p>
        </div>
      </div>

      {/* Top insight — solo el más importante */}
      {topInsight && (
        <Insight icon={topInsight.icon} texto={topInsight.texto} tipo={topInsight.tipo} />
      )}

      {/* Botón principal — Nueva venta */}
      {tienePermiso('ventas.crear') && (
        <button onClick={() => navigate('/vender')}
          className="w-full py-5 rounded-full bg-emerald-500 text-white font-extrabold text-lg active:scale-95 transition-all flex items-center justify-center gap-3"
          style={{ boxShadow: '0 8px 32px rgba(16, 185, 129, 0.35)' }}
        >
          Nueva venta
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      )}

      {/* Acciones secundarias */}
      <div className="grid grid-cols-2 gap-3">
        {tienePermiso('caja.ver') && (
          <button onClick={() => navigate('/caja')}
            className="bg-white text-slate-700 rounded-3xl py-5 font-bold shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1.5 border border-slate-100"
          >
            <span className="text-2xl">💵</span>
            <span className="text-sm">Caja</span>
          </button>
        )}
        {tienePermiso('ventas.ver') && (
          <button onClick={() => navigate('/historial')}
            className="bg-white text-slate-700 rounded-3xl py-5 font-bold shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1.5 border border-slate-100"
          >
            <span className="text-2xl">📋</span>
            <span className="text-sm">Historial</span>
          </button>
        )}
      </div>

      {/* Modal activar modo real */}
      {modalActivar && (
        <ModalActivar
          onConfirmar={activarModoReal}
          onCerrar={() => setModalActivar(false)}
          activando={activando}
        />
      )}

    </div>
  )
}
