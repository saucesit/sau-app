import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ETAPAS_CON_OPERARIO } from '../lib/taller'

// ── Definición de tareas en lenguaje de negocio ───────────────────
export const TAREAS = [
  {
    id: 'ventas',
    icon: '🛒',
    titulo: 'Registra ventas',
    descripcion: 'Puede cobrar a clientes, registrar ventas y ver el historial',
    permisos: ['ventas.crear', 'ventas.confirmar', 'ventas.ver'],
    colorActivo: 'bg-emerald-500',
    colorFondo:  'bg-emerald-50 border-emerald-200',
    colorTexto:  'text-emerald-700',
  },
  {
    id: 'caja',
    icon: '💵',
    titulo: 'Maneja la caja',
    descripcion: 'Registra ingresos y egresos de caja del día a día',
    permisos: ['caja.ver', 'caja.crear'],
    colorActivo: 'bg-blue-500',
    colorFondo:  'bg-blue-50 border-blue-200',
    colorTexto:  'text-blue-700',
  },
  {
    id: 'compras',
    icon: '🛍️',
    titulo: 'Carga compras y gastos',
    descripcion: 'Registra facturas de proveedores y gastos del negocio',
    permisos: ['compras.ver', 'compras.crear'],
    colorActivo: 'bg-orange-500',
    colorFondo:  'bg-orange-50 border-orange-200',
    colorTexto:  'text-orange-700',
  },
  {
    id: 'reportes',
    icon: '📊',
    titulo: 'Ve estadísticas',
    descripcion: 'Accede al dashboard y al análisis de ventas y rentabilidad',
    permisos: ['reportes.ver'],
    colorActivo: 'bg-violet-500',
    colorFondo:  'bg-violet-50 border-violet-200',
    colorTexto:  'text-violet-700',
  },
  {
    id: 'taller_trabajo',
    icon: '🔧',
    titulo: 'Trabaja en el taller',
    descripcion: 'Ve los vehículos, marca su trabajo como realizado y suma observaciones. No ve montos',
    permisos: ['taller.ver', 'taller.trabajar'],
    clave: 'taller.trabajar',
    modulo: 'taller',
    colorActivo: 'bg-sky-500',
    colorFondo:  'bg-sky-50 border-sky-200',
    colorTexto:  'text-sky-700',
  },
  {
    id: 'taller_coordina',
    icon: '✅',
    titulo: 'Coordina el taller',
    descripcion: 'Da ingreso a vehículos y valida el paso de una etapa a la siguiente',
    permisos: ['taller.ver', 'taller.cargar', 'taller.validar'],
    clave: 'taller.validar',
    modulo: 'taller',
    colorActivo: 'bg-teal-600',
    colorFondo:  'bg-teal-50 border-teal-200',
    colorTexto:  'text-teal-700',
  },
  {
    id: 'taller_montos',
    icon: '💲',
    titulo: 'Ve los montos del taller',
    descripcion: 'Carga y consulta lo que se factura a la compañía, la franquicia y el particular',
    permisos: ['taller.montos'],
    clave: 'taller.montos',
    modulo: 'taller',
    colorActivo: 'bg-amber-500',
    colorFondo:  'bg-amber-50 border-amber-200',
    colorTexto:  'text-amber-700',
  },
  {
    id: 'equipo',
    icon: '👥',
    titulo: 'Gestiona el equipo',
    descripcion: 'Agrega empleados, modifica accesos y configura el negocio',
    permisos: ['empresa.admin', 'empresa.rrhh'],
    colorActivo: 'bg-slate-600',
    colorFondo:  'bg-slate-50 border-slate-200',
    colorTexto:  'text-slate-700',
  },
]

// ── Presets rápidos ───────────────────────────────────────────────
export const PRESETS = [
  { id: 'vendedor',       label: 'Vendedor',      icon: '🛒', tareas: ['ventas', 'caja'] },
  { id: 'encargado',      label: 'Encargado',     icon: '⭐', tareas: ['ventas', 'caja', 'compras', 'reportes'] },
  { id: 'administrativo', label: 'Administrativo', icon: '💼', tareas: ['compras', 'reportes'] },
  // Roles de taller de chapa y pintura: el operario nunca valida su propio trabajo
  // ni ve montos; el coordinador valida pero tampoco ve precios.
  { id: 'operario',       label: 'Operario',      icon: '🔧', modulo: 'taller', tareas: ['taller_trabajo'] },
  { id: 'coordinador',    label: 'Coordinador',   icon: '✅', modulo: 'taller', tareas: ['taller_trabajo', 'taller_coordina'] },
  { id: 'admin_taller',   label: 'Administración', icon: '💲', modulo: 'taller', tareas: ['taller_trabajo', 'taller_coordina', 'taller_montos', 'reportes'] },
]

// Una tarea sin `modulo` se ve siempre; las que lo tienen aparecen solo si la
// empresa tiene ese módulo activo — así al kiosco no le figuran las del taller.
export function tareasVisibles(tieneModulo) {
  return TAREAS.filter(t => !t.modulo || tieneModulo(t.modulo))
}
export function presetsVisibles(tieneModulo) {
  return PRESETS.filter(p => !p.modulo || tieneModulo(p.modulo))
}

// ── Helpers ───────────────────────────────────────────────────────
export function permisosATareas(permisos = []) {
  // `clave` es el permiso que identifica a la tarea. Hace falta donde varias
  // comparten uno: todas las del taller incluyen taller.ver, así que sin esto
  // alguien con solo taller.ver figuraba como si trabajara en el taller.
  return TAREAS
    .filter(t => t.clave ? permisos.includes(t.clave) : t.permisos.some(p => permisos.includes(p)))
    .map(t => t.id)
}

export function tareasAPermisos(selectedIds = []) {
  const result = new Set()
  TAREAS.filter(t => selectedIds.includes(t.id))
        .forEach(t => t.permisos.forEach(p => result.add(p)))
  return [...result]
}

function detectarPreset(selectedIds) {
  const sorted = [...selectedIds].sort().join(',')
  return PRESETS.find(p => [...p.tareas].sort().join(',') === sorted)?.id || null
}

// ── Página ────────────────────────────────────────────────────────
export default function EquipoTareas() {
  const { membresiaId } = useParams()
  const navigate = useNavigate()
  const { tieneModulo } = useAuth()

  const [mem,       setMem]       = useState(null)
  const [selected,  setSelected]  = useState([])
  const [etapas,    setEtapas]    = useState([])
  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [ok,        setOk]        = useState(false)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    if (!membresiaId) return
    ;(async () => {
      const { data } = await supabase
        .from('membresia')
        .select('id, permisos, rol, taller_etapas, profile:usuario_id(nombre, apellido)')
        .eq('id', membresiaId)
        .single()
      if (data) {
        setMem(data)
        setSelected(permisosATareas(data.permisos || []))
        setEtapas(data.taller_etapas || [])
      }
      setCargando(false)
    })()
  }, [membresiaId])

  function toggleTarea(id) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  function aplicarPreset(presetId) {
    const preset = PRESETS.find(p => p.id === presetId)
    if (preset) setSelected(preset.tareas)
  }

  async function guardar() {
    setError(null)
    setGuardando(true)
    const nuevosPermisos = tareasAPermisos(selected)
    const { error: err } = await supabase
      .from('membresia')
      .update({
        permisos: nuevosPermisos,
        // Si deja de trabajar en el taller, se limpian las etapas.
        taller_etapas: selected.includes('taller_trabajo') ? etapas : [],
      })
      .eq('id', membresiaId)
    setGuardando(false)
    if (err) return setError('No se pudo guardar. Revisá tu conexión.')
    setOk(true)
    setTimeout(() => navigate('/equipo'), 1200)
  }

  if (cargando) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p className="text-4xl mb-3">⚡</p>
        <p className="font-medium">Cargando…</p>
      </div>
    )
  }

  if (!mem) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p className="text-4xl mb-3">❌</p>
        <p className="font-medium">No se encontró el empleado.</p>
      </div>
    )
  }

  const nombre = `${mem.profile?.nombre || ''}${mem.profile?.apellido ? ` ${mem.profile.apellido}` : ''}`
  const presetActual = detectarPreset(selected)

  // Resumen en lenguaje plain
  const resumen = selected.length === 0
    ? 'Sin accesos asignados'
    : TAREAS.filter(t => selected.includes(t.id)).map(t => t.titulo.toLowerCase()).join(', ')

  if (ok) {
    return (
      <div className="text-center py-20">
        <p className="text-6xl mb-3">✅</p>
        <p className="text-xl font-extrabold text-emerald-600">¡Listo!</p>
        <p className="text-slate-400 text-sm mt-1">Los accesos de {nombre} fueron actualizados</p>
      </div>
    )
  }

  return (
    <div className="grid gap-5">

      {/* Header del empleado */}
      <div className="bg-indigo-600 text-white rounded-3xl px-5 py-5 shadow-lg shadow-indigo-100">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center font-extrabold text-2xl shrink-0">
            {mem.profile?.nombre?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-extrabold text-lg leading-tight">{nombre || 'Empleado'}</p>
            <p className="text-indigo-200 text-sm mt-0.5">
              {selected.length === 0
                ? 'Sin tareas asignadas aún'
                : resumen}
            </p>
          </div>
        </div>
      </div>

      {/* Presets rápidos */}
      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
          Perfiles rápidos
        </p>
        <div className="flex gap-2 flex-wrap">
          {presetsVisibles(tieneModulo).map(p => (
            <button key={p.id} onClick={() => aplicarPreset(p.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-95 ${
                presetActual === p.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                  : 'bg-white text-slate-600 shadow-sm'
              }`}
            >
              <span>{p.icon}</span> {p.label}
            </button>
          ))}
          {presetActual === null && selected.length > 0 && (
            <span className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl font-bold text-sm bg-slate-100 text-slate-500">
              🎛️ Personalizado
            </span>
          )}
        </div>
      </div>

      {/* Pregunta central */}
      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
          ¿Qué hace {mem.profile?.nombre || 'este empleado'} en el negocio?
        </p>
        <div className="grid gap-3">
          {tareasVisibles(tieneModulo).map(t => {
            const activo = selected.includes(t.id)
            return (
              <button key={t.id} onClick={() => toggleTarea(t.id)}
                className={`w-full rounded-3xl px-5 py-4 border-2 text-left transition-all active:scale-[0.98] ${
                  activo
                    ? `${t.colorFondo} ${t.colorTexto} border-current`
                    : 'bg-white border-transparent shadow-sm text-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{t.icon}</span>
                    <div>
                      <p className="font-extrabold text-base leading-tight">{t.titulo}</p>
                      <p className={`text-xs mt-0.5 leading-snug ${activo ? 'opacity-70' : 'text-slate-400'}`}>
                        {t.descripcion}
                      </p>
                    </div>
                  </div>
                  {/* Toggle visual */}
                  <div className={`shrink-0 ml-3 w-12 h-6 rounded-full relative transition-all ${
                    activo ? t.colorActivo : 'bg-slate-200'
                  }`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                      activo ? 'left-7' : 'left-1'
                    }`} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Etapas habilitadas: solo puede marcar trabajo en las de su oficio */}
      {tieneModulo('taller') && selected.includes('taller_trabajo') && (
        <div>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
            ¿En qué etapas trabaja?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ETAPAS_CON_OPERARIO.map(e => {
              const activo = etapas.includes(e.id)
              return (
                <button key={e.id}
                  onClick={() => setEtapas(prev =>
                    prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id]
                  )}
                  className={`px-4 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 ${
                    activo ? 'bg-sky-500 text-white' : 'bg-white text-slate-600 shadow-sm'
                  }`}
                >
                  {e.label}
                </button>
              )
            })}
          </div>
          {etapas.length === 0 ? (
            <p className="text-xs text-red-500 font-semibold mt-2.5 leading-snug bg-red-50 rounded-2xl px-4 py-3">
              Sin etapas marcadas no va a poder dar por realizado ningún trabajo. Elegí al menos una.
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-2.5 leading-snug">
              Va a poder marcar trabajo realizado solo en{' '}
              {etapas.map(id => ETAPAS_CON_OPERARIO.find(e => e.id === id)?.label).join(' y ')}.
            </p>
          )}
        </div>
      )}

      {/* Resumen de permisos */}
      {selected.length > 0 && (
        <div className="bg-slate-100 rounded-3xl px-5 py-4">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1.5">
            En SAU va a poder
          </p>
          <p className="text-sm text-slate-600 font-medium leading-relaxed">
            {resumen.charAt(0).toUpperCase() + resumen.slice(1)}
          </p>
        </div>
      )}

      {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

      <button onClick={guardar} disabled={guardando}
        className="w-full py-5 rounded-3xl bg-indigo-600 text-white font-extrabold text-lg shadow-lg shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
      >
        {guardando ? 'Guardando…' : '✓ Guardar tareas'}
      </button>

    </div>
  )
}
