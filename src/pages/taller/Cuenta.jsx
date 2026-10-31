import { useState } from 'react'
import { supabase, verificarPassword } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { etapaLabel } from '../../lib/taller'
import { RUTA_MODULO } from '../../lib/inicio'
import { TAREAS, permisosATareas } from '../EquipoTareas'

/**
 * La cuenta de quien está usando el taller.
 *
 * Existe por dos motivos que resultaron ser el mismo. Uno: nadie en SAU podía
 * cambiarse la contraseña, y hay cuentas andando con la provisoria que les
 * pusimos nosotros. Dos: el riel tenía un botón "Volver a SAU" que para
 * Forani no iba a ningún lado, porque su empresa entra directo al taller y el
 * Inicio general la devuelve acá.
 *
 * Acá no se administra a nadie más. Lo único que se puede tocar es la propia
 * contraseña, y eso lo resuelve Supabase Auth sobre la sesión que ya está
 * abierta: SAU no guarda, no lee y no transporta contraseñas en ninguna tabla.
 */

/** Solo se ofrece ir a SAU si de verdad hay otro módulo con pantalla propia. */
function otrosModulos(modulosActivos) {
  return (modulosActivos || []).filter(m => m !== 'taller' && RUTA_MODULO[m])
}

/**
 * Cuándo se cambió la contraseña, fuera del componente y a propósito.
 *
 * Cambiarla dispara USER_UPDATED, y AuthContext responde recargando el perfil:
 * mientras eso pasa la ruta muestra el Splash y esta pantalla se desmonta y se
 * vuelve a montar de cero. Si el "listo" viviera solo en useState, el cartel
 * de éxito desaparecería exactamente en el momento en que hay que mostrarlo, y
 * quien cambió la contraseña se quedaría sin saber si funcionó.
 *
 * Vive acá para sobrevivir a ese remonte. Se descarta solo a los 15 segundos y
 * no sale del módulo: no es estado de la aplicación, es el eco de una acción
 * que acaba de pasar en esta misma pantalla.
 */
let cambiadaEn = 0
const RECIEN = 15000

/** Un dato de la cuenta: etiqueta arriba, valor abajo y a la izquierda. */
function Fila({ etiqueta, valor }) {
  return (
    <div style={{ padding: '7px 0', borderBottom: '1px solid var(--t-rule-2)' }}>
      <span className="t-doc-m" style={{ display: 'block', marginTop: 0 }}>
        {etiqueta.toUpperCase()}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
}

export default function Cuenta() {
  const { user, profile, empresaActiva, permisos, tallerEtapas,
          modulosActivos, signOut } = useAuth()

  const [actual,   setActual]   = useState('')
  const [nueva,    setNueva]    = useState('')
  const [repetida, setRepetida] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [listo, setListo] = useState(() => Date.now() - cambiadaEn < RECIEN)

  const nombre = [profile?.nombre, profile?.apellido].filter(Boolean).join(' ') || '—'
  const accesos = TAREAS.filter(t => permisosATareas(permisos || []).includes(t.id))
  const otros = otrosModulos(modulosActivos)

  async function cambiar() {
    setError(null)

    if (nueva.length < 6) {
      return setError('La contraseña nueva tiene que tener al menos 6 caracteres.')
    }
    if (nueva !== repetida) {
      return setError('Las dos contraseñas nuevas no coinciden.')
    }
    if (nueva === actual) {
      return setError('La contraseña nueva tiene que ser distinta de la actual.')
    }

    setGuardando(true)

    // Se pide la actual y se verifica de verdad. Supabase deja cambiarla solo
    // con la sesión abierta, pero entonces una sesión olvidada en la compu del
    // taller alcanzaría para quedarse con la cuenta. Verificar cuesta una
    // llamada y cierra eso.
    //
    // No se usa signInWithPassword: eso reemplaza la sesión del cliente, y el
    // remonte que dispara se come el cartel de "listo" justo cuando hay que
    // mostrarlo. verificarPassword pregunta lo mismo y no toca nada.
    const correcta = await verificarPassword(user?.email, actual)
    if (!correcta) {
      setGuardando(false)
      return setError('La contraseña actual no es correcta.')
    }

    const { error: updErr } = await supabase.auth.updateUser({ password: nueva })
    setGuardando(false)
    if (updErr) {
      return setError(updErr.message === 'New password should be different from the old password.'
        ? 'La contraseña nueva tiene que ser distinta de la actual.'
        : updErr.message)
    }

    setActual(''); setNueva(''); setRepetida('')
    cambiadaEn = Date.now()
    setListo(true)
  }

  return (
    <main className="t-page">
      <p className="t-eyebrow">MI CUENTA</p>
      <h1 className="t-h1" style={{ marginTop: 8 }}>{nombre}</h1>
      <p className="t-sub">{user?.email}</p>

      <section className="t-panel" style={{ marginTop: 20 }}>
        <p className="t-legend">DÓNDE ESTOY TRABAJANDO</p>
        {/* Apilado y no en dos columnas: la lista de accesos de un Completo
            son seis frases, y en un celular de 375px eso no entra al lado de
            su etiqueta. */}
        <Fila etiqueta="Taller"
              valor={empresaActiva?.nombre_fantasia || empresaActiva?.razon_social || '—'} />
        <Fila etiqueta="Qué puedo hacer"
              valor={accesos.length ? accesos.map(t => t.titulo).join(' · ') : 'Sin accesos'} />
        {tallerEtapas?.length > 0 && (
          <Fila etiqueta="Etapas de mi oficio"
                valor={tallerEtapas.map(etapaLabel).join(' · ')} />
        )}
        <p className="t-aviso" style={{ marginTop: 12 }}>
          Esto no se cambia desde acá. Si algo no coincide con lo que hacés,
          pedíselo a quien administra el taller.
        </p>
      </section>

      <section className="t-panel">
        <p className="t-legend">CAMBIAR MI CONTRASEÑA</p>

        {listo ? (
          <>
            <p className="t-ok">Contraseña cambiada. La próxima vez que entres, usá la nueva.</p>
            <div className="t-acciones">
              <button className="t-btn fantasma"
                      onClick={() => { cambiadaEn = 0; setListo(false) }}>
                Cambiarla de nuevo
              </button>
            </div>
          </>
        ) : (
          <>
            {error && <p className="t-error">{error}</p>}
            <div className="t-grid">
              <label className="t-field">
                <span className="t-label">Contraseña actual</span>
                <input className="t-input" type="password" autoComplete="current-password"
                       value={actual} onChange={e => setActual(e.target.value)} />
              </label>
              <label className="t-field">
                <span className="t-label">Contraseña nueva</span>
                <input className="t-input" type="password" autoComplete="new-password"
                       value={nueva} onChange={e => setNueva(e.target.value)} />
              </label>
              <label className="t-field">
                <span className="t-label">Repetir la nueva</span>
                <input className="t-input" type="password" autoComplete="new-password"
                       value={repetida} onChange={e => setRepetida(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') cambiar() }} />
              </label>
            </div>
            <p className="t-aviso" style={{ marginTop: 10 }}>
              Mínimo 6 caracteres. Solo cambia tu propia contraseña: nadie más
              la ve, y SAU no la guarda en ningún lado.
            </p>
            <div className="t-acciones">
              <button className="t-btn" onClick={cambiar}
                      disabled={guardando || !actual || !nueva || !repetida}>
                {guardando ? 'Cambiando…' : 'Cambiar contraseña'}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="t-panel">
        <p className="t-legend">SESIÓN</p>
        {otros.length > 0 && (
          <p className="t-aviso" style={{ marginBottom: 12 }}>
            Esta empresa también tiene{' '}
            {otros.length === 1 ? 'otro módulo' : 'otros módulos'} en SAU.{' '}
            <a className="t-link" href={RUTA_MODULO[otros[0]]}>Ir a SAU</a>
          </p>
        )}
        <div className="t-acciones">
          <button className="t-btn fantasma" onClick={signOut}>Cerrar sesión</button>
        </div>
      </section>
    </main>
  )
}
