import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, formatFecha } from '../lib/format'

const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'par', 'caja', 'pack', 'docena']

// ── Helpers ───────────────────────────────────────────────────────
function estadoStock(actual, minimo) {
  if (actual <= 0)          return 'sin'
  if (actual <= minimo)     return 'bajo'
  if (actual <= minimo * 2) return 'alerta'
  return 'ok'
}

const ESTADO_ESTILO = {
  sin:    { dot: 'bg-red-500',    badge: 'bg-red-50 text-red-600 border-red-100',    label: 'Sin stock' },
  bajo:   { dot: 'bg-red-400',    badge: 'bg-red-50 text-red-500 border-red-100',    label: 'Bajo mínimo' },
  alerta: { dot: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-600 border-amber-100', label: 'Stock bajo' },
  ok:     { dot: 'bg-emerald-500',badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'OK' },
}

const TIPO_MOV = {
  entrada: { label: 'Entrada', color: 'text-emerald-600', bg: 'bg-emerald-50', signo: '+' },
  salida:  { label: 'Salida',  color: 'text-red-500',     bg: 'bg-red-50',     signo: '−' },
  ajuste:  { label: 'Ajuste',  color: 'text-indigo-600',  bg: 'bg-indigo-50',  signo: '↺' },
}

// ── Modal Nuevo / Editar Producto ─────────────────────────────────
function ModalProducto({ producto, empresaId, esPractica, onGuardado, onCerrar }) {
  const esEdicion = !!producto
  const [nombre,       setNombre]       = useState(producto?.nombre       || '')
  const [descripcion,  setDescripcion]  = useState(producto?.descripcion  || '')
  const [sku,          setSku]          = useState(producto?.sku          || '')
  const [categoria,    setCategoria]    = useState(producto?.categoria    || '')
  const [precioCosto,  setPrecioCosto]  = useState(producto?.precio_costo ?? '')
  const [precioVenta,  setPrecioVenta]  = useState(producto?.precio_venta ?? '')
  const [stockInicial, setStockInicial] = useState(producto?.stock_actual ?? '')
  const [stockMinimo,  setStockMinimo]  = useState(producto?.stock_minimo ?? '')
  const [unidad,       setUnidad]       = useState(producto?.unidad       || 'unidad')
  const [guardando,    setGuardando]    = useState(false)
  const [error,        setError]        = useState(null)

  async function guardar() {
    if (!nombre.trim()) return setError('El nombre es obligatorio')
    setError(null); setGuardando(true)

    if (esEdicion) {
      const { error: err } = await supabase.from('producto').update({
        nombre:       nombre.trim(),
        descripcion:  descripcion.trim() || null,
        sku:          sku.trim() || null,
        categoria:    categoria.trim() || null,
        precio_costo: parseFloat(precioCosto) || 0,
        precio_venta: parseFloat(precioVenta) || 0,
        stock_minimo: parseFloat(stockMinimo) || 0,
        unidad,
      }).eq('id', producto.id)
      setGuardando(false)
      if (err) return setError('No se pudo guardar')
    } else {
      const { data: prod, error: err } = await supabase.from('producto').insert({
        empresa_id:   empresaId,
        nombre:       nombre.trim(),
        descripcion:  descripcion.trim() || null,
        sku:          sku.trim() || null,
        categoria:    categoria.trim() || null,
        precio_costo: parseFloat(precioCosto) || 0,
        precio_venta: parseFloat(precioVenta) || 0,
        stock_minimo: parseFloat(stockMinimo) || 0,
        unidad,
        es_simulacion: esPractica,
      }).select('id').single()
      if (err) { setGuardando(false); return setError('No se pudo guardar') }

      // Stock inicial via movimiento
      const stockNum = parseFloat(stockInicial) || 0
      if (stockNum > 0) {
        await supabase.from('movimiento_stock').insert({
          empresa_id:  empresaId,
          producto_id: prod.id,
          tipo:        'entrada',
          cantidad:    stockNum,
          motivo:      'stock inicial',
          es_simulacion: esPractica,
        })
      }
      setGuardando(false)
    }
    onGuardado()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-[500px] rounded-t-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between rounded-t-[2rem]">
          <h2 className="font-extrabold text-slate-800">{esEdicion ? 'Editar producto' : 'Nuevo producto'}</h2>
          <button onClick={onCerrar} className="text-slate-400 text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100">×</button>
        </div>
        <div className="px-5 py-4 grid gap-3">

          <div className="bg-slate-50 rounded-2xl px-4 py-3">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Nombre *</p>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} autoFocus
              placeholder="Ej: Coca Cola 500ml"
              className="w-full text-lg font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">SKU / Código</p>
              <input type="text" value={sku} onChange={e => setSku(e.target.value)}
                placeholder="COC-500"
                className="w-full text-sm font-bold text-slate-700 outline-none bg-transparent placeholder:text-slate-300"
              />
            </div>
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Categoría</p>
              <input type="text" value={categoria} onChange={e => setCategoria(e.target.value)}
                placeholder="Bebidas"
                className="w-full text-sm font-bold text-slate-700 outline-none bg-transparent placeholder:text-slate-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Precio costo</p>
              <div className="flex items-center gap-1">
                <span className="text-slate-300 font-bold">$</span>
                <input type="number" inputMode="decimal" value={precioCosto} onChange={e => setPrecioCosto(e.target.value)}
                  placeholder="0"
                  className="w-full text-base font-extrabold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
            </div>
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Precio venta</p>
              <div className="flex items-center gap-1">
                <span className="text-slate-300 font-bold">$</span>
                <input type="number" inputMode="decimal" value={precioVenta} onChange={e => setPrecioVenta(e.target.value)}
                  placeholder="0"
                  className="w-full text-base font-extrabold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {!esEdicion && (
              <div className="bg-slate-50 rounded-2xl px-4 py-3">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Stock inicial</p>
                <input type="number" inputMode="decimal" value={stockInicial} onChange={e => setStockInicial(e.target.value)}
                  placeholder="0"
                  className="w-full text-base font-extrabold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
            )}
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Stock mínimo</p>
              <input type="number" inputMode="decimal" value={stockMinimo} onChange={e => setStockMinimo(e.target.value)}
                placeholder="0"
                className="w-full text-base font-extrabold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
              />
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-2">Unidad de medida</p>
            <div className="flex flex-wrap gap-2">
              {UNIDADES.map(u => (
                <button key={u} onClick={() => setUnidad(u)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                    unidad === u ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >{u}</button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="grid grid-cols-2 gap-3 pb-2">
            <button onClick={onCerrar} className="py-4 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all">
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              className="py-4 rounded-3xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : esEdicion ? 'Guardar' : 'Crear producto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal Movimiento de stock ─────────────────────────────────────
function ModalMovimiento({ producto, empresaId, esPractica, onGuardado, onCerrar }) {
  const [tipo,     setTipo]     = useState('entrada')
  const [cantidad, setCantidad] = useState('')
  const [motivo,   setMotivo]   = useState('')
  const [guardando,setGuardando]= useState(false)
  const [error,    setError]    = useState(null)

  async function guardar() {
    const num = parseFloat(cantidad)
    if (!num || num <= 0) return setError('Ingresá una cantidad válida')
    setError(null); setGuardando(true)
    const { error: err } = await supabase.from('movimiento_stock').insert({
      empresa_id:  empresaId,
      producto_id: producto.id,
      tipo,
      cantidad:    num,
      motivo:      motivo.trim() || null,
      es_simulacion: esPractica,
    })
    setGuardando(false)
    if (err) return setError('No se pudo registrar')
    onGuardado()
  }

  const esAjuste = tipo === 'ajuste'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-[500px] rounded-t-[2rem] shadow-2xl">
        <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between rounded-t-[2rem]">
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Movimiento</p>
            <h2 className="font-extrabold text-slate-800 truncate">{producto.nombre}</h2>
          </div>
          <button onClick={onCerrar} className="text-slate-400 text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100">×</button>
        </div>
        <div className="px-5 py-4 grid gap-4">

          {/* Tipo */}
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(TIPO_MOV).map(([id, cfg]) => (
              <button key={id} onClick={() => setTipo(id)}
                className={`py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 ${
                  tipo === id ? `${cfg.bg} ${cfg.color} border-2 border-current` : 'bg-slate-50 text-slate-500'
                }`}
              >
                <span className="block text-xl mb-0.5">{cfg.signo}</span>
                {cfg.label}
              </button>
            ))}
          </div>

          {/* Cantidad */}
          <div className="bg-slate-50 rounded-2xl px-4 py-3 text-center">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">
              {esAjuste ? 'Nuevo stock total' : 'Cantidad'}
            </p>
            <div className="flex items-center justify-center gap-2">
              <input type="number" inputMode="decimal" value={cantidad} onChange={e => setCantidad(e.target.value)}
                autoFocus placeholder="0"
                className="text-4xl font-extrabold text-slate-800 outline-none bg-transparent w-32 text-center placeholder:text-slate-200"
              />
              <span className="text-slate-400 text-sm font-medium">{producto.unidad}</span>
            </div>
            {!esAjuste && (
              <p className="text-xs text-slate-400 mt-1">
                Stock actual: <strong>{producto.stock_actual} {producto.unidad}</strong>
              </p>
            )}
          </div>

          {/* Motivo */}
          <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-700 placeholder:text-slate-300"
          />

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="grid grid-cols-2 gap-3 pb-2">
            <button onClick={onCerrar} className="py-4 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all">
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              className={`py-4 rounded-3xl text-white font-extrabold active:scale-95 transition-all disabled:opacity-50 ${
                tipo === 'entrada' ? 'bg-emerald-500 shadow-emerald-100' :
                tipo === 'salida'  ? 'bg-red-500 shadow-red-100' :
                                    'bg-indigo-600 shadow-indigo-100'
              } shadow-lg`}
            >
              {guardando ? 'Guardando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal Detalle Producto ────────────────────────────────────────
function ModalDetalle({ producto, empresaId, esPractica, onActualizado, onCerrar }) {
  const [movimientos, setMovimientos] = useState([])
  const [cargando,    setCargando]    = useState(true)
  const [modalMov,    setModalMov]    = useState(false)
  const [modalEdit,   setModalEdit]   = useState(false)

  useEffect(() => {
    supabase.from('movimiento_stock')
      .select('*')
      .eq('producto_id', producto.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { setMovimientos(data || []); setCargando(false) })
  }, [producto.id])

  const estado = estadoStock(producto.stock_actual, producto.stock_minimo)
  const est    = ESTADO_ESTILO[estado]
  const margen = producto.precio_costo > 0
    ? (((producto.precio_venta - producto.precio_costo) / producto.precio_venta) * 100).toFixed(0)
    : null

  function handleMovGuardado() {
    setModalMov(false)
    onActualizado()
    onCerrar()
  }

  if (modalEdit) return (
    <ModalProducto
      producto={producto}
      empresaId={empresaId}
      esPractica={esPractica}
      onGuardado={() => { setModalEdit(false); onActualizado(); onCerrar() }}
      onCerrar={() => setModalEdit(false)}
    />
  )

  if (modalMov) return (
    <ModalMovimiento
      producto={producto}
      empresaId={empresaId}
      esPractica={esPractica}
      onGuardado={handleMovGuardado}
      onCerrar={() => setModalMov(false)}
    />
  )

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-[500px] rounded-t-[2rem] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between rounded-t-[2rem]">
          <h2 className="font-extrabold text-slate-800 truncate flex-1">{producto.nombre}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setModalEdit(true)} className="text-xs text-indigo-500 font-bold px-3 py-1.5 rounded-full bg-indigo-50">
              Editar
            </button>
            <button onClick={onCerrar} className="text-slate-400 text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100">×</button>
          </div>
        </div>

        <div className="px-5 py-5 grid gap-5">

          {/* Stock protagonista */}
          <div className="text-center">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Stock actual</p>
            <p className={`font-black leading-none ${
              estado === 'sin' || estado === 'bajo' ? 'text-red-500' :
              estado === 'alerta' ? 'text-amber-500' : 'text-slate-900'
            }`} style={{ fontSize: 'clamp(3rem, 15vw, 4.5rem)' }}>
              {producto.stock_actual}
            </p>
            <p className="text-slate-400 text-sm font-medium mt-1">{producto.unidad}</p>
            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border mt-2 ${est.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${est.dot}`} />
              {est.label}
              {producto.stock_minimo > 0 && ` · mín. ${producto.stock_minimo}`}
            </span>
          </div>

          {/* Precios */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center bg-slate-50 rounded-2xl py-3">
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-1">Costo</p>
              <p className="text-sm font-extrabold text-slate-700">{formatPesos(producto.precio_costo)}</p>
            </div>
            <div className="text-center bg-slate-50 rounded-2xl py-3">
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-1">Venta</p>
              <p className="text-sm font-extrabold text-slate-800">{formatPesos(producto.precio_venta)}</p>
            </div>
            <div className="text-center bg-slate-50 rounded-2xl py-3">
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-1">Margen</p>
              <p className={`text-sm font-extrabold ${
                margen === null ? 'text-slate-300' :
                Number(margen) >= 30 ? 'text-emerald-600' :
                Number(margen) >= 15 ? 'text-amber-500' : 'text-red-500'
              }`}>
                {margen === null ? '—' : `${margen}%`}
              </p>
            </div>
          </div>

          {/* Chips info */}
          <div className="flex flex-wrap gap-2">
            {producto.sku && (
              <span className="text-xs bg-slate-100 text-slate-500 font-medium px-3 py-1 rounded-full">
                SKU: {producto.sku}
              </span>
            )}
            {producto.categoria && (
              <span className="text-xs bg-indigo-100 text-indigo-600 font-medium px-3 py-1 rounded-full">
                {producto.categoria}
              </span>
            )}
          </div>

          {/* Botones de movimiento */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { tipo: 'entrada', label: 'Entrada', bg: 'bg-emerald-500', shadow: 'shadow-emerald-100' },
              { tipo: 'salida',  label: 'Salida',  bg: 'bg-red-500',     shadow: 'shadow-red-100' },
              { tipo: 'ajuste',  label: 'Ajuste',  bg: 'bg-indigo-600',  shadow: 'shadow-indigo-100' },
            ].map(b => (
              <button key={b.tipo} onClick={() => setModalMov(true)}
                className={`py-3 rounded-2xl text-white font-bold text-sm active:scale-95 transition-all shadow-lg ${b.bg} ${b.shadow}`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Historial */}
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">Últimos movimientos</p>
            {cargando && <p className="text-slate-400 text-sm text-center py-4">Cargando…</p>}
            {!cargando && movimientos.length === 0 && (
              <p className="text-slate-400 text-sm text-center py-4">Sin movimientos registrados</p>
            )}
            <div className="grid gap-2">
              {movimientos.map(m => {
                const cfg = TIPO_MOV[m.tipo]
                return (
                  <div key={m.id} className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${cfg.bg}`}>
                    <span className={`text-lg font-extrabold w-6 text-center ${cfg.color}`}>{cfg.signo}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold ${cfg.color}`}>
                        {m.cantidad} {producto.unidad}
                        {m.motivo && <span className="font-normal ml-1 opacity-70">· {m.motivo}</span>}
                      </p>
                      <p className="text-xs text-slate-400">{formatFecha(m.created_at?.slice(0,10))}</p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/60 ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Página principal Stock ────────────────────────────────────────
export default function Stock() {
  const { empresaActivaId, empresaActiva } = useAuth()
  const esPractica = empresaActiva?.modo_simulacion ?? false

  const [tab,          setTab]          = useState('productos')
  const [productos,    setProductos]    = useState([])
  const [movimientos,  setMovimientos]  = useState([])
  const [cargando,     setCargando]     = useState(true)
  const [busqueda,     setBusqueda]     = useState('')
  const [modalNuevo,   setModalNuevo]   = useState(false)
  const [seleccionado, setSeleccionado] = useState(null)

  async function cargar() {
    if (!empresaActivaId) return
    setCargando(true)
    const [{ data: prods }, { data: movs }] = await Promise.all([
      supabase.from('producto')
        .select('*')
        .eq('empresa_id', empresaActivaId)
        .eq('activo', true)
        .eq('es_simulacion', esPractica)
        .order('nombre'),
      supabase.from('movimiento_stock')
        .select('*, producto:producto_id(nombre, unidad)')
        .eq('empresa_id', empresaActivaId)
        .eq('es_simulacion', esPractica)
        .order('created_at', { ascending: false })
        .limit(50),
    ])
    setProductos(prods || [])
    setMovimientos(movs || [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [empresaActivaId, esPractica])

  const productosFiltrados = useMemo(() => {
    if (!busqueda) return productos
    const b = busqueda.toLowerCase()
    return productos.filter(p =>
      p.nombre.toLowerCase().includes(b) ||
      (p.categoria || '').toLowerCase().includes(b) ||
      (p.sku || '').toLowerCase().includes(b)
    )
  }, [productos, busqueda])

  const alertas = useMemo(() =>
    productos.filter(p => estadoStock(p.stock_actual, p.stock_minimo) !== 'ok').length
  , [productos])

  const valorInventario = useMemo(() =>
    productos.reduce((s, p) => s + p.stock_actual * p.precio_costo, 0)
  , [productos])

  return (
    <div className="grid gap-4">

      {/* Header métricas */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-lg">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">
              Valor del inventario
            </p>
            <p className="text-3xl font-black">{formatPesos(valorInventario)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400 mb-1">{productos.length} productos</p>
            {alertas > 0 && (
              <span className="text-xs font-bold bg-red-500 text-white px-2.5 py-1 rounded-full">
                {alertas} con alerta
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1">
        {[['productos','📦 Productos'], ['movimientos','📋 Movimientos']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* ── TAB PRODUCTOS ── */}
      {tab === 'productos' && (
        <>
          <input
            type="text"
            placeholder="Buscar producto, categoría o SKU…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl bg-white shadow-sm outline-none text-slate-700 placeholder:text-slate-300"
          />

          {cargando && <p className="text-center text-slate-400 py-8 text-sm">Cargando…</p>}

          <div className="grid gap-2">
            {productosFiltrados.map(p => {
              const est = ESTADO_ESTILO[estadoStock(p.stock_actual, p.stock_minimo)]
              return (
                <button key={p.id} onClick={() => setSeleccionado(p)}
                  className="bg-white rounded-3xl p-4 shadow-sm text-left w-full active:scale-[0.98] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-bold text-slate-800 truncate">{p.nombre}</p>
                        {p.categoria && (
                          <span className="text-[0.6rem] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full shrink-0">
                            {p.categoria}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        Venta: {formatPesos(p.precio_venta)}
                        {p.precio_costo > 0 && ` · Costo: ${formatPesos(p.precio_costo)}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-2xl font-black leading-none ${
                        estadoStock(p.stock_actual, p.stock_minimo) === 'ok' ? 'text-slate-800' : 'text-red-500'
                      }`}>
                        {p.stock_actual}
                      </p>
                      <p className="text-xs text-slate-400">{p.unidad}</p>
                      <div className={`w-2 h-2 rounded-full mt-1 ml-auto ${est.dot}`} />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {!cargando && productosFiltrados.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-4xl mb-3">📦</p>
              <p className="font-medium">
                {busqueda ? 'No encontramos ese producto' : 'Todavía no cargaste productos'}
              </p>
            </div>
          )}

          {/* Botón nuevo producto */}
          <button onClick={() => setModalNuevo(true)}
            className="w-full py-5 rounded-full bg-slate-900 text-white font-extrabold text-base active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            + Nuevo producto
          </button>
        </>
      )}

      {/* ── TAB MOVIMIENTOS ── */}
      {tab === 'movimientos' && (
        <>
          {cargando && <p className="text-center text-slate-400 py-8 text-sm">Cargando…</p>}
          {!cargando && movimientos.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium">Sin movimientos registrados</p>
            </div>
          )}
          <div className="grid gap-2">
            {movimientos.map(m => {
              const cfg = TIPO_MOV[m.tipo]
              return (
                <div key={m.id} className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-lg ${cfg.bg} ${cfg.color} shrink-0`}>
                    {cfg.signo}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {m.producto?.nombre}
                    </p>
                    <p className="text-xs text-slate-400">
                      {m.cantidad} {m.producto?.unidad}
                      {m.motivo && ` · ${m.motivo}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    <p className="text-xs text-slate-400 mt-1">{formatFecha(m.created_at?.slice(0,10))}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Modales */}
      {modalNuevo && (
        <ModalProducto
          empresaId={empresaActivaId}
          esPractica={esPractica}
          onGuardado={() => { setModalNuevo(false); cargar() }}
          onCerrar={() => setModalNuevo(false)}
        />
      )}

      {seleccionado && (
        <ModalDetalle
          producto={seleccionado}
          empresaId={empresaActivaId}
          esPractica={esPractica}
          onActualizado={cargar}
          onCerrar={() => setSeleccionado(null)}
        />
      )}

    </div>
  )
}
