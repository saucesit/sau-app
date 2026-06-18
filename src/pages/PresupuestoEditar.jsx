import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function formatMonto(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
}

const inputCls = 'w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors text-sm'

export default function PresupuestoEditar() {
  const { id } = useParams()
  const { tienePermiso } = useAuth()
  const navigate = useNavigate()
  const puedeAprobar = tienePermiso('empresa.admin')

  const [pres,      setPres]      = useState(null)
  const [precio,    setPrecio]    = useState('')
  const [condiciones, setCondiciones] = useState('')
  const [notas,     setNotas]     = useState('')
  const [items,     setItems]     = useState([])
  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    if (!puedeAprobar) { navigate(`/presupuestos/${id}`, { replace: true }); return }
    cargar()
  }, [id])

  async function cargar() {
    setCargando(true)
    const [{ data: p }, { data: its }] = await Promise.all([
      supabase.from('presupuesto').select('*').eq('id', id).single(),
      supabase.from('presupuesto_item').select('*').eq('presupuesto_id', id).order('orden'),
    ])
    if (!p) { navigate('/presupuestos', { replace: true }); return }
    setPres(p)
    setPrecio(p.precio_base ?? p.total ?? 0)
    setCondiciones(p.condiciones || '')
    setNotas(p.notas || '')
    setItems((its || []).map(it => ({ ...it, _key: it.id })))
    setCargando(false)
  }

  // Items
  function agregarItem() {
    setItems(prev => [...prev, { _key: Date.now(), descripcion: '', cantidad: 1, unidad: 'global', precio_unitario: '' }])
  }
  function actualizarItem(key, campo, val) {
    setItems(prev => prev.map(it => it._key === key ? { ...it, [campo]: val } : it))
  }
  function quitarItem(key) {
    setItems(prev => prev.filter(it => it._key !== key))
  }

  const totalExtras = items.reduce((a, it) => a + (parseFloat(it.precio_unitario) || 0) * (parseFloat(it.cantidad) || 1), 0)
  const total = (parseFloat(precio) || 0) + totalExtras

  async function guardar() {
    setError(null)
    setGuardando(true)

    // Actualizar presupuesto
    const { error: presErr } = await supabase
      .from('presupuesto')
      .update({
        precio_base:  parseFloat(precio) || 0,
        condiciones:  condiciones.trim(),
        notas:        notas.trim() || null,
        total,
        tiene_cambios: true,
      })
      .eq('id', id)

    if (presErr) { setError(presErr.message); setGuardando(false); return }

    // Reemplazar items: borrar los viejos e insertar los nuevos
    await supabase.from('presupuesto_item').delete().eq('presupuesto_id', id)

    const lineasNuevas = items
      .filter(it => it.descripcion.trim() && parseFloat(it.precio_unitario) > 0)
      .map((it, idx) => ({
        presupuesto_id:  id,
        descripcion:     it.descripcion.trim(),
        unidad:          it.unidad || 'global',
        cantidad:        parseFloat(it.cantidad) || 1,
        precio_unitario: parseFloat(it.precio_unitario) || 0,
        orden:           idx,
      }))

    if (lineasNuevas.length) {
      await supabase.from('presupuesto_item').insert(lineasNuevas)
    }

    setGuardando(false)
    navigate(`/presupuestos/${id}`, { replace: true })
  }

  if (cargando) return (
    <div className="flex justify-center py-20">
      <div className="w-7 h-7 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="grid gap-4 pb-8 pt-1">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/presupuestos/${id}`)}
          className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 active:scale-95 transition-all shrink-0">
          ‹
        </button>
        <div>
          <h1 className="text-white font-extrabold text-xl leading-tight">Editar presupuesto</h1>
          <p className="text-zinc-500 text-xs">#{pres?.numero} · {pres?.cliente_nombre}</p>
        </div>
      </div>

      {/* Precio base */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
        <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Precio base del kit</p>
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 font-bold text-lg">$</span>
          <input type="number" value={precio} onChange={e => setPrecio(e.target.value)}
            className={`${inputCls} text-xl font-extrabold`} placeholder="0" />
        </div>
      </div>

      {/* Extras / Items */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
        <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Adicionales</p>

        {items.map(it => (
          <div key={it._key} className="grid gap-2 pb-3 border-b border-zinc-800 last:border-0 last:pb-0">
            <div className="flex gap-2 items-center">
              <input type="text" placeholder="Descripción" value={it.descripcion}
                onChange={e => actualizarItem(it._key, 'descripcion', e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white text-sm focus:border-emerald-500 transition-colors" />
              <button onClick={() => quitarItem(it._key)}
                className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center shrink-0 active:scale-95">
                ✕
              </button>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-zinc-500 text-sm shrink-0">Cant.</span>
                <input type="number" value={it.cantidad}
                  onChange={e => actualizarItem(it._key, 'cantidad', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white text-sm focus:border-emerald-500 transition-colors" />
              </div>
              <div className="flex items-center gap-1 flex-1">
                <span className="text-zinc-500 text-sm shrink-0">$</span>
                <input type="number" placeholder="Precio" value={it.precio_unitario}
                  onChange={e => actualizarItem(it._key, 'precio_unitario', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white text-sm font-bold focus:border-emerald-500 transition-colors" />
              </div>
            </div>
          </div>
        ))}

        <button onClick={agregarItem}
          className="w-full py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-500 font-bold text-sm active:scale-95 transition-all hover:border-emerald-500/40 hover:text-emerald-400">
          + Agregar adicional
        </button>
      </div>

      {/* Total */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-1.5">
        <div className="flex justify-between text-zinc-400 text-sm">
          <span>Kit</span><span>{formatMonto(parseFloat(precio) || 0)}</span>
        </div>
        {totalExtras > 0 && (
          <div className="flex justify-between text-zinc-400 text-sm">
            <span>Adicionales</span><span>{formatMonto(totalExtras)}</span>
          </div>
        )}
        <div className="flex justify-between items-center border-t border-zinc-800 pt-2 mt-1">
          <span className="text-white font-extrabold text-lg">TOTAL</span>
          <span className="text-emerald-400 font-extrabold text-2xl">{formatMonto(total)}</span>
        </div>
      </div>

      {/* Condiciones */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
        <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Condiciones de venta</p>
        <textarea rows={4} value={condiciones} onChange={e => setCondiciones(e.target.value)}
          placeholder="Forma de pago, plazo de entrega, garantía..."
          className={`${inputCls} resize-none leading-relaxed`} />
      </div>

      {/* Notas internas */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
        <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Nota interna</p>
        <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)}
          placeholder="Solo visible en la app, no sale en el PDF ni WA"
          className={`${inputCls} resize-none`} />
      </div>

      {error && <p className="text-red-400 text-sm font-semibold text-center">{error}</p>}

      <button onClick={guardar} disabled={guardando}
        className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95 transition-all">
        {guardando ? 'Guardando...' : '✓ Guardar cambios'}
      </button>

      <p className="text-zinc-600 text-xs text-center -mt-2">
        Gonzalo verá una alerta de que el presupuesto fue modificado
      </p>

    </div>
  )
}
