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

// Colores semáforo por estado
const BURBUJA = {
  activo:     { grad: 'from-emerald-400 to-emerald-600', glow: 'shadow-emerald-500/50', ring: 'ring-emerald-300', label: 'Al día' },
  gratuito:   { grad: 'from-amber-300   to-amber-500',   glow: 'shadow-amber-400/50',   ring: 'ring-amber-200',   label: 'Gratuito' },
  atrasado:   { grad: 'from-red-400     to-red-600',     glow: 'shadow-red-500/50',     ring: 'ring-red-300',     label: 'Atrasado' },
  suspendido: { grad: 'from-zinc-500    to-zinc-700',    glow: 'shadow-zinc-500/40',    ring: 'ring-zinc-400',    label: 'Suspendido' },
}

const SUSCRIPCION = {
  gratuito:   { label: 'Gratuito',   bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400'   },
  activo:     { label: 'Al día',     bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  atrasado:   { label: 'Atrasado',   bg: 'bg-red-50',      text: 'text-red-600',     dot: 'bg-red-500'     },
  suspendido: { label: 'Suspendido', bg: 'bg-zinc-100',    text: 'text-zinc-500',    dot: 'bg-zinc-400'    },
}

const RUBROS_ICON = {
  kiosco:'🏪', verduleria:'🥦', ferreteria:'🔧', farmacia:'💊',
  restaurante:'🍽️', ropa:'👕', electronica:'📱', libreria:'📚',
  panaderia:'🥐', carniceria:'🥩', otro:'🏢',
}

// ── Modal detalle ─────────────────────────────────────────────────
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
  const rubroIcon = RUBROS_ICON[cliente.rubro] || '🏢'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-[560px] rounded-t-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white px-5 pt-5 pb-4 border-b border-slate-100 flex items-center gap-3 rounded-t-[2rem]">
          <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${bur.grad} flex items-center justify-center text-white font-extrabold text-lg shadow-lg shrink-0`}>
            {iniciales(cliente.nombre_fantasia || cliente.razon_social)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold text-slate-900 truncate">
              {cliente.nombre_fantasia || cliente.razon_social}
            </h2>
            <p className="text-xs text-slate-400">
              {rubroIcon} {cliente.razon_social}
              {cliente.cuit && ` · ${cliente.cuit}`}
            </p>
          </div>
          <button onClick={onCerrar}
            className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-xl">
            ×
          </button>
        </div>

        <div className="px-5 py-4 grid gap-5">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Ventas este mes', value: stats?.ventas_mes ?? '—' },
              { label: 'Miembros',        value: stats?.miembros    ?? '—' },
              { label: 'Última actividad',value: diasDesde(stats?.ultima_actividad) || '—' },
            ].map(s => (
              <div key={s.label} className="bg-slate-50 rounded-2xl px-3 py-3 text-center">
                <p className="text-xl font-extrabold text-slate-800">{s.value}</p>
                <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mt-0.5 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Estado suscripción */}
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Estado de cuenta</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SUSCRIPCION).map(([id, cfg]) => (
                <button key={id} onClick={() => setEstado(id)}
                  className={`py-2.5 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                    estado === id ? `${cfg.bg} ${cfg.text} ring-2 ring-current ring-offset-1` : 'bg-slate-50 text-slate-400'
                  }`}>
                  <span className={`w-2 h-2 rounded-full ${estado === id ? cfg.dot : 'bg-slate-300'}`} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Módulos */}
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Chaleco (módulos)</p>
            <div className="grid grid-cols-2 gap-2">
              {MODULOS.map(m => {
                const activo = modulos.includes(m.id)
                return (
                  <button key={m.id} onClick={() => toggleModulo(m.id)} disabled={m.nucleo}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl text-sm font-bold transition-all ${
                      activo ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'bg-slate-50 text-slate-400'
                    } ${m.nucleo ? 'opacity-60 cursor-not-allowed' : ''}`}>
                    <span>{m.icon}</span>
                    <span className="flex-1 text-left truncate">{m.titulo.split(' ')[0]}</span>
                    {m.nucleo
                      ? <span className="text-[0.55rem] font-black uppercase text-indigo-400">base</span>
                      : <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[0.5rem] font-black ${activo ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>{activo ? '✓' : ''}</span>
                    }
                  </button>
                )
              })}
            </div>
          </div>

          {/* Info fiscal */}
          <div className="bg-slate-50 rounded-2xl px-4 py-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-0.5">Condición fiscal</p>
              <p className="text-sm font-bold text-slate-700">{cliente.condicion_fiscal || '—'}</p>
            </div>
            {cliente.categoria_monotributo && (
              <div>
                <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-0.5">Categoría</p>
                <p className="text-sm font-bold text-slate-700">Mono {cliente.categoria_monotributo}</p>
              </div>
            )}
            <div>
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-0.5">Alta en SAU</p>
              <p className="text-sm font-bold text-slate-700">
                {cliente.fecha_alta_sau ? new Date(cliente.fecha_alta_sau).toLocaleDateString('es-AR') : '—'}
              </p>
            </div>
            <div>
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-0.5">Modo práctica</p>
              <p className="text-sm font-bold text-slate-700">{cliente.modo_simulacion ? 'Sí' : 'No'}</p>
            </div>
          </div>

          {/* Notas */}
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Mis notas</p>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3}
              placeholder="Ej: viene los martes, hablar de recategoreo en julio..."
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-700 placeholder:text-slate-300 resize-none text-sm"
            />
          </div>

          <button onClick={guardar} disabled={guardando}
            className={`w-full py-4 rounded-3xl font-extrabold text-base active:scale-95 transition-all disabled:opacity-50 ${
              guardado ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white shadow-lg'
            }`}>
            {guardando ? 'Guardando…' : guardado ? '✓ Guardado' : 'Guardar cambios'}
          </button>

        </div>
      </div>
    </div>
  )
}

// ── Burbuja cliente ───────────────────────────────────────────────
function Burbuja({ cliente, stats, index, onClick }) {
  const estado = cliente.estado_suscripcion || 'gratuito'
  const bur    = BURBUJA[estado] || BURBUJA.gratuito
  const nombre = cliente.nombre_fantasia || cliente.razon_social || '?'

  return (
    <div className="flex flex-col items-center gap-2 cursor-pointer" onClick={onClick}>
      <button
        className={`burbuja w-20 h-20 rounded-full bg-gradient-to-br ${bur.grad}
          shadow-xl ${bur.glow} ring-2 ${bur.ring} ring-offset-2 ring-offset-zinc-950
          flex items-center justify-center
          active:scale-90 transition-transform`}
        style={{ animationDelay: `${(index % 8) * 0.4}s` }}
      >
        <span className="text-white font-black text-xl drop-shadow">
          {iniciales(nombre)}
        </span>
      </button>
      <div className="text-center">
        <p className="text-zinc-300 text-xs font-semibold truncate max-w-[80px]">{nombre}</p>
        {stats?.ultima_actividad && (
          <p className="text-zinc-600 text-[0.6rem]">{diasDesde(stats.ultima_actividad)}</p>
        )}
      </div>
      {estado === 'atrasado' && (
        <span className="text-[0.55rem] font-black text-red-400 uppercase tracking-widest -mt-1">⚠ pago</span>
      )}
    </div>
  )
}

// ── Panel de consultas de audio ───────────────────────────────────
function Consultas() {
  const [consultas, setConsultas] = useState([])
  const [cargando,  setCargando]  = useState(true)

  async function cargar() {
    const { data } = await supabase
      .from('consulta_sau')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setConsultas(data || [])
    setCargando(false)
  }

  async function cambiarEstado(id, estado) {
    await supabase.from('consulta_sau').update({ estado }).eq('id', id)
    cargar()
  }

  useEffect(() => { cargar() }, [])

  const nuevas = consultas.filter(c => c.estado === 'nueva').length

  const ESTADO_CONSULTA = {
    nueva:      { label: '🔴 Nueva',      bg: 'bg-red-950',    text: 'text-red-400'    },
    en_proceso: { label: '🟡 En proceso', bg: 'bg-amber-950',  text: 'text-amber-400'  },
    resuelta:   { label: '🟢 Resuelta',   bg: 'bg-emerald-950',text: 'text-emerald-400'},
  }

  if (cargando) return null
  if (consultas.length === 0) return null

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-extrabold flex items-center gap-2">
          🎤 Audios recibidos
          {nuevas > 0 && (
            <span className="text-xs font-black bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
              {nuevas} nuevos
            </span>
          )}
        </h2>
      </div>
      {consultas.map(c => (
        <div key={c.id} className={`rounded-2xl p-4 border border-zinc-800 ${ESTADO_CONSULTA[c.estado]?.bg || 'bg-zinc-900'}`}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-white font-bold">{c.nombre || 'Anónimo'}</p>
              <p className="text-zinc-500 text-xs">
                {c.telefono && `📱 ${c.telefono} · `}
                {new Date(c.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
              </p>
            </div>
            <select
              value={c.estado}
              onChange={e => cambiarEstado(c.id, e.target.value)}
              className={`text-xs font-bold px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 outline-none ${ESTADO_CONSULTA[c.estado]?.text}`}
            >
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

// ── Página AdminSAU ───────────────────────────────────────────────
export default function AdminSAU() {
  const { profile, signOut } = useAuth()

  const [clientes,    setClientes]    = useState([])
  const [statsMap,    setStatsMap]    = useState({})
  const [cargando,    setCargando]    = useState(true)
  const [seleccionado,setSeleccionado]= useState(null)
  const [filtro,      setFiltro]      = useState('todos')
  const [busqueda,    setBusqueda]    = useState('')

  async function cargar() {
    setCargando(true)
    const { data: empresas } = await supabase.from('empresa').select('*').order('created_at', { ascending: false })
    if (!empresas) { setCargando(false); return }
    setClientes(empresas)

    const inicio = new Date(); inicio.setDate(1); inicio.setHours(0,0,0,0)
    const statsPromises = empresas.map(async e => {
      const [{ count: ventas }, { count: miembros }, { data: ultima }] = await Promise.all([
        supabase.from('venta').select('id', { count:'exact', head:true }).eq('empresa_id', e.id).gte('created_at', inicio.toISOString()),
        supabase.from('membresia').select('id', { count:'exact', head:true }).eq('empresa_id', e.id).eq('activa', true),
        supabase.from('venta').select('created_at').eq('empresa_id', e.id).order('created_at', { ascending:false }).limit(1),
      ])
      return { id: e.id, ventas_mes: ventas||0, miembros: miembros||0, ultima_actividad: ultima?.[0]?.created_at||null }
    })
    const arr = await Promise.all(statsPromises)
    const map = {}; arr.forEach(s => { map[s.id] = s })
    setStatsMap(map)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  const totales = useMemo(() => ({
    total:     clientes.length,
    activos:   clientes.filter(c => c.estado_suscripcion === 'activo').length,
    atrasados: clientes.filter(c => c.estado_suscripcion === 'atrasado').length,
    gratuitos: clientes.filter(c => (c.estado_suscripcion||'gratuito') === 'gratuito').length,
  }), [clientes])

  const clientesFiltrados = useMemo(() => {
    let lista = clientes
    if (filtro !== 'todos') lista = lista.filter(c => (c.estado_suscripcion||'gratuito') === filtro)
    if (busqueda) {
      const b = busqueda.toLowerCase()
      lista = lista.filter(c =>
        (c.nombre_fantasia||'').toLowerCase().includes(b) ||
        (c.razon_social||'').toLowerCase().includes(b) ||
        (c.cuit||'').includes(b)
      )
    }
    return lista.sort((a, b) => {
      const ord = { atrasado:0, activo:1, gratuito:2, suspendido:3 }
      return (ord[a.estado_suscripcion]??2) - (ord[b.estado_suscripcion]??2)
    })
  }, [clientes, filtro, busqueda])

  const clienteSeleccionado = clientes.find(c => c.id === seleccionado)

  return (
    <div className="min-h-screen bg-zinc-950">
      <style>{FLOAT_STYLE}</style>

      {/* Header */}
      <header className="border-b border-zinc-800 px-5 py-4 flex items-center justify-between sticky top-0 z-40 bg-zinc-950">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="SAU" className="w-8 h-8 rounded-xl" />
          <div>
            <p className="text-[0.6rem] text-zinc-500 font-bold uppercase tracking-widest">Panel</p>
            <h1 className="text-white font-extrabold leading-none text-lg">Admin SAU</h1>
          </div>
        </div>
        <button onClick={signOut}
          className="text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-full font-semibold transition-all">
          Salir
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 grid gap-6">

        {/* Semáforo resumen — también son filtros */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { id:'todos',     label:'Total',    value:totales.total,     grad:'from-zinc-700 to-zinc-600',     glow:'' },
            { id:'activo',    label:'Al día',   value:totales.activos,   grad:'from-emerald-500 to-emerald-700',glow:'shadow-emerald-900' },
            { id:'atrasado',  label:'Atrasados',value:totales.atrasados, grad:'from-red-500 to-red-700',       glow:'shadow-red-900' },
            { id:'gratuito',  label:'Gratuitos',value:totales.gratuitos, grad:'from-amber-400 to-amber-600',   glow:'shadow-amber-900' },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`bg-gradient-to-br ${f.grad} rounded-2xl py-3 text-center transition-all active:scale-95 shadow-lg ${f.glow} ${
                filtro === f.id ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950 scale-105' : 'opacity-70 hover:opacity-100'
              }`}>
              <p className="text-2xl font-extrabold text-white">{f.value}</p>
              <p className="text-[0.6rem] text-white/70 font-bold uppercase tracking-widest">{f.label}</p>
            </button>
          ))}
        </div>

        {/* Consultas de audio */}
        <Consultas />

        {/* Búsqueda */}
        <input type="text" placeholder="Buscar cliente…" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl bg-zinc-900 text-white placeholder:text-zinc-600 outline-none border border-zinc-800 focus:border-zinc-600"
        />

        {/* Burbujas */}
        {cargando ? (
          <div className="flex flex-wrap justify-center gap-8 py-12">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="w-20 h-20 rounded-full bg-zinc-800 animate-pulse" style={{ animationDelay:`${i*0.2}s` }} />
                <div className="w-16 h-2 rounded-full bg-zinc-800 animate-pulse" />
              </div>
            ))}
          </div>
        ) : clientesFiltrados.length === 0 ? (
          <div className="text-center py-16 text-zinc-600">
            <p className="text-5xl mb-3">🔍</p>
            <p className="font-medium">{busqueda ? 'No encontramos ese cliente' : 'No hay clientes en esta categoría'}</p>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-8 py-4">
            {clientesFiltrados.map((c, i) => (
              <Burbuja
                key={c.id}
                cliente={c}
                stats={statsMap[c.id]}
                index={i}
                onClick={() => setSeleccionado(c.id)}
              />
            ))}
          </div>
        )}

      </div>

      {/* Modal detalle */}
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
