import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function PedidoPublico() {
  const { empresaId } = useParams()
  const [empresa,   setEmpresa]   = useState(null)
  const [cargando,  setCargando]  = useState(true)
  const [nombre,    setNombre]    = useState('')
  const [telefono,  setTelefono]  = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [estado,    setEstado]    = useState('idle') // idle | enviando | enviado
  const [error,     setError]     = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('empresa')
        .select('nombre_fantasia')
        .eq('id', empresaId)
        .single()
      setEmpresa(data || null)
      setCargando(false)
    })()
  }, [empresaId])

  async function enviar() {
    if (!nombre.trim())      return setError('Decinos tu nombre')
    if (!descripcion.trim()) return setError('Contanos qué necesitás')
    setError(null)
    setEstado('enviando')

    const { error: err } = await supabase.from('pedido').insert({
      empresa_id:     empresaId,
      nombre_cliente: nombre.trim(),
      telefono:       telefono.trim() || null,
      descripcion:    descripcion.trim(),
    })

    if (err) {
      setError('Algo salió mal. Intentá de nuevo.')
      setEstado('idle')
      return
    }
    setEstado('enviado')
  }

  // ── Cargando ──────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  // ── Empresa no encontrada ─────────────────────────────────────
  if (!empresa) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center gap-3">
        <p className="text-5xl">🔍</p>
        <p className="text-white font-bold text-lg">Link no válido</p>
        <p className="text-zinc-500 text-sm">Pedile el link correcto a quien te lo compartió.</p>
      </div>
    )
  }

  // ── Éxito ─────────────────────────────────────────────────────
  if (estado === 'enviado') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center gap-5">
        <div className="text-7xl animate-bounce">✅</div>
        <h2 className="text-white font-black text-3xl leading-tight">¡Pedido enviado!</h2>
        <p className="text-zinc-400 text-base leading-relaxed max-w-sm">
          {empresa.nombre_fantasia} recibió tu solicitud y te va a pasar el presupuesto a la brevedad.
        </p>
        <button
          onClick={() => { setNombre(''); setTelefono(''); setDescripcion(''); setEstado('idle') }}
          className="text-zinc-600 text-sm underline underline-offset-4 mt-2">
          Enviar otro pedido
        </button>
      </div>
    )
  }

  // ── Formulario ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-6 py-10 max-w-lg mx-auto w-full">

        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-2">Pedí tu presupuesto</p>
          <h1 className="text-white font-black leading-tight" style={{ fontSize: 'clamp(1.8rem, 7vw, 2.4rem)' }}>
            {empresa.nombre_fantasia}
          </h1>
          <p className="text-zinc-500 text-sm mt-2">Completá y te lo armamos sin vueltas.</p>
        </div>

        {/* Campos */}
        <div className="grid gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
            <p className="text-[0.65rem] text-zinc-500 font-bold uppercase tracking-widest mb-1">Tu nombre *</p>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder="Juan Pérez"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-700 placeholder:font-normal" />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
            <p className="text-[0.65rem] text-zinc-500 font-bold uppercase tracking-widest mb-1">WhatsApp / Teléfono</p>
            <input type="tel" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)}
              placeholder="11 1234-5678"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-700 placeholder:font-normal" />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
            <p className="text-[0.65rem] text-zinc-500 font-bold uppercase tracking-widest mb-1">¿Qué necesitás? *</p>
            <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)}
              rows={4}
              placeholder="Contanos el trabajo, los materiales, medidas... lo que tengas."
              className="w-full text-base text-zinc-200 outline-none bg-transparent placeholder:text-zinc-700 resize-none" />
          </div>
        </div>

        {error && <p className="text-red-400 text-sm text-center font-semibold mt-3">{error}</p>}

        <button onClick={enviar} disabled={estado === 'enviando'}
          className="w-full mt-5 py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-xl shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50">
          {estado === 'enviando' ? 'Enviando…' : 'Enviar pedido →'}
        </button>

        <p className="text-zinc-700 text-xs text-center mt-4">Hecho con SAU</p>
      </div>
    </div>
  )
}
