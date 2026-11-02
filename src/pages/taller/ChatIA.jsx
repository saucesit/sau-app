import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import '../../styles/chatIa.css'

/**
 * SAU IA: el chat de análisis.
 *
 * EXPERIMENTAL. Se muestra solo para una empresa y un usuario. El mismo
 * recorte está en el servidor (chat-taller), que es el que manda: esto es para
 * no dibujar un botón que va a ser rechazado, no una medida de seguridad.
 *
 * Es de consulta: pregunta en castellano, respuesta sobre los datos reales del
 * taller. No hace nada sobre los vehículos y no tiene por qué parecer que sí.
 *
 * El componente no sabe nada del taller salvo dónde está montado: sus estilos
 * viven aparte y toman la paleta por variables con respaldo, así que se puede
 * colgar de otro módulo sin tocarlo.
 */

/**
 * Quién tiene SAU IA, por ahora.
 *
 * Pares empresa–personas, no dos listas sueltas: cada quien entra únicamente
 * al taller donde fue nombrado. Ni el rol ni los permisos habilitan nada —en
 * Forani hay tres usuarios con rol `dueno` y solo uno está acá—.
 *
 * ESTO NO ES LA SEGURIDAD. La misma lista está en la Edge Function
 * chat-taller, que es la que decide de verdad; acá está para no dibujar un
 * botón que el servidor va a rechazar. Si cambia una, cambia la otra, y hay
 * una prueba que compara las dos y falla si se separan.
 */
const HABILITADOS = [
  // TALLER SAN MARTÍN — entorno de prueba
  { empresa: '11111111-aaaa-4aaa-8aaa-111111111111',
    usuarios: ['taller-a-completo@prueba.sau'] },
  // TALLER FORANI — producción. Solo Tefo.
  { empresa: 'bdd20f9b-1030-434a-96de-2418afb53760',
    usuarios: ['estefano.forani@outlook.com'] },
]

function chatIaHabilitado(empresaActivaId, email) {
  const correo = (email || '').trim().toLowerCase()
  if (!correo || !empresaActivaId) return false
  return HABILITADOS.some(h =>
    h.empresa === empresaActivaId && h.usuarios.includes(correo))
}

const EJEMPLOS = [
  '¿Qué compañías tienen más vehículos?',
  '¿Cuáles son los autos que más tiempo llevan en taller?',
  '¿Qué productores ingresaron más vehículos este año?',
]

/** Alto máximo del campo antes de que empiece a scrollear. Igual que el CSS. */
const ALTO_MAX = 96

export default function ChatIA() {
  const { empresaActivaId, user } = useAuth()
  const [abierto,  setAbierto]  = useState(false)
  const [mensajes, setMensajes] = useState([])
  const [texto,    setTexto]    = useState('')
  const [pensando, setPensando] = useState(false)
  const casoRef  = useRef(null)
  const cuerpoRef = useRef(null)
  const campoRef  = useRef(null)

  // El foco al abrir va solo en pantalla grande. En un teléfono enfocar sube
  // el teclado de entrada, y la primera impresión del chat termina siendo
  // media pantalla de teclado sobre un panel vacío.
  useEffect(() => {
    if (!abierto) return
    const grande = window.matchMedia('(min-width: 641px)').matches
    if (grande) campoRef.current?.focus()
  }, [abierto])

  /**
   * Bajar la conversación moviendo SOLO el contenedor.
   *
   * Antes esto usaba scrollIntoView sobre un elemento del final. En un celular,
   * con el panel fijo encima de la pizarra, el navegador resuelve ese pedido
   * desplazando lo que haga falta —incluida la página de atrás— y al cerrar el
   * chat el taller había quedado en otra posición.
   */
  useLayoutEffect(() => {
    const c = cuerpoRef.current
    if (c) c.scrollTop = c.scrollHeight
  }, [mensajes, pensando, abierto])

  // El campo crece con lo que se escribe hasta un tope, y vuelve a achicarse.
  useLayoutEffect(() => {
    const c = campoRef.current
    if (!c) return
    c.style.height = 'auto'
    c.style.height = Math.min(c.scrollHeight, ALTO_MAX) + 'px'
  }, [texto, abierto])

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

  function alTeclear(ev) {
    // Enter manda, Shift+Enter hace un renglón. En celular el teclado trae su
    // propia tecla de salto y no dispara esto, así que no estorba.
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      preguntar()
    }
  }

  if (!abierto) {
    return (
      <button className="sau-chat-burbuja" onClick={() => setAbierto(true)}
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
    <aside className="sau-chat" aria-label="SAU IA">
      <header className="sau-chat-head">
        <div>
          <p className="sau-chat-t">SAU IA</p>
          <p className="sau-chat-s">Consulta sobre los datos de tu taller · en prueba</p>
        </div>
        <button className="sau-chat-x" onClick={() => setAbierto(false)}
                aria-label="Cerrar SAU IA">✕</button>
      </header>

      <div className="sau-chat-cuerpo" ref={cuerpoRef}>
        {mensajes.length === 0 && (
          <div className="sau-chat-vacio">
            <p>Preguntá en castellano sobre los vehículos del taller. Respondo
               consultando los datos reales; si no hay información, lo digo.</p>
            <p className="sau-chat-nota">No modifico nada: solo leo.</p>
            <div className="sau-chat-ejemplos">
              {EJEMPLOS.map(e => (
                <button key={e} className="sau-chat-ejemplo" onClick={() => preguntar(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={`sau-chat-msg ${m.de}${m.error ? ' error' : ''}`}>
            <p>{m.texto}</p>
            {/* Durante el experimento interesa ver de dónde salió cada número. */}
            {m.herramientas?.length > 0 && (
              <p className="sau-chat-fuente">
                {m.herramientas.map(h => h.nombre).join(' · ')}
              </p>
            )}
          </div>
        ))}

        {pensando && (
          <div className="sau-chat-msg sau pensando"><p>Consultando los datos…</p></div>
        )}
      </div>

      <form className="sau-chat-pie" onSubmit={e => { e.preventDefault(); preguntar() }}>
        <textarea ref={campoRef} className="sau-chat-campo" rows={1}
                  value={texto} disabled={pensando}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={alTeclear}
                  placeholder="Preguntá sobre los vehículos…"
                  aria-label="Tu pregunta" />
        <button className="sau-chat-enviar" type="submit" disabled={pensando || !texto.trim()}>
          Preguntar
        </button>
      </form>
    </aside>
  )
}
