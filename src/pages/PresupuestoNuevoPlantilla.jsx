import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function formatMonto(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
}

// Extras sugeridos típicos de Fede
const EXTRAS_SUGERIDOS = [
  { label: 'Control adicional', monto: 25000 },
  { label: 'Trabajo de herrería' },
  { label: 'Instalación eléctrica' },
  { label: 'Cable subterráneo (x metro)', monto: 3500 },
]

export default function PresupuestoNuevoPlantilla() {
  const { empresaActivaId, user, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pedidoId = searchParams.get('pedido')
  const puedeAprobar = tienePermiso('empresa.admin')

  const [plantillas, setPlantillas] = useState([])
  const [cargando,   setCargando]   = useState(true)
  const [cliente,    setCliente]    = useState({ nombre: '', tel: '' })
  const [elegida,    setElegida]    = useState(null)   // plantilla seleccionada
  const [precio,     setPrecio]     = useState(0)
  const [extras,     setExtras]     = useState([])      // { _key, label, monto }
  const [guardando,  setGuardando]  = useState(false)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('plantilla_presupuesto')
        .select('*')
        .eq('empresa_id', empresaActivaId)
        .eq('activo', true)
        .order('orden')
      setPlantillas(data || [])
      setCargando(false)
    })()
  }, [empresaActivaId])

  // Prefill cliente desde un pedido
  useEffect(() => {
    if (!pedidoId) return
    ;(async () => {
      const { data } = await supabase.from('pedido').select('nombre_cliente, telefono').eq('id', pedidoId).single()
      if (data) setCliente({ nombre: data.nombre_cliente || '', tel: data.telefono || '' })
    })()
  }, [pedidoId])

  function elegir(p) {
    setElegida(p)
    setPrecio(Number(p.precio) || 0)
  }

  function agregarExtra(sug) {
    setExtras(prev => [...prev, { _key: Date.now(), label: sug?.label || '', monto: sug?.monto || '' }])
  }
  function actualizarExtra(key, campo, val) {
    setExtras(prev => prev.map(e => e._key === key ? { ...e, [campo]: val } : e))
  }
  function quitarExtra(key) {
    setExtras(prev => prev.filter(e => e._key !== key))
  }

  const totalExtras = extras.reduce((a, e) => a + (parseFloat(e.monto) || 0), 0)
  const total = (parseFloat(precio) || 0) + totalExtras

  async function guardar() {
    if (!cliente.nombre.trim()) return setError('Ingresá el nombre del cliente')
    if (!elegida)               return setError('Elegí una plantilla')
    setError(null); setGuardando(true)

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
        titulo:         elegida.titulo,
        descripcion:    elegida.descripcion,
        incluye:        elegida.incluye,
        condiciones:    elegida.condiciones,
        precio_base:    parseFloat(precio) || 0,
        total,
        creado_por:     user?.id || null,
        aprobado:       puedeAprobar,
      })
      .select('id')
      .single()

    if (presErr) { setError(presErr.message); setGuardando(false); return }

    // Extras como líneas
    const lineas = extras
      .filter(e => e.label.trim() && parseFloat(e.monto) > 0)
      .map((e, idx) => ({
        presupuesto_id:  pres.id,
        descripcion:     e.label.trim(),
        unidad:          'global',
        cantidad:        1,
        precio_unitario: parseFloat(e.monto),
        orden:           idx,
      }))
    if (lineas.length) await supabase.from('presupuesto_item').insert(lineas)

    if (pedidoId) {
      await supabase.from('pedido').update({ estado: 'presupuestado', presupuesto_id: pres.id }).eq('id', pedidoId)
    }

    setGuardando(false)
    navigate(`/presupuestos/${pres.id}`, { replace: true })
  }

  if (cargando) return (
    <div className="flex justify-center py-16"><div className="w-7 h-7 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" /></div>
  )

  if (plantillas.length === 0) return (
    <div className="text-center py-16 text-zinc-500 grid gap-2">
      <p className="text-5xl">📋</p>
      <p className="text-zinc-300 font-bold">No hay plantillas cargadas</p>
      <p className="text-sm">Pedile a SAU que cargue tus modelos de presupuesto.</p>
    </div>
  )

  const inputCls = 'w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors'

  return (
    <div className="grid gap-4 pb-8 pt-1">

      {/* 1. Elegir plantilla */}
      <section className="grid gap-2">
        <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest px-1">1 · Elegí el tipo de trabajo</p>
        <div className="grid gap-2">
          {plantillas.map(p => {
            const on = elegida?.id === p.id
            return (
              <button key={p.id} onClick={() => elegir(p)}
                className={`text-left rounded-2xl px-4 py-3 border transition-all active:scale-[0.99] ${
                  on ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-zinc-900 border-zinc-800'
                }`}>
                <div className="flex items-center justify-between gap-2">
                  <p className={`font-bold ${on ? 'text-emerald-400' : 'text-white'}`}>{p.nombre}</p>
                  <p className="text-zinc-300 font-extrabold text-sm">{formatMonto(p.precio)}</p>
                </div>
                <p className="text-zinc-500 text-xs mt-0.5 truncate">{p.titulo}</p>
              </button>
            )
          })}
        </div>
      </section>

      {elegida && (
        <>
          {/* 2. Cliente */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">2 · Cliente</p>
            <input type="text" placeholder="Nombre del cliente *" value={cliente.nombre}
              onChange={e => setCliente(c => ({ ...c, nombre: e.target.value }))} className={`${inputCls} font-semibold`} />
            <input type="tel" placeholder="WhatsApp (opcional)" value={cliente.tel}
              onChange={e => setCliente(c => ({ ...c, tel: e.target.value }))} className={inputCls} />
          </section>

          {/* 3. Precio base (editable) */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">3 · Precio del kit</p>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 font-bold text-lg">$</span>
              <input type="number" value={precio} onChange={e => setPrecio(e.target.value)}
                className={`${inputCls} text-xl font-extrabold`} />
            </div>
            <p className="text-zinc-600 text-xs">Viene del modelo. Cambialo si este trabajo tiene otro precio.</p>
          </section>

          {/* 4. Extras */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">4 · Extras (opcional)</p>
            <div className="flex flex-wrap gap-2">
              {EXTRAS_SUGERIDOS.map(s => (
                <button key={s.label} onClick={() => agregarExtra(s)}
                  className="text-xs font-bold bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-full active:scale-95">
                  + {s.label}
                </button>
              ))}
            </div>
            {extras.map(e => (
              <div key={e._key} className="flex gap-2 items-center">
                <input type="text" placeholder="Descripción" value={e.label}
                  onChange={ev => actualizarExtra(e._key, 'label', ev.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 outline-none text-white text-sm" />
                <div className="flex items-center gap-1 w-28 shrink-0">
                  <span className="text-zinc-500 text-sm">$</span>
                  <input type="number" placeholder="0" value={e.monto}
                    onChange={ev => actualizarExtra(e._key, 'monto', ev.target.value)}
                    className="w-full px-2 py-2 rounded-lg bg-zinc-800 border border-zinc-700 outline-none text-white text-sm font-bold" />
                </div>
                <button onClick={() => quitarExtra(e._key)} className="text-orange-400 text-lg shrink-0">✕</button>
              </div>
            ))}
          </section>

          {/* Total */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-1.5">
            <div className="flex justify-between text-zinc-400 text-sm"><span>Kit</span><span>{formatMonto(parseFloat(precio) || 0)}</span></div>
            {totalExtras > 0 && <div className="flex justify-between text-zinc-400 text-sm"><span>Extras</span><span>{formatMonto(totalExtras)}</span></div>}
            <div className="flex justify-between items-center border-t border-zinc-800 pt-2 mt-1">
              <span className="text-white font-extrabold text-lg">TOTAL</span>
              <span className="text-emerald-400 font-extrabold text-2xl">{formatMonto(total)}</span>
            </div>
          </section>

          {error && <p className="text-orange-400 text-sm font-semibold text-center">{error}</p>}

          <button onClick={guardar} disabled={guardando}
            className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95 transition-all">
            {guardando ? 'Guardando...' : puedeAprobar ? '✓ Guardar presupuesto' : '📤 Enviar a aprobación'}
          </button>
          {!puedeAprobar && <p className="text-zinc-500 text-xs text-center -mt-2">El dueño lo revisa antes de enviarlo al cliente</p>}
        </>
      )}
    </div>
  )
}
