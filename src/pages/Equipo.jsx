import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { TAREAS, PRESETS, permisosATareas, tareasAPermisos } from './EquipoTareas'

const ROLES_LABEL = { empleado: 'Empleado', dueno: 'Dueño', contadora: 'Contadora', admin: 'Admin' }

// ── Modal: Nuevo empleado ─────────────────────────────────────────
function ModalNuevoEmpleado({ empresaActivaId, onGuardado, onCerrar }) {
  const [nombre,    setNombre]    = useState('')
  const [apellido,  setApellido]  = useState('')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [presetId,  setPresetId]  = useState('vendedor')
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  const permisos = tareasAPermisos(PRESETS.find(p => p.id === presetId)?.tareas || [])

  async function guardar(e) {
    e.preventDefault()
    if (!nombre.trim()) return setError('El nombre es obligatorio')
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres')
    setError(null); setGuardando(true)

    const { data, error } = await supabase.functions.invoke('crear-empleado', {
      body: { nombre, apellido, email, password, empresa_id: empresaActivaId, permisos, rol: 'empleado' }
    })

    setGuardando(false)
    if (error || !data?.ok) return setError(data?.error || 'No se pudo crear el empleado.')
    onGuardado()
  }

  return (
    <div onClick={onCerrar} className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
      <div onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-[500px] rounded-t-[2rem] px-5 pt-5 pb-10 max-h-[90vh] overflow-y-auto"
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
        <h2 className="text-xl font-extrabold text-slate-800 mb-1">Nuevo empleado</h2>
        <p className="text-sm text-slate-400 mb-5">Completá los datos y elegí su perfil de acceso</p>

        <form onSubmit={guardar} className="grid gap-3">
          {/* Datos básicos */}
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Nombre *" value={nombre}
              onChange={e => setNombre(e.target.value)} autoFocus
              className="px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-800 placeholder:text-slate-300"
            />
            <input type="text" placeholder="Apellido" value={apellido}
              onChange={e => setApellido(e.target.value)}
              className="px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-800 placeholder:text-slate-300"
            />
          </div>
          <input type="email" placeholder="Email *" value={email}
            onChange={e => setEmail(e.target.value)} required
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-800 placeholder:text-slate-300"
          />
          <input type="password" placeholder="Contraseña temporal (mín. 6 caracteres)" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-800 placeholder:text-slate-300"
          />

          {/* Perfil de acceso */}
          <div className="mt-2">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
              ¿Qué hace en el negocio?
            </p>
            <div className="grid gap-2">
              {PRESETS.map(p => {
                const activo = presetId === p.id
                const tareasTitulos = p.tareas
                  .map(tid => TAREAS.find(t => t.id === tid)?.titulo || tid)
                  .join(', ')
                return (
                  <button type="button" key={p.id} onClick={() => setPresetId(p.id)}
                    className={`flex items-start gap-3 px-4 py-3.5 rounded-2xl text-left transition-all ${
                      activo ? 'bg-indigo-50 border-2 border-indigo-200' : 'bg-slate-50 border-2 border-transparent'
                    }`}
                  >
                    <span className="text-2xl">{p.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-sm ${activo ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {p.label}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-snug">{tareasTitulos}</p>
                    </div>
                    <div className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      activo ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                    }`}>
                      {activo && <div className="w-2 h-2 bg-white rounded-full" />}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-400 mt-2 text-center">
              Podés ajustar los accesos en detalle después de crearlo
            </p>
          </div>

          {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

          <button type="submit" disabled={guardando}
            className="w-full py-4 rounded-3xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-100 disabled:opacity-50 active:scale-95 transition-all"
          >
            {guardando ? 'Creando cuenta…' : '✓ Crear empleado'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Card de miembro ───────────────────────────────────────────────
function MiembroCard({ mem, onDesactivar, esUnoMismo }) {
  const navigate = useNavigate()
  const [expandido, setExpandido] = useState(false)

  const tareasActivas = permisosATareas(mem.permisos || [])
  const resumen = tareasActivas.length === 0
    ? 'Sin accesos'
    : TAREAS.filter(t => tareasActivas.includes(t.id)).map(t => t.titulo).join(' · ')

  return (
    <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
      <button onClick={() => setExpandido(e => !e)}
        className="w-full px-5 py-4 flex items-center gap-3 text-left"
      >
        <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center font-extrabold text-indigo-600 text-lg shrink-0">
          {mem.profile?.nombre?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 truncate">
            {mem.profile?.nombre} {mem.profile?.apellido || ''}
            {esUnoMismo && <span className="ml-1 text-xs text-indigo-400">(vos)</span>}
          </p>
          <p className="text-xs text-slate-400 truncate">{resumen}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[0.65rem] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-semibold">
            {ROLES_LABEL[mem.rol] || mem.rol}
          </span>
          <span className="text-slate-300 text-lg">{expandido ? '▴' : '▾'}</span>
        </div>
      </button>

      {expandido && (
        <div className="px-5 pb-5 border-t border-slate-50">
          {/* Tareas activas como chips */}
          <div className="flex flex-wrap gap-2 mt-4 mb-4">
            {TAREAS.map(t => {
              const activo = tareasActivas.includes(t.id)
              return (
                <span key={t.id}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-bold transition-all ${
                    activo
                      ? `${t.colorFondo} ${t.colorTexto} border ${t.colorFondo}`
                      : 'bg-slate-100 text-slate-300'
                  }`}
                >
                  <span>{t.icon}</span> {t.titulo}
                </span>
              )
            })}
          </div>

          {!esUnoMismo && (
            <div className="grid gap-2">
              <button onClick={() => navigate(`/equipo/tareas/${mem.id}`)}
                className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-bold text-sm active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <span>⚡</span> Configurar tareas
              </button>
              <button onClick={() => onDesactivar(mem.id)}
                className="w-full py-3 rounded-2xl bg-red-50 text-red-500 font-bold text-sm active:scale-95 transition-all"
              >
                Desactivar usuario
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pantalla principal ────────────────────────────────────────────
export default function Equipo() {
  const { empresaActivaId, empresaActiva, user } = useAuth()
  const [miembros, setMiembros] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal,    setModal]    = useState(false)
  const [copiado,  setCopiado]  = useState(false)

  const cargar = useCallback(async () => {
    if (!empresaActivaId) return
    setCargando(true)
    const { data } = await supabase
      .from('membresia')
      .select('id, rol, permisos, activa, usuario_id, profile:usuario_id(id, nombre, apellido)')
      .eq('empresa_id', empresaActivaId)
      .eq('activa', true)
      .order('creado_en')
    setMiembros(data || [])
    setCargando(false)
  }, [empresaActivaId])

  useEffect(() => { cargar() }, [cargar])

  async function desactivar(membresiaId) {
    if (!confirm('¿Desactivar este usuario? Perderá acceso a la empresa.')) return
    await supabase.from('membresia').update({ activa: false }).eq('id', membresiaId)
    setMiembros(prev => prev.filter(m => m.id !== membresiaId))
  }

  function copiarLink() {
    const link = `${window.location.origin}/unirse?codigo=${empresaActiva?.codigo_invitacion}`
    navigator.clipboard.writeText(link)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="grid gap-4">

      {/* Botón nuevo empleado */}
      <button onClick={() => setModal(true)}
        className="w-full py-4 rounded-3xl bg-indigo-600 text-white font-extrabold text-base shadow-lg shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-2"
      >
        <span className="text-xl">➕</span> Nuevo empleado
      </button>

      {/* Link de invitación */}
      <div className="bg-white rounded-3xl p-4 shadow-sm flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-semibold mb-0.5">Link de invitación</p>
          <code className="text-xs text-slate-500 truncate block">
            /unirse?codigo={empresaActiva?.codigo_invitacion}
          </code>
        </div>
        <button onClick={copiarLink}
          className="shrink-0 bg-indigo-50 text-indigo-600 font-bold text-xs px-3 py-2 rounded-2xl active:scale-95 transition-all"
        >
          {copiado ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Lista */}
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
        Equipo ({miembros.length})
      </p>

      {cargando && <p className="text-center text-slate-400 text-sm py-8">Cargando…</p>}

      {miembros.map(mem => (
        <MiembroCard key={mem.id} mem={mem}
          onDesactivar={desactivar}
          esUnoMismo={mem.usuario_id === user?.id}
        />
      ))}

      {modal && (
        <ModalNuevoEmpleado
          empresaActivaId={empresaActivaId}
          onGuardado={() => { setModal(false); cargar() }}
          onCerrar={() => setModal(false)}
        />
      )}
    </div>
  )
}
