import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, hoyISO } from '../lib/format'
import { TECHO_MONO, RUBROS, CATEGORIAS_MONO, TODOS_PERMISOS } from '../lib/constants'
import { MODULOS, MODULOS_DEFAULT } from '../lib/modulos'

const COND_LABEL = {
  monotributo:           'Monotributo',
  responsable_inscripto: 'Resp. Inscripto',
  exento:                'Exento',
  no_inscripto:          'No inscripto',
}

function calcSemaforo({ sinCae, sinCuit, pctTecho, condicion }) {
  if (sinCae > 0 || (condicion === 'monotributo' && pctTecho > 100)) return 'rojo'
  if (sinCuit > 0 || (condicion === 'monotributo' && pctTecho > 80))  return 'amarillo'
  return 'verde'
}

const SEM = {
  verde:    { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Al día' },
  amarillo: { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-400',   label: 'Revisar' },
  rojo:     { bg: 'bg-red-100',     text: 'text-red-600',     dot: 'bg-red-500',     label: 'Urgente' },
}
const ORDEN_SEM = { rojo: 0, amarillo: 1, verde: 2, gris: 3 }

// ── Helpers ───────────────────────────────────────────────────────
function generarCodigo() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // sin caracteres ambiguos (i,l,o,0,1)
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ── Modal nuevo cliente ───────────────────────────────────────────
function ModalNuevoCliente({ onCerrar, onCreado }) {
  const { user } = useAuth()
  const [paso,         setPaso]        = useState(1)
  const [nombre,       setNombre]      = useState('')
  const [rubro,        setRubro]       = useState('')
  const [condicion,    setCondicion]   = useState('monotributo')
  const [categoria,    setCategoria]   = useState('C')
  const [cuit,         setCuit]        = useState('')
  const [pdv,          setPdv]         = useState('1')
  const [modulos,      setModulos]     = useState(MODULOS_DEFAULT)
  const [creando,      setCreando]     = useState(false)
  const [error,        setError]       = useState(null)
  const [codigoFinal,  setCodigoFinal] = useState(null)
  const [copiado,      setCopiado]     = useState(false)

  function irPaso2() {
    if (!nombre.trim()) return setError('Escribí el nombre del negocio')
    if (!rubro)         return setError('Elegí el rubro')
    setError(null); setPaso(2)
  }
  function irPaso3() { setError(null); setPaso(3) }

  function toggleModulo(id) {
    const mod = MODULOS.find(m => m.id === id)
    if (mod?.nucleo) return
    setModulos(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  async function crear() {
    setError(null); setCreando(true)
    const codigo = generarCodigo()

    // 1. Crear la empresa con la configuración del chaleco
    const { data: emp, error: errEmp } = await supabase
      .from('empresa')
      .insert({
        razon_social:          nombre.trim(),
        nombre_fantasia:       nombre.trim(),
        cuit:                  cuit.trim() || null,
        condicion_fiscal:      condicion,
        categoria_monotributo: condicion === 'monotributo' ? categoria : null,
        punto_de_venta:        parseInt(pdv) || 1,
        actividad:             rubro,
        modo_simulacion:       true,
        modulos_activos:       modulos,
        codigo_invitacion:     codigo,
      })
      .select('id')
      .single()

    if (errEmp) {
      setCreando(false)
      return setError('No se pudo crear la empresa. Intentá de nuevo.')
    }

    // 2. Vincular la contadora a la nueva empresa
    await supabase.from('membresia').insert({
      usuario_id: user.id,
      empresa_id: emp.id,
      rol:        'contadora',
      permisos:   TODOS_PERMISOS,
      activa:     true,
    })

    setCreando(false)
    setCodigoFinal(codigo)
    setPaso(4)
    onCreado?.()
  }

  function compartir() {
    const texto = `Hola! Te invito a usar SAU para gestionar tu negocio 🚀\nTu código de acceso: *${codigoFinal?.toUpperCase()}*\nIngresá en: ${window.location.origin}/unirse`
    navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="bg-white w-full max-w-[500px] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto">

        {/* Header del modal */}
        <div className="sticky top-0 bg-white px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between rounded-t-[2rem]">
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
              {paso < 4 ? `Paso ${paso} de 3` : 'Listo'}
            </p>
            <h2 className="font-extrabold text-slate-800">
              {paso === 1 && 'Datos del negocio'}
              {paso === 2 && 'Situación fiscal'}
              {paso === 3 && 'Módulos a activar'}
              {paso === 4 && '¡Cliente creado!'}
            </h2>
          </div>
          <button onClick={onCerrar}
            className="text-slate-400 hover:text-slate-600 text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100"
          >×</button>
        </div>

        <div className="px-5 py-5 grid gap-4">

          {/* ── PASO 1: nombre + rubro ── */}
          {paso === 1 && (
            <>
              <div className="bg-slate-50 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">
                  Nombre del negocio
                </p>
                <input
                  type="text"
                  placeholder="Ej: Almacén La Esquina"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  autoFocus
                  className="w-full text-xl font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Rubro</p>
                <div className="grid grid-cols-4 gap-2">
                  {RUBROS.map(r => (
                    <button key={r.id} onClick={() => setRubro(r.id)}
                      className={`rounded-2xl py-3 px-1 flex flex-col items-center gap-1 transition-all active:scale-95 ${
                        rubro === r.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-500'
                      }`}
                    >
                      <span className="text-2xl">{r.icon}</span>
                      <span className="text-[0.6rem] font-semibold leading-tight text-center">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              <button onClick={irPaso2}
                className="w-full py-4 rounded-3xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-100 active:scale-95 transition-all"
              >
                Continuar →
              </button>
            </>
          )}

          {/* ── PASO 2: fiscal ── */}
          {paso === 2 && (
            <>
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Condición fiscal</p>
                <div className="grid gap-2">
                  {[
                    { id: 'monotributo',           label: 'Monotributista',       sub: 'Categoría A–K' },
                    { id: 'responsable_inscripto',  label: 'Resp. Inscripto',      sub: 'IVA discriminado' },
                    { id: 'exento',                 label: 'Exento / Informal',    sub: 'Sin obligaciones IVA' },
                  ].map(c => (
                    <button key={c.id} onClick={() => setCondicion(c.id)}
                      className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98] ${
                        condicion === c.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      <span className="font-bold text-sm">{c.label}</span>
                      <span className={`text-xs ${condicion === c.id ? 'text-indigo-200' : 'text-slate-400'}`}>{c.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              {condicion === 'monotributo' && (
                <div>
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Categoría actual</p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIAS_MONO.map(cat => (
                      <button key={cat} onClick={() => setCategoria(cat)}
                        className={`w-10 h-10 rounded-2xl font-extrabold transition-all active:scale-95 ${
                          categoria === cat ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-500'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-slate-50 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">
                  CUIT <span className="normal-case font-normal">(opcional)</span>
                </p>
                <input type="text" inputMode="numeric" placeholder="20-12345678-9"
                  value={cuit} onChange={e => setCuit(e.target.value)}
                  className="w-full text-lg font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
              <div className="bg-slate-50 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Punto de venta ARCA</p>
                <input type="number" inputMode="numeric" placeholder="1"
                  value={pdv} onChange={e => setPdv(e.target.value)}
                  className="w-full text-lg font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPaso(1)}
                  className="py-4 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all"
                >← Volver</button>
                <button onClick={irPaso3}
                  className="py-4 rounded-3xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-100 active:scale-95 transition-all"
                >Continuar →</button>
              </div>
            </>
          )}

          {/* ── PASO 3: módulos (el chaleco) ── */}
          {paso === 3 && (
            <>
              <p className="text-sm text-slate-500 leading-relaxed">
                Activá solo los módulos que este cliente va a usar.
                Podrás cambiarlo en cualquier momento desde su perfil.
              </p>
              <div className="grid gap-2">
                {MODULOS.map(mod => {
                  const activo = modulos.includes(mod.id)
                  return (
                    <button key={mod.id} onClick={() => toggleModulo(mod.id)}
                      disabled={mod.nucleo}
                      className={`w-full flex items-center gap-4 px-4 py-4 rounded-3xl border-2 text-left transition-all active:scale-[0.98] ${
                        activo ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-100 opacity-50'
                      } ${mod.nucleo ? 'cursor-default' : ''}`}
                    >
                      <span className="text-3xl shrink-0">{mod.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-bold ${activo ? 'text-indigo-800' : 'text-slate-500'}`}>
                            {mod.titulo}
                          </p>
                          {mod.nucleo && (
                            <span className="text-[0.6rem] bg-indigo-100 text-indigo-500 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                              Base
                            </span>
                          )}
                        </div>
                        <p className={`text-xs mt-0.5 ${activo ? 'text-indigo-500' : 'text-slate-400'}`}>
                          {mod.descripcion}
                        </p>
                      </div>
                      {!mod.nucleo && (
                        <div className={`shrink-0 w-11 h-6 rounded-full transition-all relative ${activo ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${activo ? 'left-6' : 'left-1'}`} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPaso(2)}
                  className="py-4 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all"
                >← Volver</button>
                <button onClick={crear} disabled={creando}
                  className="py-4 rounded-3xl bg-emerald-600 text-white font-extrabold shadow-lg shadow-emerald-100 active:scale-95 transition-all disabled:opacity-50"
                >{creando ? 'Creando…' : '✓ Crear cliente'}</button>
              </div>
            </>
          )}

          {/* ── PASO 4: código para compartir ── */}
          {paso === 4 && (
            <>
              <div className="text-center py-4">
                <p className="text-5xl mb-3">🎉</p>
                <h3 className="text-xl font-extrabold text-slate-800 mb-1">{nombre}</h3>
                <p className="text-sm text-slate-500">fue dado de alta con el chaleco configurado</p>
              </div>
              <div className="bg-indigo-50 border-2 border-indigo-200 rounded-3xl p-5 text-center">
                <p className="text-xs text-indigo-400 font-semibold uppercase tracking-widest mb-2">
                  Código de acceso
                </p>
                <p className="text-4xl font-extrabold text-indigo-700 tracking-[0.3em] uppercase mb-2">
                  {codigoFinal}
                </p>
                <p className="text-xs text-indigo-400">
                  El cliente lo usa en <strong>/unirse</strong> para crear su cuenta
                </p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Módulos activados</p>
                <div className="flex flex-wrap gap-2">
                  {MODULOS.filter(m => modulos.includes(m.id)).map(m => (
                    <span key={m.id} className="flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1.5 rounded-full">
                      {m.icon} {m.titulo}
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={compartir}
                className={`w-full py-4 rounded-3xl font-extrabold text-base active:scale-95 transition-all ${
                  copiado ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                }`}
              >
                {copiado ? '✅ ¡Copiado! Pegalo en WhatsApp' : '📲 Copiar mensaje para WhatsApp'}
              </button>
              <button onClick={onCerrar}
                className="w-full py-3 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all"
              >
                Cerrar
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}

export default function Contadora() {
  const navigate = useNavigate()
  const [empresas,       setEmpresas]       = useState([])
  const [metricas,       setMetricas]       = useState({})
  const [cargando,       setCargando]       = useState(true)
  const [filtroText,     setFiltroText]     = useState('')
  const [filtroSem,      setFiltroSem]      = useState(null)
  const [modalNuevo,     setModalNuevo]     = useState(false)

  function recargar() {
    setCargando(true)
    cargarDatos()
  }

  async function cargarDatos() {
    const hoy = hoyISO()
    const hace12m = new Date(); hace12m.setFullYear(hace12m.getFullYear() - 1)
    const hace12mISO = hace12m.toISOString().slice(0, 10)

    const [
      { data: emps },
      { data: fac12m },
      { data: sinCaeRows },
      { data: sinCuitRows },
    ] = await Promise.all([
      supabase.from('empresa').select('*').eq('activa', true).order('razon_social'),
      supabase.from('venta').select('empresa_id, total')
        .eq('tipo_registro', 'fiscal')
        .eq('es_simulacion', false)
        .gte('fecha', hace12mISO).lte('fecha', hoy),
      supabase.from('venta').select('empresa_id')
        .eq('tipo_registro', 'fiscal').is('cae', null),
      supabase.from('compra').select('empresa_id').is('cuit_proveedor', null),
    ])

    const facPorEmp = {}, sinCaePorEmp = {}, sinCuitPorEmp = {}
    ;(fac12m      || []).forEach(v => { facPorEmp[v.empresa_id]     = (facPorEmp[v.empresa_id]     || 0) + Number(v.total) })
    ;(sinCaeRows  || []).forEach(v => { sinCaePorEmp[v.empresa_id]  = (sinCaePorEmp[v.empresa_id]  || 0) + 1 })
    ;(sinCuitRows || []).forEach(c => { sinCuitPorEmp[c.empresa_id] = (sinCuitPorEmp[c.empresa_id] || 0) + 1 })

    const mets = {}
    ;(emps || []).forEach(emp => {
      const fac    = facPorEmp[emp.id] || 0
      const techo  = TECHO_MONO[emp.categoria_monotributo]
      mets[emp.id] = {
        fac12m:    fac,
        sinCae:    sinCaePorEmp[emp.id]  || 0,
        sinCuit:   sinCuitPorEmp[emp.id] || 0,
        pctTecho:  techo ? (fac / techo * 100) : 0,
        condicion: emp.condicion_fiscal,
      }
    })
    setEmpresas(emps || [])
    setMetricas(mets)
    setCargando(false)
  }

  useEffect(() => { cargarDatos() }, [])

  const visibles = useMemo(() => {
    const f = filtroText.toLowerCase()
    return [...empresas]
      .filter(e => {
        const sem = calcSemaforo(metricas[e.id] || {})
        if (filtroSem && sem !== filtroSem) return false
        if (!f) return true
        return (e.razon_social    || '').toLowerCase().includes(f) ||
               (e.nombre_fantasia || '').toLowerCase().includes(f) ||
               (e.cuit            || '').includes(f)
      })
      .sort((a, b) =>
        ORDEN_SEM[calcSemaforo(metricas[a.id] || {})] -
        ORDEN_SEM[calcSemaforo(metricas[b.id] || {})]
      )
  }, [empresas, metricas, filtroText, filtroSem])

  const totales = useMemo(() => {
    const t = { rojo: 0, amarillo: 0, verde: 0, facturacion: 0 }
    empresas.forEach(e => {
      const sem = calcSemaforo(metricas[e.id] || {})
      t[sem] = (t[sem] || 0) + 1
      t.facturacion += (metricas[e.id]?.fac12m || 0)
    })
    return t
  }, [empresas, metricas])

  function toggleFiltroSem(key) {
    setFiltroSem(prev => prev === key ? null : key)
  }

  return (
    <div className="grid gap-4">

      {/* Métricas globales */}
      <div className="bg-indigo-600 text-white rounded-3xl p-5 shadow-lg shadow-indigo-100">
        <div className="flex items-start justify-between mb-1">
          <p className="text-indigo-300 text-xs font-semibold uppercase tracking-widest">
            Facturación total · últimos 12 meses
          </p>
          <button onClick={() => setModalNuevo(true)}
            className="bg-white/20 hover:bg-white/30 active:scale-95 transition-all text-white text-xs font-bold px-3 py-1.5 rounded-full shrink-0"
          >
            + Nuevo cliente
          </button>
        </div>
        <p className="text-3xl font-extrabold">{formatPesos(totales.facturacion)}</p>
        <p className="text-indigo-200 text-sm mt-1">{empresas.length} empresas activas</p>
      </div>

      {/* Semáforos clickeables */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'rojo',     label: 'Urgentes', bg: 'bg-red-50',     bgA: 'bg-red-500',     text: 'text-red-500',     textA: 'text-white' },
          { key: 'amarillo', label: 'Revisar',  bg: 'bg-amber-50',   bgA: 'bg-amber-500',   text: 'text-amber-500',   textA: 'text-white' },
          { key: 'verde',    label: 'Al día',   bg: 'bg-emerald-50', bgA: 'bg-emerald-500', text: 'text-emerald-600', textA: 'text-white' },
        ].map(({ key, label, bg, bgA, text, textA }) => {
          const activo = filtroSem === key
          return (
            <button key={key} onClick={() => toggleFiltroSem(key)}
              className={`rounded-3xl p-4 text-center transition-all active:scale-95 ${activo ? bgA : bg}`}
            >
              <p className={`text-2xl font-extrabold ${activo ? textA : text}`}>{totales[key] || 0}</p>
              <p className={`text-xs font-semibold mt-0.5 ${activo ? 'text-white/80' : text}`}>{label}</p>
            </button>
          )
        })}
      </div>

      {/* Buscador */}
      <input type="text" placeholder="Buscar empresa o CUIT…" value={filtroText}
        onChange={e => setFiltroText(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl bg-white shadow-sm outline-none text-slate-700 placeholder:text-slate-300"
      />

      {filtroSem && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400 font-semibold">
            Mostrando: <span className="text-slate-700 font-bold">{SEM[filtroSem]?.label}</span> ({visibles.length})
          </p>
          <button onClick={() => setFiltroSem(null)} className="text-xs text-indigo-500 font-bold">
            Ver todos
          </button>
        </div>
      )}

      {cargando && <p className="text-center text-slate-400 py-8 text-sm">Cargando clientes…</p>}

      {/* Lista de empresas */}
      {visibles.map(emp => {
        const m   = metricas[emp.id] || {}
        const sem = calcSemaforo(m)
        const cfg = SEM[sem] || SEM.verde
        const alertas = (m.sinCae || 0) + (m.sinCuit || 0)

        return (
          <button key={emp.id} onClick={() => navigate(`/contadora/${emp.id}`)}
            className="bg-white rounded-3xl p-4 shadow-sm text-left w-full active:scale-95 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-indigo-100 flex items-center justify-center font-extrabold text-indigo-600 text-lg shrink-0">
                {(emp.nombre_fantasia || emp.razon_social)?.[0]?.toUpperCase() || '?'}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 truncate">
                  {emp.nombre_fantasia || emp.razon_social}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {COND_LABEL[emp.condicion_fiscal] || emp.condicion_fiscal}
                  {emp.categoria_monotributo ? ` · Cat. ${emp.categoria_monotributo}` : ''}
                  {emp.cuit ? ` · ${emp.cuit}` : ' · Sin CUIT'}
                </p>
                {m.condicion === 'monotributo' && m.pctTecho > 0 && (
                  <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${m.pctTecho > 100 ? 'bg-red-500' : m.pctTecho > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.min(m.pctTecho, 100)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-2xl ${cfg.bg} ${cfg.text}`}>
                <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-xs font-bold">{cfg.label}</span>
                {alertas > 0 && <span className="text-xs font-extrabold">({alertas})</span>}
              </div>
            </div>
          </button>
        )
      })}

      {!cargando && visibles.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-4xl mb-3">🏢</p>
          <p className="font-medium">{filtroText ? 'No encontramos esa empresa' : 'Sin empresas en esta categoría'}</p>
          {!filtroText && !filtroSem && (
            <button onClick={() => setModalNuevo(true)}
              className="mt-4 px-6 py-3 rounded-2xl bg-indigo-600 text-white font-bold text-sm active:scale-95 transition-all"
            >
              + Agregar primer cliente
            </button>
          )}
        </div>
      )}

      {modalNuevo && (
        <ModalNuevoCliente
          onCerrar={() => setModalNuevo(false)}
          onCreado={recargar}
        />
      )}
    </div>
  )
}
