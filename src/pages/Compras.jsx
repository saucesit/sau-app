import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, hoyISO } from '../lib/format'

// ── Lector de factura por foto ────────────────────────────────────
function FormFotoFactura({ empresaActivaId, userId, esPractica, onGuardado }) {
  const [fase,     setFase]     = useState('idle') // idle | leyendo | revision | guardando | guardado
  const [fotoURL,  setFotoURL]  = useState(null)
  const [factura,  setFactura]  = useState(null)
  const [alertas,  setAlertas]  = useState([])
  const [error,    setError]    = useState(null)
  const inputRef = useRef()

  async function onFoto(e) {
    const file = e.target.files[0]
    if (!file) return
    setFase('leyendo')
    setError(null)

    try {
      // Subir foto a Storage
      const ext      = file.name.split('.').pop() || 'jpg'
      const fileName = `facturas/${empresaActivaId}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('consultas')
        .upload(fileName, file, { contentType: file.type, upsert: false })
      if (upErr) throw new Error('No se pudo subir la foto')

      const { data: { publicUrl } } = supabase.storage.from('consultas').getPublicUrl(fileName)
      setFotoURL(publicUrl)

      // Llamar a la Edge Function
      const { data, error: fnErr } = await supabase.functions.invoke('leer-factura', {
        body: { foto_url: publicUrl, empresa_id: empresaActivaId }
      })
      if (fnErr) throw fnErr
      if (!data?.ok) throw new Error(data?.error || 'Error al leer la factura')

      setFactura(data.factura)
      setAlertas(data.alertas || [])
      setFase('revision')
    } catch (e) {
      setError(e.message || 'No se pudo leer la factura')
      setFase('idle')
    }
  }

  async function confirmar() {
    if (!factura) return
    setFase('guardando')

    try {
      // Buscar o crear proveedor
      let proveedorId = null
      if (factura.proveedor) {
        const { data: prov } = await supabase.from('proveedor')
          .select('id').eq('empresa_id', empresaActivaId).ilike('nombre', factura.proveedor).single()
        if (prov) {
          proveedorId = prov.id
        } else {
          const { data: nuevo } = await supabase.from('proveedor')
            .insert({ empresa_id: empresaActivaId, nombre: factura.proveedor }).select('id').single()
          proveedorId = nuevo?.id
        }
      }

      // Guardar compra con items
      await supabase.from('compra').insert({
        empresa_id:     empresaActivaId,
        proveedor_id:   proveedorId,
        nro_factura:    factura.nro_factura,
        neto:           factura.neto || factura.total || 0,
        iva:            factura.iva_monto || 0,
        total:          factura.total || 0,
        categoria:      'mercaderia',
        medio_pago:     'transferencia',
        cargado_por:    userId,
        es_simulacion:  esPractica,
        foto_url:       fotoURL,
        items_factura:  factura.items || [],
      })

      // Actualizar precio_costo de productos que matchearon
      for (const alerta of alertas) {
        if (alerta.precio_nuevo > 0) {
          await supabase.from('producto')
            .update({ precio_costo: alerta.precio_nuevo })
            .eq('id', alerta.producto_id)
        }
      }

      setFase('guardado')
      setTimeout(() => { setFase('idle'); setFactura(null); setAlertas([]); setFotoURL(null); onGuardado() }, 2500)
    } catch (e) {
      setError('No se pudo guardar')
      setFase('revision')
    }
  }

  function reset() { setFase('idle'); setFactura(null); setAlertas([]); setFotoURL(null); setError(null); if (inputRef.current) inputRef.current.value = '' }

  if (fase === 'idle') return (
    <div className="grid gap-3">
      <label className="flex flex-col items-center justify-center gap-3 bg-white rounded-3xl p-8 shadow-sm cursor-pointer active:scale-95 transition-all border-2 border-dashed border-orange-200 hover:border-orange-400">
        <span className="text-5xl">📸</span>
        <div className="text-center">
          <p className="font-extrabold text-slate-700 text-lg">Fotografiá la factura</p>
          <p className="text-slate-400 text-sm mt-1">SAU lee todos los items, precios y calcula tu margen</p>
        </div>
        <span className="bg-orange-500 text-white font-extrabold px-6 py-3 rounded-full text-sm">Abrir cámara / galería</span>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFoto} />
      </label>
      {error && <p className="text-red-500 text-sm text-center">{error}</p>}
    </div>
  )

  if (fase === 'leyendo') return (
    <div className="bg-white rounded-3xl p-10 shadow-sm flex flex-col items-center gap-4">
      <div className="w-14 h-14 rounded-full border-4 border-orange-500 border-t-transparent animate-spin" />
      <p className="font-extrabold text-slate-700">Leyendo la factura...</p>
      <p className="text-slate-400 text-sm text-center">La IA está extrayendo productos, precios e IVA</p>
    </div>
  )

  if (fase === 'revision' && factura) return (
    <div className="grid gap-3">
      {/* Header */}
      <div className="bg-white rounded-3xl px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="font-extrabold text-slate-800 text-lg">{factura.proveedor || 'Proveedor desconocido'}</p>
          {factura.tipo_factura && <span className="bg-orange-100 text-orange-600 font-extrabold px-3 py-1 rounded-full text-sm">Factura {factura.tipo_factura}</span>}
        </div>
        <div className="flex gap-4 text-xs text-slate-400">
          {factura.fecha && <span>📅 {factura.fecha}</span>}
          {factura.nro_factura && <span>🧾 {factura.nro_factura}</span>}
        </div>
      </div>

      {/* Alertas de precio */}
      {alertas.length > 0 && (
        <div className="grid gap-2">
          {alertas.map((a, i) => (
            <div key={i} className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${a.subio ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              <span className="text-xl">{a.subio ? '📈' : '📉'}</span>
              <div className="flex-1">
                <p className="font-bold text-sm text-slate-700">{a.nombre}</p>
                <p className={`text-xs font-semibold ${a.subio ? 'text-red-600' : 'text-emerald-600'}`}>
                  {a.subio ? '↑' : '↓'} {Math.abs(a.variacion)}% — ${a.precio_anterior?.toLocaleString()} → ${a.precio_nuevo?.toLocaleString()}
                </p>
              </div>
              <span className={`font-extrabold text-sm ${a.subio ? 'text-red-500' : 'text-emerald-500'}`}>
                {a.subio ? `+${a.variacion}%` : `${a.variacion}%`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Items */}
      {factura.items?.length > 0 && (
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest px-5 pt-4 pb-2">Items detectados</p>
          {factura.items.map((item, i) => (
            <div key={i} className="px-5 py-3 border-t border-slate-50 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-700 truncate">{item.nombre}</p>
                <p className="text-xs text-slate-400">{item.cantidad} × ${item.precio_unitario?.toLocaleString()}</p>
              </div>
              <p className="font-extrabold text-slate-800 shrink-0">${item.subtotal?.toLocaleString()}</p>
            </div>
          ))}
          <div className="px-5 py-4 bg-slate-50 border-t border-slate-100">
            {factura.neto > 0 && <div className="flex justify-between text-sm text-slate-500 mb-1"><span>Neto</span><span>${factura.neto?.toLocaleString()}</span></div>}
            {factura.iva_monto > 0 && <div className="flex justify-between text-sm text-slate-500 mb-1"><span>IVA {factura.iva_porcentaje}%</span><span>${factura.iva_monto?.toLocaleString()}</span></div>}
            <div className="flex justify-between font-extrabold text-slate-800 text-base"><span>Total</span><span>${factura.total?.toLocaleString()}</span></div>
          </div>
        </div>
      )}

      {error && <p className="text-red-500 text-sm text-center">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={reset} className="py-4 rounded-3xl bg-slate-100 text-slate-500 font-bold active:scale-95">Cancelar</button>
        <button onClick={confirmar} className="py-4 rounded-3xl bg-orange-500 text-white font-extrabold shadow-lg shadow-orange-100 active:scale-95">
          ✓ Confirmar
        </button>
      </div>
    </div>
  )

  if (fase === 'guardando') return (
    <div className="bg-white rounded-3xl p-10 shadow-sm flex flex-col items-center gap-3">
      <div className="w-10 h-10 rounded-full border-4 border-orange-500 border-t-transparent animate-spin" />
      <p className="text-slate-500 font-semibold">Guardando...</p>
    </div>
  )

  if (fase === 'guardado') return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-8 flex flex-col items-center gap-3">
      <span className="text-4xl">✅</span>
      <p className="font-extrabold text-emerald-700 text-lg text-center">¡Factura registrada!</p>
      {alertas.length > 0 && <p className="text-emerald-600 text-sm text-center">Precios de {alertas.length} producto{alertas.length > 1 ? 's' : ''} actualizados</p>}
    </div>
  )

  return null
}

const CATEGORIAS = [
  { id: 'mercaderia',         label: 'Mercadería',      icon: '📦' },
  { id: 'servicios',          label: 'Servicios',       icon: '🔧' },
  { id: 'alquiler',           label: 'Alquiler',        icon: '🏠' },
  { id: 'servicios_publicos', label: 'Servicios públicos', icon: '💡' },
  { id: 'transporte',         label: 'Transporte',      icon: '🚗' },
  { id: 'limpieza',           label: 'Limpieza',        icon: '🧹' },
  { id: 'mantenimiento',      label: 'Mantenimiento',   icon: '⚙️' },
  { id: 'personal',           label: 'Personal',        icon: '👤' },
  { id: 'impuestos',          label: 'Impuestos',       icon: '🏛️' },
  { id: 'otro',               label: 'Otro',            icon: '🔖' },
]

const MEDIOS = [
  { id: 'efectivo',      label: 'Efectivo',    icon: '💵' },
  { id: 'tarjeta',       label: 'Tarjeta',     icon: '💳' },
  { id: 'transferencia', label: 'Transfer.',   icon: '🏦' },
  { id: 'mercadopago',   label: 'MP',          icon: '📲' },
]

const IVA_ALICUOTAS = [
  { id: 0,    label: 'Sin IVA' },
  { id: 10.5, label: 'IVA 10.5%' },
  { id: 21,   label: 'IVA 21%' },
  { id: 27,   label: 'IVA 27%' },
]

// ── Formulario: Factura de proveedor ──────────────────────────────
function FormCompra({ empresaActivaId, userId, esPractica, onGuardado }) {
  const [proveedor, setProveedor] = useState('')
  const [nroFactura, setNroFactura] = useState('')
  const [neto, setNeto] = useState('')
  const [alicuota, setAlicuota] = useState(21)
  const [categoria, setCategoria] = useState('mercaderia')
  const [medio, setMedio] = useState('transferencia')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const netoVal = parseFloat((neto || '').replace(',', '.')) || 0
  const ivaVal  = parseFloat((netoVal * alicuota / 100).toFixed(2))
  const total   = parseFloat((netoVal + ivaVal).toFixed(2))

  async function guardar() {
    if (netoVal <= 0) return setError('Ingresá el monto neto')
    setError(null); setGuardando(true)

    // Crear o buscar proveedor si se ingresó nombre
    let proveedorId = null
    if (proveedor.trim()) {
      const { data: provExistente } = await supabase
        .from('proveedor')
        .select('id')
        .eq('empresa_id', empresaActivaId)
        .ilike('nombre', proveedor.trim())
        .single()

      if (provExistente) {
        proveedorId = provExistente.id
      } else {
        const { data: nuevo } = await supabase
          .from('proveedor')
          .insert({ empresa_id: empresaActivaId, nombre: proveedor.trim() })
          .select('id').single()
        proveedorId = nuevo?.id || null
      }
    }

    const { error } = await supabase.from('compra').insert({
      empresa_id:    empresaActivaId,
      proveedor_id:  proveedorId,
      nro_factura:   nroFactura.trim() || null,
      neto:          netoVal,
      iva:           ivaVal,
      total,
      categoria,
      medio_pago:    medio,
      cargado_por:   userId,
      es_simulacion: esPractica,
    })
    setGuardando(false)
    if (error) return setError('No se pudo guardar.')
    setProveedor(''); setNroFactura(''); setNeto('')
    onGuardado()
  }

  return (
    <div className="grid gap-3">
      {/* Proveedor */}
      <input
        type="text"
        placeholder="Proveedor (opcional)"
        value={proveedor}
        onChange={e => setProveedor(e.target.value)}
        className="w-full px-5 py-4 rounded-3xl bg-white shadow-sm outline-none text-slate-700 placeholder:text-slate-300"
      />

      {/* Neto */}
      <div className="bg-white rounded-3xl p-5 shadow-sm">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Monto neto</p>
        <div className="flex items-center gap-1">
          <span className="text-2xl font-extrabold text-slate-300">$</span>
          <input
            type="number" inputMode="decimal" placeholder="0"
            value={neto} onChange={e => setNeto(e.target.value)}
            className="text-4xl font-extrabold text-slate-800 outline-none w-full bg-transparent"
          />
        </div>

        {/* Alícuota IVA */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {IVA_ALICUOTAS.map(a => (
            <button key={a.id} onClick={() => setAlicuota(a.id)}
              className={`px-3 py-1.5 rounded-2xl text-xs font-bold transition-all ${
                alicuota === a.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >{a.label}</button>
          ))}
        </div>

        {netoVal > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-sm">
            <span className="text-slate-400">IVA {alicuota}%</span>
            <span className="text-slate-600 font-semibold">{formatPesos(ivaVal)}</span>
          </div>
        )}
        {netoVal > 0 && (
          <div className="flex justify-between text-base font-extrabold mt-1">
            <span className="text-slate-700">Total</span>
            <span className="text-slate-800">{formatPesos(total)}</span>
          </div>
        )}
      </div>

      {/* Nro factura */}
      <input
        type="text"
        placeholder="Nro. factura (opcional)"
        value={nroFactura}
        onChange={e => setNroFactura(e.target.value)}
        className="w-full px-5 py-4 rounded-3xl bg-white shadow-sm outline-none text-slate-700 placeholder:text-slate-300"
      />

      {/* Categoría */}
      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Categoría</p>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIAS.slice(0, 8).map(c => (
            <button key={c.id} onClick={() => setCategoria(c.id)}
              className={`rounded-2xl py-3 px-1 text-center transition-all active:scale-95 ${
                categoria === c.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 shadow-sm'
              }`}
            >
              <span className="text-lg block">{c.icon}</span>
              <span className="text-[0.6rem] font-semibold mt-0.5 block leading-tight">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Medio de pago */}
      <div className="grid grid-cols-4 gap-2">
        {MEDIOS.map(m => (
          <button key={m.id} onClick={() => setMedio(m.id)}
            className={`rounded-2xl py-3 px-1 text-center transition-all active:scale-95 ${
              medio === m.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 shadow-sm'
            }`}
          >
            <span className="text-xl block">{m.icon}</span>
            <span className="text-[0.6rem] font-semibold mt-0.5 block">{m.label}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

      <button onClick={guardar} disabled={guardando || netoVal <= 0}
        className="w-full py-5 rounded-3xl bg-orange-500 text-white font-extrabold text-lg shadow-lg shadow-orange-100 disabled:opacity-40 active:scale-95 transition-all"
      >
        {guardando ? 'Guardando…' : '✓ Registrar factura'}
      </button>
    </div>
  )
}


// ── Formulario: Gasto rápido ──────────────────────────────────────
function FormGasto({ empresaActivaId, userId, esPractica, onGuardado }) {
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [categoria, setCategoria] = useState('otro')
  const [medio, setMedio] = useState('efectivo')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const valor = parseFloat((monto || '').replace(',', '.')) || 0

  async function guardar() {
    if (valor <= 0) return setError('Ingresá un monto válido')
    if (!concepto.trim()) return setError('Escribí un concepto')
    setError(null); setGuardando(true)
    const { error } = await supabase.from('gasto').insert({
      empresa_id:    empresaActivaId,
      concepto:      concepto.trim(),
      monto:         valor,
      categoria,
      medio_pago:    medio,
      cargado_por:   userId,
      es_simulacion: esPractica,
    })
    setGuardando(false)
    if (error) return setError('No se pudo guardar.')
    setConcepto(''); setMonto('')
    onGuardado()
  }

  return (
    <div className="grid gap-3">
      <div className="bg-white rounded-3xl p-5 shadow-sm">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">¿Cuánto gastaste?</p>
        <div className="flex items-center gap-1">
          <span className="text-2xl font-extrabold text-slate-300">$</span>
          <input
            type="number" inputMode="decimal" placeholder="0"
            value={monto} onChange={e => setMonto(e.target.value)} autoFocus
            className="text-4xl font-extrabold text-slate-800 outline-none w-full bg-transparent"
          />
        </div>
      </div>

      <input
        type="text" placeholder="Concepto (ej: escoba, nafta, delivery)"
        value={concepto} onChange={e => setConcepto(e.target.value)}
        className="w-full px-5 py-4 rounded-3xl bg-white shadow-sm outline-none text-slate-700 placeholder:text-slate-300"
      />

      {/* Categoría */}
      <div className="grid grid-cols-4 gap-2">
        {CATEGORIAS.slice(0, 8).map(c => (
          <button key={c.id} onClick={() => setCategoria(c.id)}
            className={`rounded-2xl py-3 px-1 text-center transition-all active:scale-95 ${
              categoria === c.id ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-slate-500 shadow-sm'
            }`}
          >
            <span className="text-lg block">{c.icon}</span>
            <span className="text-[0.6rem] font-semibold mt-0.5 block leading-tight">{c.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {MEDIOS.map(m => (
          <button key={m.id} onClick={() => setMedio(m.id)}
            className={`rounded-2xl py-3 px-1 text-center transition-all active:scale-95 ${
              medio === m.id ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-slate-500 shadow-sm'
            }`}
          >
            <span className="text-xl block">{m.icon}</span>
            <span className="text-[0.6rem] font-semibold mt-0.5 block">{m.label}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

      <button onClick={guardar} disabled={guardando || valor <= 0}
        className="w-full py-5 rounded-3xl bg-orange-500 text-white font-extrabold text-lg shadow-lg shadow-orange-100 disabled:opacity-40 active:scale-95 transition-all"
      >
        {guardando ? 'Guardando…' : '✓ Registrar gasto'}
      </button>
    </div>
  )
}


// ── Pantalla principal ────────────────────────────────────────────
export default function Compras() {
  const { empresaActivaId, empresaActiva, user } = useAuth()
  const esPractica = empresaActiva?.modo_simulacion ?? false
  const [modo, setModo] = useState('gasto')        // 'factura' | 'gasto' | 'foto'
  const [recientes, setRecientes] = useState([])
  const [ok, setOk] = useState(false)

  const cargarRecientes = useCallback(async () => {
    if (!empresaActivaId) return
    const hoy = hoyISO()
    const [{ data: compras }, { data: gastos }] = await Promise.all([
      supabase.from('compra').select('id, total, categoria, proveedor_id, creado_en')
        .eq('empresa_id', empresaActivaId).eq('fecha', hoy).order('creado_en', { ascending: false }).limit(5),
      supabase.from('gasto').select('id, monto, concepto, categoria, creado_en')
        .eq('empresa_id', empresaActivaId).eq('fecha', hoy).order('creado_en', { ascending: false }).limit(5),
    ])
    const todos = [
      ...(compras || []).map(c => ({ ...c, _tipo: 'factura', monto: c.total })),
      ...(gastos  || []).map(g => ({ ...g, _tipo: 'gasto' })),
    ].sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en)).slice(0, 6)
    setRecientes(todos)
  }, [empresaActivaId])

  useEffect(() => { cargarRecientes() }, [cargarRecientes])

  function handleGuardado() {
    setOk(true)
    cargarRecientes()
    setTimeout(() => setOk(false), 1400)
  }

  const catIcon = (id) => CATEGORIAS.find(c => c.id === id)?.icon || '🔖'

  return (
    <div className="grid gap-4">

      {/* Toggle Factura / Gasto / Foto */}
      <div className="grid grid-cols-3 gap-2 bg-white rounded-3xl p-1.5 shadow-sm">
        <button onClick={() => setModo('factura')}
          className={`rounded-2xl py-3 font-bold text-xs transition-all ${
            modo === 'factura' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-400'
          }`}
        >
          🧾 Factura
        </button>
        <button onClick={() => setModo('gasto')}
          className={`rounded-2xl py-3 font-bold text-xs transition-all ${
            modo === 'gasto' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-400'
          }`}
        >
          💸 Gasto
        </button>
        <button onClick={() => setModo('foto')}
          className={`rounded-2xl py-3 font-bold text-xs transition-all ${
            modo === 'foto' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-400'
          }`}
        >
          📸 Foto IA
        </button>
      </div>

      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-3xl py-3 text-center text-emerald-600 font-bold text-sm">
          ✅ ¡Registrado!
        </div>
      )}

      {modo === 'factura' && <FormCompra     empresaActivaId={empresaActivaId} userId={user?.id} esPractica={esPractica} onGuardado={handleGuardado} />}
      {modo === 'gasto'   && <FormGasto      empresaActivaId={empresaActivaId} userId={user?.id} esPractica={esPractica} onGuardado={handleGuardado} />}
      {modo === 'foto'    && <FormFotoFactura empresaActivaId={empresaActivaId} userId={user?.id} esPractica={esPractica} onGuardado={handleGuardado} />}

      {/* Recientes del día */}
      {recientes.length > 0 && (
        <div className="grid gap-2 mt-1">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Cargado hoy</p>
          {recientes.map(r => (
            <div key={r.id} className="bg-white rounded-3xl px-5 py-4 shadow-sm flex items-center gap-3">
              <span className="text-xl">{catIcon(r.categoria)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">
                  {r._tipo === 'factura' ? '🧾 Factura' : r.concepto}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {r._tipo === 'factura' ? 'Proveedor' : CATEGORIAS.find(c => c.id === r.categoria)?.label}
                </p>
              </div>
              <p className="font-extrabold text-orange-500 shrink-0">{formatPesos(r.monto)}</p>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
