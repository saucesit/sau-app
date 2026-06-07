import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const CANSADO_DE = [
  'no saber cuánto vendiste al final del día',
  'que el fiado se pierda y nunca lo cobrés',
  'que tus empleados no registren nada',
  'hacer las cuentas en papel o de memoria',
  'no entender una palabra de lo que te dice el contador',
  'enterarte en enero que tenías que recategorizarte',
  'no saber si tu negocio gana o pierde plata',
  'que el stock se evapore y no sabés a dónde fue',
  'que te caiga una multa de AFIP sin aviso',
  'llevar la caja en la cabeza y que no cierre nunca',
]

function formatTiempo(seg) {
  const m = Math.floor(seg / 60).toString().padStart(2,'0')
  const s = (seg % 60).toString().padStart(2,'0')
  return `${m}:${s}`
}

// ── Pantalla de éxito ─────────────────────────────────────────────
function Exito({ onReintentar }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center gap-6">
      <div className="text-7xl animate-bounce">🤙</div>
      <h2 className="text-white font-black text-3xl leading-tight">
        Lo recibimos, papá.
      </h2>
      <p className="text-zinc-400 text-lg leading-relaxed max-w-sm">
        En menos de <strong className="text-emerald-400">24 horas</strong> alguien de SAU te contacta con la solución.
      </p>
      <a href="https://wa.me/543874638747?text=Mandé+un+audio+en+SAU,+quiero+hablar"
        target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-3 bg-[#25D366] text-white font-extrabold text-base px-6 py-4 rounded-full shadow-lg shadow-green-900/40 active:scale-95 transition-all"
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.004 2C6.477 2 2 6.477 2 12.004c0 1.77.459 3.432 1.265 4.878L2 22l5.234-1.249A9.955 9.955 0 0012.004 22C17.53 22 22 17.523 22 12.004 22 6.477 17.53 2 12.004 2z" fillRule="evenodd" clipRule="evenodd"/></svg>
        Escribinos por WhatsApp
      </a>
      <button onClick={onReintentar}
        className="text-zinc-600 text-sm underline underline-offset-4">
        Mandar otro audio
      </button>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────
export default function Landing() {
  const [estado,   setEstado]   = useState('idle')    // idle | solicitando | grabando | grabado | enviando | enviado
  const [segundos, setSegundos] = useState(0)
  const [audioBlob,setAudioBlob]= useState(null)
  const [audioURL, setAudioURL] = useState(null)
  const [nombre,   setNombre]   = useState('')
  const [telefono, setTelefono] = useState('')
  const [error,    setError]    = useState(null)
  const [cansadoIdx, setCansadoIdx] = useState(0)

  const mediaRecorderRef = useRef(null)
  const streamRef        = useRef(null)
  const chunksRef        = useRef([])
  const timerRef         = useRef(null)

  // Rotar el texto "cansado de..."
  useEffect(() => {
    const iv = setInterval(() => {
      setCansadoIdx(i => (i + 1) % CANSADO_DE.length)
    }, 2800)
    return () => clearInterval(iv)
  }, [])

  // Timer de grabación
  useEffect(() => {
    if (estado === 'grabando') {
      timerRef.current = setInterval(() => setSegundos(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
      if (estado !== 'grabado') setSegundos(0)
    }
    return () => clearInterval(timerRef.current)
  }, [estado])

  async function solicitarMic() {
    setEstado('solicitando')
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        setAudioURL(URL.createObjectURL(blob))
        setEstado('grabado')
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start()
      setEstado('grabando')
    } catch {
      setError('Necesitamos acceso al micrófono. Habilitalo en tu navegador y volvé a intentar.')
      setEstado('idle')
    }
  }

  function detenerGrabacion() {
    mediaRecorderRef.current?.stop()
  }

  function regrabar() {
    setAudioBlob(null)
    setAudioURL(null)
    setSegundos(0)
    setEstado('idle')
  }

  async function enviar() {
    if (!audioBlob) return
    setEstado('enviando')
    setError(null)
    try {
      const fileName = `consulta-${Date.now()}.webm`
      const { error: uploadError } = await supabase.storage
        .from('consultas')
        .upload(fileName, audioBlob, { contentType: 'audio/webm', upsert: false })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('consultas')
        .getPublicUrl(fileName)

      const { error: insertError } = await supabase.from('consulta_sau').insert({
        audio_url: publicUrl,
        nombre:    nombre.trim() || null,
        telefono:  telefono.trim() || null,
      })
      if (insertError) throw insertError

      // Notificar por WhatsApp (no bloqueante — si falla igual mostramos éxito)
      supabase.functions.invoke('notificar-consulta', {
        body: { nombre: nombre.trim() || null, telefono: telefono.trim() || null, audio_url: publicUrl }
      }).catch(e => console.warn('Notificación WhatsApp falló:', e))

      setEstado('enviado')
    } catch (e) {
      setError('Algo salió mal al enviar el audio. Intentá de nuevo.')
      setEstado('grabado')
    }
  }

  if (estado === 'enviado') {
    return <Exito onReintentar={() => { setEstado('idle'); setNombre(''); setTelefono('') }} />
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">

      {/* Header */}
      <header className="flex flex-col items-center pt-10 pb-2 gap-2">
        <img src="/logo.png" alt="SAU"
          className="w-20 h-20 rounded-2xl"
          style={{ filter: 'drop-shadow(0 0 24px rgba(0, 200, 120, 0.5))' }}
        />
        <p className="text-white font-extrabold text-lg tracking-widest uppercase">SAU</p>
        <p className="text-zinc-500 text-xs font-medium tracking-widest uppercase">Sistema de Administración Unificado</p>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-8 gap-8 max-w-lg mx-auto w-full">

        {/* Headline */}
        <div className="text-center">
          <h1 className="text-white font-black leading-tight mb-3"
            style={{ fontSize:'clamp(2rem, 8vw, 2.8rem)' }}>
            ¿Qué quilombo<br />tenés en tu negocio?
          </h1>
          <div className="h-8 overflow-hidden">
            <p key={cansadoIdx}
              className="text-zinc-400 text-base font-medium animate-pulse"
              style={{ animation: 'fadeSlide 0.5s ease' }}
            >
              ¿Cansado de <span className="text-emerald-400 font-bold">{CANSADO_DE[cansadoIdx]}</span>?
            </p>
          </div>
        </div>

        {/* Botón de grabación */}
        {(estado === 'idle' || estado === 'solicitando') && (
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={solicitarMic}
              disabled={estado === 'solicitando'}
              className="w-36 h-36 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600
                shadow-2xl shadow-emerald-500/40 ring-4 ring-emerald-400/30 ring-offset-4 ring-offset-zinc-950
                flex flex-col items-center justify-center gap-2
                active:scale-95 transition-all disabled:opacity-50
                hover:shadow-emerald-400/60 hover:scale-105"
              style={{ animation: 'pulse 2.5s ease-in-out infinite' }}
            >
              <span className="text-4xl">🎤</span>
              <span className="text-white font-extrabold text-sm uppercase tracking-wide">
                {estado === 'solicitando' ? 'Un seg...' : 'Grabá'}
              </span>
            </button>
            <p className="text-zinc-500 text-sm text-center max-w-xs">
              Presioná, putea todo lo que quieras.<br/>
              <span className="text-zinc-400">SAU te escucha y te da una solución.</span>
            </p>
          </div>
        )}

        {/* Grabando */}
        {estado === 'grabando' && (
          <div className="flex flex-col items-center gap-6">
            <button onClick={detenerGrabacion}
              className="w-36 h-36 rounded-full bg-gradient-to-br from-red-500 to-red-700
                shadow-2xl shadow-red-500/50 ring-4 ring-red-400/40 ring-offset-4 ring-offset-zinc-950
                flex flex-col items-center justify-center gap-2
                active:scale-95 transition-all"
              style={{ animation: 'pulse 1s ease-in-out infinite' }}
            >
              <div className="w-8 h-8 rounded bg-white" />
              <span className="text-white font-extrabold text-sm uppercase tracking-wide">Parar</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 font-extrabold text-xl font-mono">{formatTiempo(segundos)}</span>
              <span className="text-zinc-500 text-sm">grabando...</span>
            </div>
            <p className="text-zinc-400 text-sm text-center">Dale, contá todo. Nadie te juzga.</p>
          </div>
        )}

        {/* Audio grabado */}
        {estado === 'grabado' && audioURL && (
          <div className="w-full grid gap-4">
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
              <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-3">Tu audio ({formatTiempo(segundos)})</p>
              <audio src={audioURL} controls className="w-full rounded-xl" />
            </div>

            {/* Datos opcionales */}
            <div className="grid gap-2">
              <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder="Tu nombre (opcional)"
                className="w-full px-4 py-3 rounded-2xl bg-zinc-900 text-white placeholder:text-zinc-600 outline-none border border-zinc-800 focus:border-emerald-500 transition-colors"
              />
              <input type="tel" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)}
                placeholder="Tu WhatsApp (opcional)"
                className="w-full px-4 py-3 rounded-2xl bg-zinc-900 text-white placeholder:text-zinc-600 outline-none border border-zinc-800 focus:border-emerald-500 transition-colors"
              />
            </div>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <button onClick={regrabar}
                className="py-4 rounded-3xl bg-zinc-800 text-zinc-400 font-bold active:scale-95 transition-all">
                Regrabar
              </button>
              <button onClick={enviar}
                className="py-4 rounded-3xl bg-emerald-500 text-white font-extrabold shadow-lg shadow-emerald-900/50 active:scale-95 transition-all">
                Mandar 🚀
              </button>
            </div>
          </div>
        )}

        {/* Enviando */}
        {estado === 'enviando' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center animate-spin border-4 border-emerald-500 border-t-transparent" />
            <p className="text-zinc-400">Enviando tu audio...</p>
          </div>
        )}

        {error && estado === 'idle' && (
          <p className="text-red-400 text-sm text-center bg-red-950/50 px-4 py-3 rounded-2xl">{error}</p>
        )}

      </div>

      {/* Footer */}
      <footer className="text-center pb-8">
        <p className="text-zinc-700 text-xs">
          SAU · Sistema de Administración Unificado
        </p>
      </footer>

      <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

    </div>
  )
}
