import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { RUBROS, CATEGORIAS_MONO, TODOS_PERMISOS } from '../lib/constants'

export default function Registro() {
  const { user } = useAuth()

  const [paso, setPaso] = useState(1)
  const [nombre, setNombre]   = useState('')
  const [rubro, setRubro]     = useState('')
  const [cuit, setCuit]       = useState('')
  const [condicion, setCondicion] = useState('monotributo')
  const [categoriaMono, setCategoriaMono] = useState('C')
  const [puntoVenta, setPuntoVenta] = useState('1')
  const [creando, setCreando] = useState(false)
  const [error, setError]     = useState(null)

  function irPaso2() {
    if (!nombre.trim()) return setError('Escribí el nombre de tu negocio')
    if (!rubro) return setError('Elegí el rubro de tu negocio')
    setError(null)
    setPaso(2)
  }

  async function crear() {
    setError(null)
    setCreando(true)

    const { data: empresa, error: errEmpresa } = await supabase
      .from('empresa')
      .insert({
        razon_social:          nombre.trim(),
        nombre_fantasia:       nombre.trim(),
        cuit:                  cuit.trim() || null,
        condicion_fiscal:      condicion,
        categoria_monotributo: condicion === 'monotributo' ? categoriaMono : null,
        punto_de_venta:        parseInt(puntoVenta) || 1,
        actividad:             rubro,
        modo_simulacion:       true,
      })
      .select('id')
      .single()

    if (errEmpresa) {
      setCreando(false)
      return setError('No se pudo crear la empresa. Intentá de nuevo.')
    }

    const { error: errMem } = await supabase
      .from('membresia')
      .insert({
        usuario_id: user.id,
        empresa_id: empresa.id,
        rol:        'admin',
        permisos:   TODOS_PERMISOS,
        activa:     true,
      })

    if (errMem) {
      setCreando(false)
      return setError('La empresa fue creada pero no se pudo asignar tu usuario. Contactá soporte.')
    }

    window.location.href = '/'
  }

  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <div className="bg-indigo-600 text-white px-6 pt-10 pb-8 rounded-b-[2rem]">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-300 mb-1">SAU</p>
        <h1 className="text-2xl font-extrabold">Configurá tu negocio</h1>
        <p className="text-sm text-indigo-200 mt-1">Solo tarda 2 minutos</p>

        {/* Indicador de pasos */}
        <div className="flex items-center gap-2 mt-5">
          <div className={`h-2 flex-1 rounded-full transition-all ${paso >= 1 ? 'bg-white' : 'bg-indigo-400'}`} />
          <div className={`h-2 flex-1 rounded-full transition-all ${paso >= 2 ? 'bg-white' : 'bg-indigo-400'}`} />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[0.65rem] text-indigo-200">Tu negocio</span>
          <span className="text-[0.65rem] text-indigo-200">Datos fiscales</span>
        </div>
      </div>

      <div className="flex-1 px-5 pt-6 pb-10 grid gap-5">

        {/* ── PASO 1 ── */}
        {paso === 1 && (
          <>
            {/* Nombre */}
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
                ¿Cómo se llama tu negocio?
              </p>
              <input
                type="text"
                placeholder="Ej: Almacén La Esquina"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                autoFocus
                className="w-full text-xl font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-200"
              />
            </div>

            {/* Rubro */}
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
                ¿A qué se dedica?
              </p>
              <div className="grid grid-cols-4 gap-2">
                {RUBROS.map(r => (
                  <button key={r.id} onClick={() => setRubro(r.id)}
                    className={`rounded-2xl py-3.5 px-1 flex flex-col items-center gap-1 transition-all active:scale-95 ${
                      rubro === r.id
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                        : 'bg-white text-slate-500 shadow-sm'
                    }`}
                  >
                    <span className="text-2xl">{r.icon}</span>
                    <span className="text-[0.6rem] font-semibold leading-tight text-center">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

            <button onClick={irPaso2}
              className="w-full py-5 rounded-3xl bg-indigo-600 text-white font-extrabold text-lg shadow-lg shadow-indigo-100 active:scale-95 transition-all"
            >
              Continuar →
            </button>
          </>
        )}

        {/* ── PASO 2 ── */}
        {paso === 2 && (
          <>
            {/* Condición fiscal */}
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
                Condición fiscal
              </p>
              <div className="grid gap-2">
                {[
                  { id: 'monotributo',        label: 'Monotributista',       sub: 'Categoría A–K' },
                  { id: 'responsable_inscripto', label: 'Responsable Inscripto', sub: 'IVA discriminado' },
                  { id: 'exento',             label: 'Exento / Informal',    sub: 'Sin obligaciones IVA' },
                ].map(c => (
                  <button key={c.id} onClick={() => setCondicion(c.id)}
                    className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all active:scale-[0.98] ${
                      condicion === c.id
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                        : 'bg-white text-slate-600 shadow-sm'
                    }`}
                  >
                    <span className="font-bold text-sm">{c.label}</span>
                    <span className={`text-xs ${condicion === c.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {c.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Categoría monotributo */}
            {condicion === 'monotributo' && (
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
                  Categoría actual
                </p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIAS_MONO.map(cat => (
                    <button key={cat} onClick={() => setCategoriaMono(cat)}
                      className={`w-10 h-10 rounded-2xl font-extrabold transition-all active:scale-95 ${
                        categoriaMono === cat
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-white text-slate-500 shadow-sm'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CUIT */}
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">
                CUIT <span className="normal-case font-normal">(podés completarlo después)</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="20-12345678-9"
                value={cuit}
                onChange={e => setCuit(e.target.value)}
                className="w-full text-lg font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-200"
              />
            </div>

            {/* Punto de venta */}
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">
                Punto de venta ARCA
              </p>
              <input
                type="number"
                inputMode="numeric"
                placeholder="1"
                value={puntoVenta}
                onChange={e => setPuntoVenta(e.target.value)}
                className="w-full text-lg font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-200"
              />
              <p className="text-xs text-slate-400 mt-1">Generalmente es 1 si no tenés uno asignado</p>
            </div>

            {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

            <div className="grid gap-3">
              <button onClick={crear} disabled={creando}
                className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-lg shadow-emerald-100 active:scale-95 transition-all disabled:opacity-50"
              >
                {creando ? 'Creando tu espacio…' : '🚀 Empezar en modo práctica'}
              </button>
              <button onClick={() => { setError(null); setPaso(1) }}
                className="w-full py-3 rounded-3xl bg-white text-slate-500 font-bold shadow-sm active:scale-95 transition-all"
              >
                ← Volver
              </button>
            </div>

            <p className="text-xs text-slate-400 text-center leading-relaxed">
              Vas a entrar en <strong>modo práctica</strong> — podés cargar datos reales
              para aprender el sistema sin comprometer nada fiscal.
            </p>
          </>
        )}

      </div>
    </div>
  )
}
