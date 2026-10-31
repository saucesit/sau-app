import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

/**
 * SAU IA: el chat de análisis del taller.
 *
 * EXPERIMENTAL. Se muestra solo para una empresa y un usuario. El mismo
 * recorte está en el servidor (chat-taller), que es el que manda: esto es para
 * no dibujar un botón que va a ser rechazado, no una medida de seguridad.
 *
 * Es de consulta: pregunta en castellano, respuesta sobre los datos reales del
 * taller. No hace nada sobre los vehículos y no tiene por qué parecer que sí.
 */

// Mismas constantes que la Edge Function. Si cambia una, cambia la otra.
const EMPRESA_HABILITADA = '11111111-aaaa-4aaa-8aaa-111111111111'  // TALLER SAN MARTÍN
const USUARIOS_HABILITADOS = ['taller-a-completo@prueba.sau']

function chatIaHabilitado(empresaActivaId, email) {
  return empresaActivaId === EMPRESA_HABILITADA &&
         USUARIOS_HABILITADOS.includes((email || '').toLowerCase())
}

const EJEMPLOS = [
  '¿Qué compañías tienen más vehículos?',
  '¿Cuáles son los autos que más tiempo llevan en taller?',
  '¿Qué productores ingresaron más vehículos este año?',
]

export default function ChatIA() {
  const { empresaActivaId, user } = useAuth()
  const [abierto,  setAbierto]  = useState(false)
  const [mensajes, setMensajes] = useState([])
  const [texto,    setTexto]    = useState('')
  const [pensando, setPensando] = useState(false)
  const casoRef = useRef(null)
  const finRef  = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (abierto) inputRef.current?.focus()
  }, [abierto])

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes, pensando])

  if (!chatIaHabilitado(empresaActivaId, user?.email)) return null

  async function preguntar(pregunta) {
    const q = (pregunta ?? texto).trim()
    if (!q || pensando) return
    setMensajes(m => [...m, { de: 'yo', texto: q }])
    setTexto('')
    setPensando(true)

    const { data, error } = await supabase.functions.invoke('chat-taller', {
      body: { pregunta: q, caso_id: casoRef.current },
    })

    setPensando(false)

    // El invoke devuelve error para cualquier status != 2xx; el motivo real
    // viene en el cuerpo, así que se intenta leer antes de dar un genérico.
    if (error || !data?.ok) {
      let motivo = data?.error
      if (!motivo && error?.context?.json) {
        try { motivo = (await error.context.json())?.error } catch { /* queda el genérico */ }
      }
      setMensajes(m => [...m, {
        de: 'sau', error: true,
        texto: motivo || 'No se pudo consultar. Probá de nuevo en un momento.',
      }])
      return
    }

    casoRef.current = data.caso_id
    setMensajes(m => [...m, {
      de: 'sau', texto: data.respuesta,
      herramientas: data.herramientas || [],
    }])
  }

  if (!abierto) {
    return (
      <button className="t-ia-burbuja" onClick={() => setAbierto(true)}
              title="Preguntarle a SAU IA" aria-label="Abrir SAU IA">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
             stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
        </svg>
        <span>SAU IA</span>
      </button>
    )
  }

  return (
    <aside className="t-ia" aria-label="SAU IA">
      <header className="t-ia-head">
        <div>
          <p className="t-ia-t">SAU IA</p>
          <p className="t-ia-s">Consulta sobre los datos de tu taller · en prueba</p>
        </div>
        <button className="t-ia-x" onClick={() => setAbierto(false)} aria-label="Cerrar">✕</button>
      </header>

      <div className="t-ia-cuerpo">
        {mensajes.length === 0 && (
          <div className="t-ia-vacio">
            <p>Preguntá en castellano sobre los vehículos del taller. Respondo
               consultando los datos reales; si no hay información, lo digo.</p>
            <p className="t-ia-nota">No modifico nada: solo leo.</p>
            <div className="t-ia-ejemplos">
              {EJEMPLOS.map(e => (
                <button key={e} className="t-ia-ejemplo" onClick={() => preguntar(e)}>{e}</button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={`t-ia-msg ${m.de}${m.error ? ' error' : ''}`}>
            <p>{m.texto}</p>
            {/* Durante el experimento interesa ver de dónde salió cada número. */}
            {m.herramientas?.length > 0 && (
              <p className="t-ia-fuente">
                {m.herramientas.map(h => h.nombre).join(' · ')}
              </p>
            )}
          </div>
        ))}

        {pensando && <div className="t-ia-msg sau pensando"><p>Consultando los datos…</p></div>}
        <div ref={finRef} />
      </div>

      <form className="t-ia-pie" onSubmit={e => { e.preventDefault(); preguntar() }}>
        <input ref={inputRef} className="t-input" value={texto} disabled={pensando}
               onChange={e => setTexto(e.target.value)}
               placeholder="Preguntá sobre los vehículos del taller…"
               aria-label="Tu pregunta" />
        <button className="t-btn" type="submit" disabled={pensando || !texto.trim()}>
          Preguntar
        </button>
      </form>
    </aside>
  )
}
