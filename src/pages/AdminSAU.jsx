import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos } from '../lib/format'
import { MODULOS } from '../lib/modulos'

// ── Animación flotante ────────────────────────────────────────────
const FLOAT_STYLE = `
  @keyframes float {
    0%, 100% { transform: translateY(0px) scale(1); }
    50%       { transform: translateY(-10px) scale(1.03); }
  }
  .burbuja { animation: float 3.5s ease-in-out infinite; }
`

// ── Helpers ───────────────────────────────────────────────────────
function iniciales(nombre) {
  return (nombre || '?').trim().split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase()
}
function diasDesde(fecha) {
  if (!fecha) return null
  const dias = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 7)   return `hace ${dias}d`
  if (dias < 30)  return `hace ${Math.floor(dias/7)}sem`
  return `hace ${Math.floor(dias/30)}m`
}
function saludo() {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

const BURBUJA = {
  activo:     { grad: 'from-emerald-400 to-emerald-600', glow: 'shadow-emerald-500/50', ring: 'ring-emerald-300' },
  gratuito:   { grad: 'from-amber-300   to-amber-500',   glow: 'shadow-amber-400/50',   ring: 'ring-amber-200'   },
  atrasado:   { grad: 'from-red-400     to-red-600',     glow: 'shadow-red-500/50',     ring: 'ring-red-300'     },
  suspendido: { grad: 'from-zinc-500    to-zinc-700',    glow: 'shadow-zinc-500/40',    ring: 'ring-zinc-400'    },
}

const SUSCRIPCION = {
  gratuito:   { label: 'Gratuito',   bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400'   },
  activo:     { label: 'Al día',     bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  atrasado:   { label: 'Atrasado',   bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-500'     },
  suspendido: { label: 'Suspendido', bg: 'bg-zinc-100',   text: 'text-zinc-500',    dot: 'bg-zinc-400'    },
}

// ── Generador de insights tipo Jarvis ─────────────────────────────
function generarInsights(clientes, statsMap) {
  const insights = []

  clientes.forEach(c => {
    const stats  = statsMap[c.id]
    const nombre = c.nombre_fantasia || c.razon_social
    const mods   = c.modulos_activos || []
    const dias   = stats?.ultima_actividad
      ? Math.floor((Date.now() - new Date(stats.ultima_actividad).getTime()) / 86400000)
      : 999

    // 🔴 Riesgos
    if (dias === 999) {
      insights.push({ tipo:'riesgo', emoji:'🔴', titulo:`${nombre} nunca usó el sistema`, sub:'Hay que activarlo cuanto antes', accion:'Activar', cid:c.id, p:0 })
    } else if (dias > 14) {
      insights.push({ tipo:'riesgo', emoji:'🔴', titulo:`${nombre} lleva ${dias} días sin actividad`, sub:'Riesgo de abandono — contactar', accion:'Llamar', cid:c.id, p:0 })
    }

    // 🟢 Wins
    if (stats?.crecimiento > 20) {
      insights.push({ tipo:'win', emoji:'🟢', titulo:`${nombre} creció ${stats.crecimiento}% este mes`, sub:'Buen momento para hablarle de nuevas funciones', accion:'Ver', cid:c.id, p:2 })
    }

    // 🟡 Oportunidades de módulos
    if (mods.includes('ventas') && !mods.includes('fiado') && (stats?.ventas_mes || 0) > 5) {
      insights.push({ tipo:'oportunidad', emoji:'🟡', titulo:`${nombre} no usa Fiado`, sub:`Tiene ${stats.ventas_mes} ventas este mes — probablemente vende a cuenta`, accion:'Activar', cid:c.id, p:1 })
    }
    if (mods.includes('ventas') && !mods.includes('stock') && (stats?.ventas_mes || 0) > 10) {
      insights.push({ tipo:'oportunidad', emoji:'🟡', titulo:`${nombre} no usa Stock`, sub:'Con ese volumen de ventas el inventario los ayudaría', accion:'Activar', cid:c.id, p:1 })
    }
    if (mods.includes('ventas') && !mods.includes('compras') && (stats?.ventas_mes || 0) > 8) {
      insights.push({ tipo:'oportunidad', emoji:'🟡', titulo:`${nombre} no registra sus compras`, sub:'Sin compras no pueden ver el margen real del negocio', accion:'Activar', cid:c.id, p:1 })
    }

    // 📊 Uso bajo del sistema
    const adopcion = mods.length / MODULOS.length
    if (adopcion < 0.4 && dias < 30) {
      insights.push({ tipo:'info', emoji:'📊', titulo:`${nombre} usa solo ${mods.length} de ${MODULOS.length} módulos`, sub:'El sistema puede darles mucho más valor', accion:'Revisar', cid:c.id, p:2 })
    }
  })

  return insights.sort((a, b) => a.p - b.p)
}

// ── Colores de insight ────────────────────────────────────────────
const INSIGHT_ESTILO = {
  riesgo:      { border: 'border-l-red-500',     bg: 'bg-red-950/40',    badge: 'bg-red-500/20 text-red-400'     },
  oportunidad: { border: 'border-l-amber-400',   bg: 'bg-amber-950/40',  badge: 'bg-amber-500/20 text-amber-400' },
  win:         { border: 'border-l-emerald-500', bg: 'bg-emerald-950/40',badge: 'bg-emerald-500/20 text-emerald-400' },
  info:        { border: 'border-l-indigo-400',  bg: 'bg-indigo-950/40', badge: 'bg-indigo-500/20 text-indigo-400'   },
}

// ── Modal detalle cliente ─────────────────────────────────────────
function DetalleCliente({ cliente, stats, onCerrar, onActualizado }) {
  const [notas,    setNotas]    = useState(cliente.notas_admin || '')
  const [estado,   setEstado]   = useState(cliente.estado_suscripcion || 'gratuito')
  const [modulos,  setModulos]  = useState(cliente.modulos_activos || [])
  const [guardando,setGuardando]= useState(false)
  const [guardado, setGuardado] = useState(false)

  async function guardar() {
    setGuardando(true)
    await supabase.from('empresa').update({
      notas_admin: notas, estado_suscripcion: estado, modulos_activos: modulos,
    }).eq('id', cliente.id)
    setGuardando(false); setGuardado(true)
    setTimeout(() => setGuardado(false), 2000)
    onActualizado()
  }

  function toggleModulo(id) {
    const mod = MODULOS.find(m => m.id === id)
    if (mod?.nucleo) return
    setModulos(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])
  }

  const bur = BURBUJA[estado] || BURBUJA.gratuito

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-[560px] rounded-t-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-zinc-900 px-5 pt-5 pb-4 border-b border-zinc-800 flex items-center gap-3 rounded-t-[2rem]">
          <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${bur.grad} flex items-center justify-center text-white font-extrabold text-lg shrink-0`}>
            {iniciales(cliente.nombre_fantasia || cliente.razon_social)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold text-white truncate">{cliente.nombre_fantasia || cliente.razon_social}</h2>
            <p className="text-xs text-zinc-500">{cliente.cuit && `CUIT ${cliente.cuit} · `}{cliente.condicion_fiscal}</p>
          </div>
          <button onClick={onCerrar} className="w-10 h-10 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xl">×</button>
        </div>

        <div className="px-5 py-4 grid gap-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Ventas este mes', value: stats?.ventas_mes ?? '—' },
              { label: 'Miembros',        value: stats?.miembros    ?? '—' },
              { label: 'Última actividad',value: diasDesde(stats?.ultima_actividad) || 'Nunca' },
            ].map(s => (
              <div key={s.label} className="bg-zinc-800 rounded-2xl px-3 py-3 text-center">
                <p className="text-xl font-extrabold text-white">{s.value}</p>
                <p className="text-[0.6rem] text-zinc-500 font-semibold uppercase tracking-widest mt-0.5 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Adopción de módulos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest">Módulos activos</p>
              <p className="text-xs text-zinc-400 font-bold">{modulos.length}/{MODULOS.length}</p>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-2 mb-3">
              <div className="bg-emerald-500 h-2 rounded-full transition-all"
                style={{ width: `${(modulos.length / MODULOS.length) * 100}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MODULOS.map(m => {
                const activo = modulos.includes(m.id)
                return (
                  <button key={m.id} onClick={() => toggleModulo(m.id)} disabled={m.nucleo}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl text-sm font-bold transition-all ${
                      activo ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-600'
                    } ${m.nucleo ? 'opacity-60 cursor-not-allowed' : ''}`}>
                    <span>{m.icon}</span>
                    <span className="flex-1 text-left truncate">{m.titulo.split(' ')[0]}</span>
                    {!m.nucleo && <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[0.5rem] font-black ${activo ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-600'}`}>{activo ? '✓' : ''}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Estado suscripción */}
          <div>
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest mb-2">Estado de cuenta</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SUSCRIPCION).map(([id, cfg]) => (
                <button key={id} onClick={() => setEstado(id)}
                  className={`py-2.5 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                    estado === id ? `${cfg.bg} ${cfg.text} ring-2 ring-current ring-offset-1 ring-offset-zinc-900` : 'bg-zinc-800 text-zinc-500'
                  }`}>
                  <span className={`w-2 h-2 rounded-full ${estado === id ? cfg.dot : 'bg-zinc-600'}`} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notas */}
          <div>
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest mb-2">Mis notas privadas</p>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3}
              placeholder="Solo vos ves esto..."
              className="w-full px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 outline-none text-zinc-300 placeholder:text-zinc-700 resize-none text-sm focus:border-emerald-500 transition-colors"
            />
          </div>

          <button onClick={guardar} disabled={guardando}
            className={`w-full py-4 rounded-3xl font-extrabold text-base active:scale-95 transition-all ${
              guardado ? 'bg-emerald-500 text-white' : 'bg-white text-zinc-900'
            }`}>
            {guardando ? 'Guardando…' : guardado ? '✓ Guardado' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Consultas de audio ────────────────────────────────────────────
function Consultas() {
  const [consultas, setConsultas] = useState([])

  async function cargar() {
    const { data } = await supabase.from('consulta_sau').select('*').order('created_at', { ascending: false }).limit(10)
    setConsultas(data || [])
  }

  async function cambiarEstado(id, estado) {
    await supabase.from('consulta_sau').update({ estado }).eq('id', id)
    cargar()
  }

  useEffect(() => { cargar() }, [])

  const nuevas = consultas.filter(c => c.estado === 'nueva').length
  if (consultas.length === 0) return null

  return (
    <div className="grid gap-3">
      <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest flex items-center gap-2">
        🎤 Audios entrantes
        {nuevas > 0 && <span className="bg-red-500 text-white text-[0.6rem] font-black px-1.5 py-0.5 rounded-full animate-pulse">{nuevas}</span>}
      </p>
      {consultas.map(c => (
        <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-white font-bold text-sm">{c.nombre || 'Anónimo'}</p>
              <p className="text-zinc-600 text-xs">{c.telefono && `${c.telefono} · `}{new Date(c.created_at).toLocaleDateString('es-AR')}</p>
            </div>
            <select value={c.estado} onChange={e => cambiarEstado(c.id, e.target.value)}
              className="text-xs font-bold px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 outline-none text-zinc-400">
              <option value="nueva">🔴 Nueva</option>
              <option value="en_proceso">🟡 En proceso</option>
              <option value="resuelta">🟢 Resuelta</option>
            </select>
          </div>
          <audio src={c.audio_url} controls className="w-full rounded-xl" />
        </div>
      ))}
      <div className="h-px bg-zinc-800" />
    </div>
  )
}

// ── Burbuja ───────────────────────────────────────────────────────
function Burbuja({ cliente, stats, index, onClick }) {
  const estado = cliente.estado_suscripcion || 'gratuito'
  const bur    = BURBUJA[estado] || BURBUJA.gratuito
  const nombre = cliente.nombre_fantasia || cliente.razon_social || '?'
  const dias   = stats?.ultima_actividad
    ? Math.floor((Date.now() - new Date(stats.ultima_actividad).getTime()) / 86400000)
    : 999
  const saludRing = dias > 14 ? 'ring-red-500' : dias > 7 ? 'ring-amber-400' : 'ring-emerald-400'

  return (
    <div className="flex flex-col items-center gap-2 cursor-pointer" onClick={onClick}>
      <button
        className={`burbuja w-20 h-20 rounded-full bg-gradient-to-br ${bur.grad}
          shadow-xl ${bur.glow} ring-2 ${saludRing} ring-offset-2 ring-offset-zinc-950
          flex items-center justify-center active:scale-90 transition-transform`}
        style={{ animationDelay: `${(index % 8) * 0.4}s` }}
      >
        <span className="text-white font-black text-xl drop-shadow">{iniciales(nombre)}</span>
      </button>
      <div className="text-center">
        <p className="text-zinc-300 text-xs font-semibold truncate max-w-[80px]">{nombre}</p>
        <p className="text-zinc-600 text-[0.6rem]">{diasDesde(stats?.ultima_actividad) || 'sin actividad'}</p>
      </div>
    </div>
  )
}

// ── Admin SAU ─────────────────────────────────────────────────────
export default function AdminSAU() {
  const { profile, signOut } = useAuth()

  const [clientes,    setClientes]    = useState([])
  const [statsMap,    setStatsMap]    = useState({})
  const [cargando,    setCargando]    = useState(true)
  const [seleccionado,setSeleccionado]= useState(null)
  const [filtro,      setFiltro]      = useState('todos')

  async function cargar() {
    setCargando(true)
    const { data: empresas } = await supabase.from('empresa').select('*').order('created_at', { ascending: false })
    if (!empresas) { setCargando(false); return }
    setClientes(empresas)

    const ahora   = new Date()
    const inicio  = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
    const inicioAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)
    const finAnt  = new Date(inicio)

    const statsPromises = empresas.map(async e => {
      const [{ count: ventas }, { count: ventasAnt }, { count: miembros }, { data: ultima }] = await Promise.all([
        supabase.from('venta').select('id', { count:'exact', head:true }).eq('empresa_id', e.id).gte('created_at', inicio.toISOString()),
        supabase.from('venta').select('id', { count:'exact', head:true }).eq('empresa_id', e.id).gte('created_at', inicioAnt.toISOString()).lt('created_at', finAnt.toISOString()),
        supabase.from('membresia').select('id', { count:'exact', head:true }).eq('empresa_id', e.id).eq('activa', true),
        supabase.from('venta').select('created_at').eq('empresa_id', e.id).order('created_at', { ascending:false }).limit(1),
      ])
      const vm = ventas || 0
      const va = ventasAnt || 0
      const crecimiento = va > 0 ? Math.round(((vm - va) / va) * 100) : 0
      return { id: e.id, ventas_mes: vm, ventas_mes_ant: va, crecimiento, miembros: miembros||0, ultima_actividad: ultima?.[0]?.created_at||null }
    })

    const arr = await Promise.all(statsPromises)
    const map = {}; arr.forEach(s => { map[s.id] = s })
    setStatsMap(map)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  const insights = useMemo(() => generarInsights(clientes, statsMap), [clientes, statsMap])

  const totales = useMemo(() => ({
    clientes:      clientes.length,
    activos:       clientes.filter(c => {
      const d = statsMap[c.id]?.ultima_actividad
      return d && Math.floor((Date.now() - new Date(d).getTime()) / 86400000) < 7
    }).length,
    totalVentas:   Object.values(statsMap).reduce((s, x) => s + (x.ventas_mes||0), 0),
    riesgos:       insights.filter(i => i.tipo === 'riesgo').length,
  }), [clientes, statsMap, insights])

  const clientesFiltrados = useMemo(() => {
    if (filtro === 'todos') return clientes
    return clientes.filter(c => (c.estado_suscripcion||'gratuito') === filtro)
  }, [clientes, filtro])

  const clienteSeleccionado = clientes.find(c => c.id === seleccionado)

  return (
    <div className="min-h-screen bg-zinc-950">
      <style>{FLOAT_STYLE}</style>

      {/* Header Jarvis */}
      <header className="border-b border-zinc-800/50 px-5 py-4 sticky top-0 z-40 bg-zinc-950/95 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="SAU" className="w-8 h-8 rounded-xl" style={{ filter:'drop-shadow(0 0 8px rgba(0,200,120,0.4))' }} />
            <div>
              <p className="text-emerald-400 text-[0.6rem] font-bold uppercase tracking-widest">SAU · Sistema Activo</p>
              <h1 className="text-white font-extrabold leading-none">{saludo()}, Facundo</h1>
            </div>
          </div>
          <button onClick={signOut} className="text-xs text-zinc-500 bg-zinc-800 px-3 py-1.5 rounded-full font-semibold">Salir</button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5 grid gap-6">

        {/* Pulso global */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Negocios', value: totales.clientes,    color: 'text-white' },
            { label: 'Activos',  value: totales.activos,     color: 'text-emerald-400' },
            { label: 'Ventas',   value: totales.totalVentas, color: 'text-white', small: true },
            { label: 'Alertas',  value: totales.riesgos,     color: totales.riesgos > 0 ? 'text-red-400' : 'text-zinc-600' },
          ].map(m => (
            <div key={m.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-2 py-3 text-center">
              <p className={`font-extrabold ${m.color} ${m.small ? 'text-base' : 'text-2xl'}`}>
                {m.small ? `${totales.totalVentas}` : m.value}
              </p>
              <p className="text-[0.6rem] text-zinc-600 font-semibold uppercase tracking-widest mt-0.5">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Consultas de audio */}
        <Consultas />

        {/* Feed Jarvis */}
        {!cargando && insights.length > 0 && (
          <div className="grid gap-2">
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest">
              ⚡ Análisis — {insights.length} señales
            </p>
            {insights.map((ins, i) => {
              const est = INSIGHT_ESTILO[ins.tipo] || INSIGHT_ESTILO.info
              return (
                <button key={i} onClick={() => setSeleccionado(ins.cid)}
                  className={`w-full text-left border-l-4 ${est.border} ${est.bg} rounded-r-2xl px-4 py-3 flex items-start gap-3 active:scale-[0.98] transition-all`}>
                  <span className="text-xl shrink-0 mt-0.5">{ins.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold leading-tight">{ins.titulo}</p>
                    {ins.sub && <p className="text-zinc-500 text-xs mt-0.5 leading-snug">{ins.sub}</p>}
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${est.badge}`}>{ins.accion}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Clientes */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest">Tus clientes</p>
            <div className="flex gap-1">
              {[['todos','Todos'],['activo','✓'],['atrasado','⚠'],['gratuito','◎']].map(([id,label]) => (
                <button key={id} onClick={() => setFiltro(id)}
                  className={`text-xs font-bold px-2.5 py-1 rounded-full transition-all ${
                    filtro === id ? 'bg-white text-zinc-900' : 'text-zinc-600 hover:text-zinc-400'
                  }`}>{label}</button>
              ))}
            </div>
          </div>

          {cargando ? (
            <div className="flex flex-wrap justify-center gap-8 py-8">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="w-20 h-20 rounded-full bg-zinc-800 animate-pulse" />
                  <div className="w-16 h-2 rounded bg-zinc-800 animate-pulse" />
                </div>
              ))}
            </div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="text-center py-12 text-zinc-700">
              <p className="text-4xl mb-2">🔍</p>
              <p className="text-sm">No hay clientes en esta categoría</p>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-8 py-2">
              {clientesFiltrados.map((c, i) => (
                <Burbuja key={c.id} cliente={c} stats={statsMap[c.id]} index={i} onClick={() => setSeleccionado(c.id)} />
              ))}
            </div>
          )}
        </div>

      </div>

      {clienteSeleccionado && (
        <DetalleCliente
          cliente={clienteSeleccionado}
          stats={statsMap[clienteSeleccionado.id]}
          onCerrar={() => setSeleccionado(null)}
          onActualizado={() => { setSeleccionado(null); cargar() }}
        />
      )}
    </div>
  )
}
