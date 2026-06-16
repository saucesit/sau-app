import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MODULOS } from '../lib/modulos'
import { RUBROS, CATEGORIAS_MONO } from '../lib/constants'

// ── Campo editable ────────────────────────────────────────────────
function Campo({ label, children, sub }) {
  return (
    <div className="bg-white rounded-3xl px-5 py-4 shadow-sm">
      <p className="text-[0.65rem] text-slate-400 font-semibold uppercase tracking-widest mb-1.5">{label}</p>
      {children}
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function Perfil() {
  const { empresaActivaId, empresaActiva, tienePermiso, modulosActivos } = useAuth()

  const [nombre,         setNombre]         = useState('')
  const [rubro,          setRubro]          = useState('')
  const [cuit,           setCuit]           = useState('')
  const [condicion,      setCondicion]      = useState('monotributo')
  const [categoriaMono,  setCategoriaMono]  = useState('C')
  const [puntoVenta,     setPuntoVenta]     = useState('1')
  const [codigoInv,      setCodigoInv]      = useState('')
  const [guardando,      setGuardando]      = useState(false)
  const [ok,             setOk]             = useState(false)
  const [error,          setError]          = useState(null)
  const [copiado,        setCopiado]        = useState(false)
  const [modulos,        setModulos]        = useState([])

  // Cargar datos actuales de la empresa
  useEffect(() => {
    if (!empresaActiva) return
    setNombre(empresaActiva.nombre_fantasia || empresaActiva.razon_social || '')
    setRubro(empresaActiva.actividad || '')
    setCuit(empresaActiva.cuit || '')
    setCondicion(empresaActiva.condicion_fiscal || 'monotributo')
    setCategoriaMono(empresaActiva.categoria_monotributo || 'C')
    setPuntoVenta(String(empresaActiva.punto_de_venta || 1))
    setCodigoInv(empresaActiva.codigo_invitacion || '')
    setModulos(modulosActivos)
  }, [empresaActiva, modulosActivos])

  // Los módulos los activa/desactiva SAU desde el panel de admin, no el dueño.
  // Acá el dueño solo los ve (más arriba, en modo lectura).

  async function guardar() {
    if (!nombre.trim()) return setError('El nombre no puede estar vacío')
    setError(null)
    setGuardando(true)

    const { error: err } = await supabase.from('empresa').update({
      nombre_fantasia:       nombre.trim(),
      razon_social:          nombre.trim(),
      cuit:                  cuit.trim() || null,
      condicion_fiscal:      condicion,
      categoria_monotributo: condicion === 'monotributo' ? categoriaMono : null,
      punto_de_venta:        parseInt(puntoVenta) || 1,
      actividad:             rubro || null,
    }).eq('id', empresaActivaId)

    setGuardando(false)
    if (err) return setError('No se pudo guardar. Intentá de nuevo.')
    setOk(true)
    setTimeout(() => setOk(false), 2500)
    // Refrescar contexto con reload suave
    window.location.reload()
  }

  function copiarCodigo() {
    navigator.clipboard.writeText(codigoInv)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const esAdmin = tienePermiso('empresa.admin')
  const rubroActual = RUBROS.find(r => r.id === rubro)

  return (
    <div className="grid gap-4">

      {/* Header card */}
      <div className="bg-indigo-600 text-white rounded-3xl px-5 py-5 shadow-lg shadow-indigo-100">
        <p className="text-3xl mb-2">{rubroActual?.icon || '🏢'}</p>
        <h2 className="text-xl font-extrabold leading-tight">{nombre || 'Mi negocio'}</h2>
        <p className="text-sm text-indigo-200 mt-0.5">
          {condicion === 'monotributo' && `Monotributista Cat. ${categoriaMono}`}
          {condicion === 'responsable_inscripto' && 'Responsable Inscripto'}
          {condicion === 'exento' && 'Exento / Informal'}
          {cuit ? ` · ${cuit}` : ' · Sin CUIT cargado'}
        </p>
      </div>

      {!esAdmin && (
        <p className="text-center text-sm text-slate-400 py-2">Solo los administradores pueden editar estos datos.</p>
      )}

      {/* ── DATOS DEL NEGOCIO ── */}
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Tu negocio</p>

      <Campo label="Nombre">
        <input
          type="text"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          disabled={!esAdmin}
          className="w-full text-base font-bold text-slate-800 outline-none bg-transparent disabled:opacity-60"
        />
      </Campo>

      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Rubro</p>
        <div className="grid grid-cols-4 gap-2">
          {RUBROS.map(r => (
            <button key={r.id}
              onClick={() => esAdmin && setRubro(r.id)}
              className={`rounded-2xl py-3.5 px-1 flex flex-col items-center gap-1 transition-all active:scale-95 ${
                rubro === r.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                  : 'bg-white text-slate-500 shadow-sm'
              } ${!esAdmin ? 'opacity-60 cursor-default' : ''}`}
            >
              <span className="text-2xl">{r.icon}</span>
              <span className="text-[0.6rem] font-semibold leading-tight text-center">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── DATOS FISCALES ── */}
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mt-2">Datos fiscales</p>

      <Campo label="CUIT" sub="Formato: 20-12345678-9">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Sin CUIT cargado"
          value={cuit}
          onChange={e => setCuit(e.target.value)}
          disabled={!esAdmin}
          className="w-full text-base font-bold text-slate-800 outline-none bg-transparent disabled:opacity-60 placeholder:text-slate-300"
        />
      </Campo>

      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Condición fiscal</p>
        <div className="grid gap-2">
          {[
            { id: 'monotributo',          label: 'Monotributista',        sub: 'Categoría A–K' },
            { id: 'responsable_inscripto', label: 'Responsable Inscripto', sub: 'IVA discriminado' },
            { id: 'exento',               label: 'Exento / Informal',     sub: 'Sin obligaciones IVA' },
          ].map(c => (
            <button key={c.id}
              onClick={() => esAdmin && setCondicion(c.id)}
              className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all ${
                condicion === c.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                  : 'bg-white text-slate-600 shadow-sm'
              } ${!esAdmin ? 'opacity-60 cursor-default' : 'active:scale-[0.98]'}`}
            >
              <span className="font-bold text-sm">{c.label}</span>
              <span className={`text-xs ${condicion === c.id ? 'text-indigo-200' : 'text-slate-400'}`}>{c.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {condicion === 'monotributo' && (
        <div>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Categoría actual</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS_MONO.map(cat => (
              <button key={cat}
                onClick={() => esAdmin && setCategoriaMono(cat)}
                className={`w-10 h-10 rounded-2xl font-extrabold transition-all ${
                  categoriaMono === cat
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-white text-slate-500 shadow-sm'
                } ${!esAdmin ? 'opacity-60 cursor-default' : 'active:scale-95'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      <Campo label="Punto de venta ARCA" sub="Generalmente es 1 si no tenés uno asignado">
        <input
          type="number"
          inputMode="numeric"
          value={puntoVenta}
          onChange={e => setPuntoVenta(e.target.value)}
          disabled={!esAdmin}
          className="w-full text-base font-bold text-slate-800 outline-none bg-transparent disabled:opacity-60"
        />
      </Campo>

      {/* ── MÓDULOS DEL SISTEMA (solo lectura — los activa SAU) ── */}
      {esAdmin && (
        <>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mt-2">
            Módulos de tu negocio
          </p>
          <p className="text-xs text-slate-400 -mt-2 mb-1">
            Estos son los módulos activos en tu cuenta. Para sumar o quitar alguno, escribinos a SAU.
          </p>
          <div className="grid gap-2">
            {MODULOS.filter(mod => modulos.includes(mod.id)).map(mod => (
              <div
                key={mod.id}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-3xl border-2 border-indigo-200 bg-indigo-50 text-left"
              >
                <span className="text-3xl shrink-0">{mod.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-indigo-800">{mod.titulo}</p>
                    {mod.nucleo && (
                      <span className="text-[0.6rem] bg-indigo-100 text-indigo-500 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Base
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 leading-snug text-indigo-500">
                    {mod.descripcion}
                  </p>
                </div>
                <span className="shrink-0 text-emerald-500 text-lg font-bold">✓</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── CÓDIGO DE INVITACIÓN ── */}
      {esAdmin && codigoInv && (
        <>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mt-2">Equipo</p>
          <button onClick={copiarCodigo}
            className="bg-white rounded-3xl px-5 py-4 shadow-sm flex items-center justify-between active:scale-[0.98] transition-all"
          >
            <div>
              <p className="text-[0.65rem] text-slate-400 font-semibold uppercase tracking-widest mb-0.5">
                Código de invitación
              </p>
              <p className="text-xl font-extrabold text-slate-800 tracking-widest">{codigoInv}</p>
              <p className="text-xs text-slate-400 mt-0.5">Compartilo con tu equipo para que se unan</p>
            </div>
            <span className="text-2xl">{copiado ? '✅' : '📋'}</span>
          </button>
        </>
      )}

      {/* ── GUARDAR ── */}
      {esAdmin && (
        <>
          {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}
          {ok    && <p className="text-emerald-600 text-sm font-medium text-center">✅ Cambios guardados</p>}
          <button onClick={guardar} disabled={guardando}
            className="w-full py-5 rounded-3xl bg-indigo-600 text-white font-extrabold text-lg shadow-lg shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </>
      )}

    </div>
  )
}
