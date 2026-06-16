import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const UNIDADES = ['unidad', 'm²', 'm³', 'm lineal', 'kg', 'hora', 'día', 'bolsa', 'rollo', 'global']

function formatMonto(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
}

// ── Sheet para agregar un ítem ────────────────────────────────────
function ItemSheet({ catalogo, onAgregar, onCerrar }) {
  const [modo,      setModo]      = useState('catalogo') // 'catalogo' | 'manual'
  const [busqueda,  setBusqueda]  = useState('')
  const [item,      setItem]      = useState({ descripcion: '', unidad: 'unidad', cantidad: 1, precio_unitario: '' })

  const filtrados = catalogo.filter(c =>
    c.nombre.toLowerCase().includes(busqueda.toLowerCase())
  )

  function agregarDeCatalogo(c) {
    onAgregar({ descripcion: c.nombre, unidad: c.unidad, cantidad: 1, precio_unitario: c.precio })
  }

  function agregarManual() {
    if (!item.descripcion.trim() || !item.precio_unitario) return
    onAgregar({ ...item, precio_unitario: parseFloat(item.precio_unitario), cantidad: parseFloat(item.cantidad) || 1 })
  }

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors'

  return (
    <div className="fixed inset-0 bg-black/70 z-[70] flex items-end" onClick={onCerrar}>
      <div
        className="w-full max-w-[500px] mx-auto bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-5 grid gap-4 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="pt-1 flex justify-center"><div className="w-10 h-1.5 bg-zinc-700 rounded-full" /></div>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-extrabold text-lg">Agregar ítem</h3>
          <button onClick={onCerrar} className="text-zinc-500 text-2xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex bg-zinc-800 rounded-xl p-1 gap-1">
          <button onClick={() => setModo('catalogo')}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${modo === 'catalogo' ? 'bg-zinc-700 text-emerald-400' : 'text-zinc-500'}`}>
            Del catálogo
          </button>
          <button onClick={() => setModo('manual')}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${modo === 'manual' ? 'bg-zinc-700 text-emerald-400' : 'text-zinc-500'}`}>
            Manual
          </button>
        </div>

        {modo === 'catalogo' ? (
          <div className="grid gap-3">
            <input type="text" placeholder="Buscar ítem..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              className={inputCls} autoFocus />
            {filtrados.length === 0 ? (
              <div className="text-center py-6 text-zinc-500 text-sm">
                {catalogo.length === 0 ? 'Tu catálogo está vacío — usá "Manual"' : 'Sin resultados'}
              </div>
            ) : (
              <div className="grid gap-2">
                {filtrados.map(c => (
                  <button key={c.id} onClick={() => agregarDeCatalogo(c)}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 active:scale-[0.99] transition-all text-left">
                    <div>
                      <p className="text-white font-semibold text-sm">{c.nombre}</p>
                      <p className="text-zinc-500 text-xs">{c.unidad}</p>
                    </div>
                    <p className="text-emerald-400 font-extrabold text-sm">{formatMonto(c.precio)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            <input type="text" placeholder="Descripción *" value={item.descripcion}
              onChange={e => setItem(i => ({ ...i, descripcion: e.target.value }))} className={inputCls} autoFocus />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-500 font-semibold mb-1 block">Cantidad</label>
                <input type="number" min="0.01" step="0.01" value={item.cantidad}
                  onChange={e => setItem(i => ({ ...i, cantidad: e.target.value }))}
                  className={`${inputCls} text-center font-bold`} />
              </div>
              <div>
                <label className="text-xs text-zinc-500 font-semibold mb-1 block">Unidad</label>
                <select value={item.unidad} onChange={e => setItem(i => ({ ...i, unidad: e.target.value }))}
                  className="w-full px-3 py-3 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white text-sm">
                  {UNIDADES.map(u => <option key={u} className="bg-zinc-800">{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 font-semibold mb-1 block">Precio unitario *</label>
              <input type="number" min="0" placeholder="0" value={item.precio_unitario}
                onChange={e => setItem(i => ({ ...i, precio_unitario: e.target.value }))}
                className={`${inputCls} text-xl font-extrabold`} />
            </div>

            {item.precio_unitario > 0 && (
              <div className="bg-emerald-500/10 rounded-xl px-4 py-2 flex justify-between">
                <span className="text-emerald-400 text-sm font-semibold">Subtotal</span>
                <span className="text-emerald-400 font-extrabold">
                  {formatMonto((parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0))}
                </span>
              </div>
            )}

            <button onClick={agregarManual} disabled={!item.descripcion.trim() || !item.precio_unitario}
              className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-extrabold disabled:opacity-40 active:scale-95 transition-all">
              ＋ Agregar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────────
export default function PresupuestoNuevo() {
  const { empresaActivaId, user, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pedidoId = searchParams.get('pedido')
  const puedeAprobar = tienePermiso('empresa.admin')

  const [cliente,   setCliente]   = useState({ nombre: '', tel: '' })
  const [descripcion, setDescripcion] = useState('')
  const [items,     setItems]     = useState([])
  const [descuento, setDescuento] = useState(0)
  const [notas,     setNotas]     = useState('')
  const [catalogo,  setCatalogo]  = useState([])
  const [showSheet, setShowSheet] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  useEffect(() => { cargarCatalogo() }, [empresaActivaId])

  // Si viene de un pedido, pre-rellenar los datos del cliente
  useEffect(() => {
    if (!pedidoId) return
    ;(async () => {
      const { data } = await supabase
        .from('pedido')
        .select('nombre_cliente, telefono, descripcion')
        .eq('id', pedidoId)
        .single()
      if (data) {
        setCliente({ nombre: data.nombre_cliente || '', tel: data.telefono || '' })
        setDescripcion(data.descripcion || '')
      }
    })()
  }, [pedidoId])

  async function cargarCatalogo() {
    if (!empresaActivaId) return
    const { data } = await supabase
      .from('catalogo_item')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .eq('activo', true)
      .order('nombre')
    setCatalogo(data || [])
  }

  function agregarItem(nuevoItem) {
    setItems(prev => [...prev, { ...nuevoItem, _key: Date.now() }])
    setShowSheet(false)
  }
  function removerItem(key) {
    setItems(prev => prev.filter(i => i._key !== key))
  }
  function actualizarCantidad(key, val) {
    setItems(prev => prev.map(i => i._key === key ? { ...i, cantidad: parseFloat(val) || 0 } : i))
  }

  const subtotal  = items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0)
  const montoDesc = subtotal * (descuento / 100)
  const total     = subtotal - montoDesc

  async function guardar() {
    if (!cliente.nombre.trim()) return setError('Ingresá el nombre del cliente')
    if (items.length === 0)     return setError('Agregá al menos un ítem')
    setError(null)
    setGuardando(true)

    const { count } = await supabase
      .from('presupuesto')
      .select('*', { count: 'exact', head: true })
      .eq('empresa_id', empresaActivaId)
    const numero = (count || 0) + 1

    const { data: pres, error: presErr } = await supabase
      .from('presupuesto')
      .insert({
        empresa_id:     empresaActivaId,
        numero,
        cliente_nombre: cliente.nombre.trim(),
        cliente_tel:    cliente.tel.trim() || null,
        descripcion:    descripcion.trim() || null,
        descuento,
        total,
        notas:          notas.trim() || null,
        creado_por:     user?.id || null,
        // El dueño/admin aprueba al crear; el empleado deja en revisión
        aprobado:       puedeAprobar,
      })
      .select('id')
      .single()

    if (presErr) { setError(presErr.message); setGuardando(false); return }

    const lineas = items.map((it, idx) => ({
      presupuesto_id:  pres.id,
      descripcion:     it.descripcion,
      unidad:          it.unidad,
      cantidad:        it.cantidad,
      precio_unitario: it.precio_unitario,
      orden:           idx,
    }))
    await supabase.from('presupuesto_item').insert(lineas)

    if (pedidoId) {
      await supabase.from('pedido')
        .update({ estado: 'presupuestado', presupuesto_id: pres.id })
        .eq('id', pedidoId)
    }

    setGuardando(false)
    navigate(`/presupuestos/${pres.id}`, { replace: true })
  }

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors'

  return (
    <div className="grid gap-4 pb-8 pt-1">

      {/* ── Cliente ──────────────────────────────────────────── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
        <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">📋 Cliente</p>
        <input type="text" placeholder="Nombre del cliente *" value={cliente.nombre}
          onChange={e => setCliente(c => ({ ...c, nombre: e.target.value }))}
          className={`${inputCls} font-semibold`} />
        <input type="tel" placeholder="WhatsApp (opcional)" value={cliente.tel}
          onChange={e => setCliente(c => ({ ...c, tel: e.target.value }))}
          className={inputCls} />
        <textarea placeholder="Descripción del trabajo (opcional)" value={descripcion}
          onChange={e => setDescripcion(e.target.value)} rows={2}
          className={`${inputCls} resize-none text-sm`} />
      </section>

      {/* ── Ítems ────────────────────────────────────────────── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
        <div className="flex items-center justify-between">
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">🧱 Ítems</p>
          <button onClick={() => setShowSheet(true)}
            className="text-emerald-400 text-sm font-extrabold bg-emerald-500/10 px-3 py-1.5 rounded-xl active:scale-95 transition-all">
            ＋ Agregar
          </button>
        </div>

        {items.length === 0 ? (
          <button onClick={() => setShowSheet(true)}
            className="border-2 border-dashed border-zinc-700 rounded-xl py-8 text-zinc-500 text-sm font-semibold text-center active:border-emerald-500 transition-colors">
            Tocá para agregar materiales, mano de obra...
          </button>
        ) : (
          <div className="grid gap-2">
            {items.map(it => (
              <div key={it._key} className="flex items-center gap-3 py-2 border-b border-zinc-800 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{it.descripcion}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <input type="number" value={it.cantidad} min="0.01" step="0.01"
                      onChange={e => actualizarCantidad(it._key, e.target.value)}
                      className="w-14 text-center bg-zinc-800 rounded-lg px-1 py-0.5 text-xs font-bold text-zinc-200 outline-none" />
                    <span className="text-zinc-500 text-xs">{it.unidad}</span>
                    <span className="text-zinc-500 text-xs">× {formatMonto(it.precio_unitario)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-white font-extrabold text-sm">{formatMonto(it.cantidad * it.precio_unitario)}</p>
                  <button onClick={() => removerItem(it._key)} className="text-orange-400 text-xs mt-0.5">✕ quitar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Totales ──────────────────────────────────────────── */}
      {items.length > 0 && (
        <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">💰 Total</p>

          <div className="flex justify-between items-center">
            <span className="text-zinc-400 text-sm">Subtotal</span>
            <span className="text-zinc-200 font-semibold">{formatMonto(subtotal)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-zinc-400 text-sm">Descuento %</span>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={100} value={descuento}
                onChange={e => setDescuento(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                className="w-16 text-center bg-zinc-800 rounded-xl px-2 py-1.5 text-sm font-bold text-zinc-200 outline-none" />
              <span className="text-zinc-500 text-sm">%</span>
            </div>
          </div>

          {descuento > 0 && (
            <div className="flex justify-between items-center text-orange-400">
              <span className="text-sm">- Descuento</span>
              <span className="font-semibold">- {formatMonto(montoDesc)}</span>
            </div>
          )}

          <div className="flex justify-between items-center border-t border-zinc-800 pt-3">
            <span className="text-white font-extrabold text-lg">TOTAL</span>
            <span className="text-emerald-400 font-extrabold text-2xl">{formatMonto(total)}</span>
          </div>
        </section>
      )}

      {/* ── Notas ────────────────────────────────────────────── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
        <textarea placeholder="📝 Notas adicionales (opcional)" value={notas}
          onChange={e => setNotas(e.target.value)} rows={2}
          className="w-full bg-transparent text-zinc-200 placeholder:text-zinc-600 text-sm outline-none resize-none" />
      </section>

      {error && <p className="text-orange-400 text-sm font-semibold text-center">{error}</p>}

      <button onClick={guardar} disabled={guardando}
        className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95 transition-all">
        {guardando ? 'Guardando...' : puedeAprobar ? '✓ Guardar presupuesto' : '📤 Enviar a aprobación'}
      </button>
      {!puedeAprobar && (
        <p className="text-zinc-500 text-xs text-center -mt-2">El dueño lo revisa antes de enviarlo al cliente</p>
      )}

      {showSheet && (
        <ItemSheet catalogo={catalogo} onAgregar={agregarItem} onCerrar={() => setShowSheet(false)} />
      )}
    </div>
  )
}
