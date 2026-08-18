import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ReservaPublica() {
  const { empresaId } = useParams()
  const [empresa,    setEmpresa]    = useState(null)
  const [cargando,   setCargando]   = useState(true)
  const [estado,     setEstado]     = useState('idle') // idle | enviando | enviado
  const [error,      setError]      = useState(null)

  const [nombre,     setNombre]     = useState('')
  const [telefono,   setTelefono]   = useState('')
  const [fecha,      setFecha]      = useState('')
  const [hora,       setHora]       = useState('')
  const [pasajeros,  setPasajeros]  = useState('1')
  const [origen,     setOrigen]     = useState('')
  const [destino,    setDestino]    = useState('')
  const [notas,      setNotas]      = useState('')

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
    if (!nombre.trim())   return setError('Necesitamos tu nombre')
    if (!telefono.trim()) return setError('Necesitamos tu WhatsApp para confirmar')
    if (!fecha)           return setError('Elegí la fecha del viaje')
    if (!destino.trim())  return setError('Indicá a dónde vas')
    setError(null)
    setEstado('enviando')

    const { error: err } = await supabase.from('reserva').insert({
      empresa_id:         empresaId,
      pasajero_nombre:    nombre.trim(),
      pasajero_tel:       telefono.trim(),
      fecha,
      hora:               hora || null,
      pasajeros_cantidad: parseInt(pasajeros) || 1,
      origen:             origen.trim() || null,
      destino:            destino.trim(),
      notas:              notas.trim() || null,
    })

    if (err) {
      setError('Algo salió mal. Intentá de nuevo.')
      setEstado('idle')
      return
    }
    setEstado('enviado')
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!empresa) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center gap-3">
        <p className="text-white font-bold text-lg">Link no válido</p>
        <p className="text-zinc-500 text-sm">Pedile el link correcto a quien te lo compartió.</p>
      </div>
    )
  }

  if (estado === 'enviado') {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center gap-5">
        <div className="w-20 h-20 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-white font-black text-3xl leading-tight">¡Reserva enviada!</h2>
        <p className="text-zinc-400 text-base leading-relaxed max-w-sm">
          {empresa.nombre_fantasia} recibió tu solicitud. Te van a confirmar el viaje por WhatsApp a la brevedad.
        </p>
        <button
          onClick={() => {
            setNombre(''); setTelefono(''); setFecha(''); setHora('')
            setPasajeros('1'); setOrigen(''); setDestino(''); setNotas('')
            setEstado('idle')
          }}
          className="text-zinc-600 text-sm underline underline-offset-4 mt-2">
          Hacer otra reserva
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-5 py-10 max-w-lg mx-auto w-full">

        <div className="text-center mb-8">
          <p className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-2">Reservá tu viaje</p>
          <h1 className="text-white font-black leading-tight" style={{ fontSize: 'clamp(1.8rem, 7vw, 2.4rem)' }}>
            {empresa.nombre_fantasia}
          </h1>
          <p className="text-zinc-500 text-sm mt-2">Completá los datos y te confirmamos enseguida.</p>
        </div>

        <div className="grid gap-3">

          <Campo label="Tu nombre *">
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder="Juan Pérez"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-700 placeholder:font-normal" />
          </Campo>

          <Campo label="WhatsApp *">
            <input type="tel" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)}
              placeholder="387 123-4567"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-700 placeholder:font-normal" />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Fecha del viaje *">
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                className="w-full text-base font-bold text-white outline-none bg-transparent [color-scheme:dark]" />
            </Campo>
            <Campo label="Hora (opcional)">
              <input type="time" value={hora} onChange={e => setHora(e.target.value)}
                className="w-full text-base font-bold text-white outline-none bg-transparent [color-scheme:dark]" />
            </Campo>
          </div>

          <Campo label="Cantidad de pasajeros *">
            <input type="number" inputMode="numeric" min="1" max="99" value={pasajeros}
              onChange={e => setPasajeros(e.target.value)}
              className="w-full text-base font-bold text-white outline-none bg-transparent" />
          </Campo>

          <Campo label="Desde (origen)">
            <input type="text" value={origen} onChange={e => setOrigen(e.target.value)}
              placeholder="Ej: Salta centro"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-700 placeholder:font-normal" />
          </Campo>

          <Campo label="Hasta (destino) *">
            <input type="text" value={destino} onChange={e => setDestino(e.target.value)}
              placeholder="Ej: Cafayate"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-700 placeholder:font-normal" />
          </Campo>

          <Campo label="Notas adicionales">
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3}
              placeholder="¿Necesitás algo especial? Contanos acá."
              className="w-full text-base text-zinc-200 outline-none bg-transparent placeholder:text-zinc-700 resize-none" />
          </Campo>

        </div>

        {error && <p className="text-red-400 text-sm text-center font-semibold mt-3">{error}</p>}

        <button onClick={enviar} disabled={estado === 'enviando'}
          className="w-full mt-5 py-5 rounded-3xl bg-indigo-600 text-white font-extrabold text-lg shadow-xl shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50">
          {estado === 'enviando' ? 'Enviando…' : 'Reservar viaje →'}
        </button>

        <p className="text-zinc-700 text-xs text-center mt-4">Hecho con SAU</p>
      </div>
    </div>
  )
}

function Campo({ label, children }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
      <p className="text-[0.65rem] text-zinc-500 font-bold uppercase tracking-widest mb-1">{label}</p>
      {children}
    </div>
  )
}
