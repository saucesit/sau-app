import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TIPO_ICON = {
  documentacion: '📋',
  fiscal:        '🧾',
  contrato:      '📄',
  otro:          '📝',
}

function saludo() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

function iniciales(nombre) {
  return (nombre || '?').trim().split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

export default function AdminContadora() {
  const { signOut, profile } = useAuth()
  const [tareas,   setTareas]   = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtro,   setFiltro]   = useState('pendiente')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    const { data } = await supabase
      .from('tarea_contadora')
      .select('*, empresa:empresa_id(id, nombre_fantasia, modo_simulacion)')
      .order('created_at', { ascending: false })
    setTareas(data || [])
    setCargando(false)
  }

  async function cambiarEstado(id, nuevoEstado) {
    await supabase
      .from('tarea_contadora')
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq('id', id)
    setTareas(t => t.map(x => x.id === id ? { ...x, estado: nuevoEstado } : x))
  }

  async function guardarNota(id, notas) {
    await supabase.from('tarea_contadora').update({ notas }).eq('id', id)
    setTareas(t => t.map(x => x.id === id ? { ...x, notas } : x))
  }

  const pendientes = tareas.filter(t => t.estado === 'pendiente').length
  const enProceso  = tareas.filter(t => t.estado === 'en_proceso').length

  const filtradas = filtro === 'todas'
    ? tareas
    : tareas.filter(t => t.estado === filtro)

  // Agrupar por empresa
  const porEmpresa = filtradas.reduce((acc, t) => {
    const key = t.empresa_id
    if (!acc[key]) acc[key] = {
      nombre:   t.empresa?.nombre_fantasia || 'Sin nombre',
      practica: t.empresa?.modo_simulacion,
      tareas:   [],
    }
    acc[key].tareas.push(t)
    return acc
  }, {})

  const nombreContadora = profile?.nombre?.split(' ')[0] || 'Rocío'

  return (
    <div className="min-h-screen bg-zinc-950">

      {/* Header */}
      <header className="sticky top-0 z-40 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/50 px-5 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
              <span className="text-white font-extrabold text-sm">C</span>
            </div>
            <div>
              <p className="text-violet-400 text-[0.6rem] font-bold uppercase tracking-widest">SAU · Contadora</p>
              <p className="text-white font-extrabold leading-none text-sm">{saludo()}, {nombreContadora}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendientes > 0 && (
              <span className="bg-red-500 text-white text-xs font-black px-2.5 py-1 rounded-full animate-pulse">
                {pendientes} pendiente{pendientes !== 1 ? 's' : ''}
              </span>
            )}
            {enProceso > 0 && (
              <span className="bg-amber-500 text-white text-xs font-black px-2.5 py-1 rounded-full">
                {enProceso} en proceso
              </span>
            )}
            <button onClick={signOut} className="text-xs text-zinc-600 bg-zinc-800 px-3 py-1.5 rounded-full">Salir</button>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <div className="max-w-lg mx-auto px-4 pt-5 pb-1">
        <div className="flex gap-2 overflow-x-auto">
          {[
            { key: 'pendiente',  label: '🔴 Pendientes',  count: tareas.filter(t => t.estado === 'pendiente').length  },
            { key: 'en_proceso', label: '🟡 En proceso',  count: tareas.filter(t => t.estado === 'en_proceso').length  },
            { key: 'completada', label: '✅ Completadas', count: tareas.filter(t => t.estado === 'completada').length },
            { key: 'todas',      label: 'Todas',          count: tareas.length },
          ].map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all shrink-0 ${
                filtro === f.key
                  ? 'bg-white text-zinc-900'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}>
              {f.label}
              <span className={`text-[0.6rem] font-black px-1.5 py-0.5 rounded-full ${
                filtro === f.key ? 'bg-zinc-200 text-zinc-800' : 'bg-zinc-700 text-zinc-400'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 grid gap-6">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        ) : Object.keys(porEmpresa).length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">{filtro === 'completada' ? '🎉' : '✅'}</p>
            <p className="text-zinc-400 font-bold text-lg">
              {filtro === 'pendiente' ? '¡Todo al día!' :
               filtro === 'en_proceso' ? 'Nada en proceso' :
               filtro === 'completada' ? 'Sin completadas todavía' :
               'Sin tareas todavía'}
            </p>
            <p className="text-zinc-700 text-sm mt-1">
              {filtro === 'pendiente' ? 'No hay documentación pendiente' : 'Las tareas de nuevos clientes aparecerán acá'}
            </p>
          </div>
        ) : (
          Object.entries(porEmpresa).map(([empId, grupo]) => (
            <GrupoEmpresa
              key={empId}
              grupo={grupo}
              onCambiarEstado={cambiarEstado}
              onGuardarNota={guardarNota}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Grupo de tareas por empresa ───────────────────────────────────
function GrupoEmpresa({ grupo, onCambiarEstado, onGuardarNota }) {
  const completadas = grupo.tareas.filter(t => t.estado === 'completada').length
  const total       = grupo.tareas.length

  return (
    <div>
      {/* Header empresa */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white font-extrabold text-xs shrink-0">
          {iniciales(grupo.nombre)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-zinc-200 font-bold text-sm truncate">{grupo.nombre}</p>
          {grupo.practica && (
            <p className="text-amber-500 text-[0.6rem] font-bold">MODO PRÁCTICA</p>
          )}
        </div>
        {/* Barra de progreso */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${(completadas / total) * 100}%` }}
            />
          </div>
          <span className="text-zinc-600 text-xs font-mono">{completadas}/{total}</span>
        </div>
      </div>

      {/* Tareas */}
      <div className="grid gap-2">
        {grupo.tareas.map(tarea => (
          <TareaCard
            key={tarea.id}
            tarea={tarea}
            onCambiarEstado={onCambiarEstado}
            onGuardarNota={onGuardarNota}
          />
        ))}
      </div>
    </div>
  )
}

// ── Card de tarea individual ──────────────────────────────────────
function TareaCard({ tarea, onCambiarEstado, onGuardarNota }) {
  const [abierta, setAbierta] = useState(false)
  const [nota,    setNota]    = useState(tarea.notas || '')
  const [guardando, setGuardando] = useState(false)

  const ESTADOS = [
    { value: 'pendiente',  label: 'Pendiente',  dot: 'bg-red-500'     },
    { value: 'en_proceso', label: 'En proceso', dot: 'bg-amber-500'   },
    { value: 'completada', label: 'Completada', dot: 'bg-emerald-500' },
  ]
  const estadoActual = ESTADOS.find(e => e.value === tarea.estado) || ESTADOS[0]

  async function guardar() {
    setGuardando(true)
    await onGuardarNota(tarea.id, nota)
    setGuardando(false)
    setAbierta(false)
  }

  return (
    <div className={`bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${
      tarea.estado === 'completada' ? 'border-zinc-800/50 opacity-70' : 'border-zinc-800'
    }`}>
      {/* Fila principal */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-lg shrink-0">{TIPO_ICON[tarea.tipo] || '📝'}</span>
        <div className="flex-1 min-w-0" onClick={() => setAbierta(!abierta)} style={{ cursor: 'pointer' }}>
          <p className={`text-sm font-semibold leading-snug ${
            tarea.estado === 'completada' ? 'text-zinc-600 line-through' : 'text-white'
          }`}>
            {tarea.titulo}
          </p>
          {tarea.notas && !abierta && (
            <p className="text-zinc-600 text-xs mt-0.5 truncate">📎 {tarea.notas}</p>
          )}
        </div>

        {/* Selector de estado */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${estadoActual.dot}`} />
          <select
            value={tarea.estado}
            onChange={e => onCambiarEstado(tarea.id, e.target.value)}
            className="text-xs font-bold bg-transparent text-zinc-400 outline-none cursor-pointer max-w-[90px]"
            style={{ colorScheme: 'dark' }}
            onClick={e => e.stopPropagation()}>
            {ESTADOS.map(e => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>

        <button onClick={() => setAbierta(!abierta)}
          className="text-zinc-700 text-lg leading-none shrink-0 ml-1">
          {abierta ? '▲' : '▼'}
        </button>
      </div>

      {/* Panel expandido */}
      {abierta && (
        <div className="px-4 pb-4 grid gap-3 border-t border-zinc-800/50 pt-3">
          {tarea.descripcion && (
            <p className="text-zinc-500 text-xs leading-relaxed">{tarea.descripcion}</p>
          )}
          <textarea
            value={nota}
            onChange={e => setNota(e.target.value)}
            placeholder="Agregar notas, número de trámite, observaciones..."
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-xs placeholder:text-zinc-600 resize-none outline-none focus:border-violet-500 transition-colors"
          />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setAbierta(false)} className="py-2 rounded-xl bg-zinc-800 text-zinc-500 text-xs font-bold">
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              className="py-2 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-50 active:scale-95">
              {guardando ? 'Guardando...' : 'Guardar nota ✓'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
