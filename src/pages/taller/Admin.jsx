import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ETAPAS_CON_OPERARIO, etapaLabel } from '../../lib/taller'
import { PRESETS, TAREAS, tareasAPermisos, permisosATareas } from '../EquipoTareas'

/**
 * Centro de administración del taller.
 *
 * Solo para quien tenga empresa.admin dentro de esta empresa: el riel ni
 * siquiera muestra la entrada al resto. No se cruza con /sau-admin, que es el
 * panel de SAU, ni da acceso a ninguna otra empresa.
 *
 * El alta de gente es por invitación de un solo uso: acá se decide qué va a
 * poder hacer cada persona, y esa decisión viaja guardada en la invitación.
 */

const PERFILES = PRESETS.filter(p => p.modulo === 'taller')

function resumenDeAccesos(permisos) {
  const ids = permisosATareas(permisos || [])
  if (ids.length === 0) return 'Sin accesos'
  return TAREAS.filter(t => ids.includes(t.id)).map(t => t.titulo).join(' · ')
}

/** Elegir perfil y, si trabaja en el taller, en qué etapas. */
function Accesos({ perfil, setPerfil, etapas, setEtapas }) {
  const trabaja = PERFILES.find(p => p.id === perfil)?.tareas.includes('taller_trabajo')

  return (
    <>
      <p className="t-legend" style={{ marginTop: 16 }}>QUÉ VA A PODER HACER</p>
      <div className="t-opciones">
        {PERFILES.map(p => (
          <button key={p.id} type="button"
                  className={`t-opcion${perfil === p.id ? ' elegida' : ''}`}
                  onClick={() => setPerfil(p.id)}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{p.icon}</span>
            <span>
              <span className="t-opcion-t" style={{ display: 'block' }}>{p.label}</span>
              <span className="t-opcion-d" style={{ display: 'block' }}>
                {resumenDeAccesos(tareasAPermisos(p.tareas))}
              </span>
            </span>
          </button>
        ))}
      </div>

      {trabaja && (
        <>
          <p className="t-legend" style={{ marginTop: 16 }}>EN QUÉ ETAPAS TRABAJA</p>
          <div className="t-opciones">
            {ETAPAS_CON_OPERARIO.map(e => (
              <button key={e.id} type="button"
                      className={`t-opcion${etapas.includes(e.id) ? ' elegida' : ''}`}
                      onClick={() => setEtapas(prev =>
                        prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id])}>
                <span className="t-opcion-t">{e.label}</span>
              </button>
            ))}
          </div>
          {etapas.length === 0 && (
            <p className="t-error" style={{ marginTop: 10, marginBottom: 0 }}>
              Sin etapas marcadas no va a poder dar por realizado ningún trabajo.
            </p>
          )}
        </>
      )}
    </>
  )
}

export default function Admin() {
  const { empresaActivaId, empresaActiva, user } = useAuth()

  const [equipo,       setEquipo]       = useState([])
  const [invitaciones, setInvitaciones] = useState([])
  const [cargando,     setCargando]     = useState(true)
  const [vista,        setVista]        = useState('lista')   // lista | invitar | editar
  const [editando,     setEditando]     = useState(null)
  const [error,        setError]        = useState(null)
  const [ocupado,      setOcupado]      = useState(false)

  // Formulario de invitación
  const [nombre,  setNombre]  = useState('')
  const [email,   setEmail]   = useState('')
  const [perfil,  setPerfil]  = useState('operario')
  const [etapas,  setEtapas]  = useState([])
  const [link,    setLink]    = useState(null)
  const [copiado, setCopiado] = useState(null)

  async function cargar() {
    if (!empresaActivaId) return
    setCargando(true)
    const [{ data: mems }, { data: invs }] = await Promise.all([
      supabase.from('membresia')
        .select('id, rol, permisos, activa, usuario_id, taller_etapas, profile:usuario_id(nombre, apellido)')
        .eq('empresa_id', empresaActivaId)
        .order('creado_en'),
      supabase.from('invitacion')
        .select('*')
        .eq('empresa_id', empresaActivaId)
        .is('usada_en', null)
        .order('creada_en', { ascending: false }),
    ])
    setEquipo(mems || [])
    setInvitaciones(invs || [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [empresaActivaId])

  function volver() {
    setVista('lista'); setEditando(null); setLink(null); setError(null)
    setNombre(''); setEmail(''); setPerfil('operario'); setEtapas([])
  }

  async function invitar() {
    if (!nombre.trim()) return setError('Falta el nombre')
    if (!email.trim())  return setError('Falta el email, que es a donde va la invitación')
    setError(null); setOcupado(true)

    const { data, error: err } = await supabase.functions.invoke('invitar', {
      body: {
        empresa_id: empresaActivaId,
        nombre: nombre.trim(),
        email: email.trim(),
        rol: 'empleado',
        permisos: tareasAPermisos(PERFILES.find(p => p.id === perfil)?.tareas || []),
        taller_etapas: etapas,
      },
    })

    setOcupado(false)
    if (err || !data?.ok) return setError(data?.error || 'No se pudo generar la invitación')
    setLink(`${window.location.origin}/invitacion/${data.token}`)
    cargar()
  }

  function abrirEdicion(m) {
    const ids = permisosATareas(m.permisos || [])
    const coincide = PERFILES.find(p => [...p.tareas].sort().join() === [...ids].sort().join())
    setEditando(m)
    setPerfil(coincide?.id || 'operario')
    setEtapas(m.taller_etapas || [])
    setError(null)
    setVista('editar')
  }

  async function guardarEdicion() {
    setOcupado(true)
    const permisos = tareasAPermisos(PERFILES.find(p => p.id === perfil)?.tareas || [])
    const { error: err } = await supabase.from('membresia')
      .update({ permisos, taller_etapas: etapas })
      .eq('id', editando.id)
    setOcupado(false)
    if (err) return setError(err.message)
    await cargar()
    volver()
  }

  async function cambiarEstado(m) {
    setOcupado(true)
    await supabase.from('membresia').update({ activa: !m.activa }).eq('id', m.id)
    await cargar()
    setOcupado(false)
  }

  async function revocar(inv) {
    setOcupado(true)
    await supabase.from('invitacion').delete().eq('id', inv.id)
    await cargar()
    setOcupado(false)
  }

  function copiar(texto, id) {
    navigator.clipboard.writeText(texto)
    setCopiado(id)
    setTimeout(() => setCopiado(null), 2000)
  }

  if (cargando) {
    return <main className="t-page"><p className="t-eyebrow">CARGANDO EQUIPO…</p></main>
  }

  // ── Invitar ──────────────────────────────────────────────────
  if (vista === 'invitar') {
    return (
      <main className="t-page">
        <button className="t-eyebrow" onClick={volver}>← VOLVER A ADMINISTRACIÓN</button>
        <h1 className="t-h1" style={{ marginTop: 8 }}>Sumar a alguien</h1>
        <p className="t-sub">
          Elegís qué va a poder hacer y le mandás el link. La contraseña la elige esa persona.
        </p>

        <section className="t-panel" style={{ marginTop: 20 }}>
          {link ? (
            <>
              <p className="t-ok">Invitación lista para {nombre}.</p>
              <p className="t-link" style={{ marginTop: 10 }}>{link}</p>
              <p className="t-aviso" style={{ marginTop: 10 }}>
                Sirve una sola vez y vence en 7 días. Si se vence, generás otra.
              </p>
              <div className="t-acciones">
                <button className="t-btn" onClick={() => copiar(link, 'nueva')}>
                  {copiado === 'nueva' ? 'Copiado' : 'Copiar link'}
                </button>
                <button className="t-btn fantasma" onClick={volver}>Listo</button>
              </div>
            </>
          ) : (
            <>
              <p className="t-legend">QUIÉN ES</p>
              <div className="t-grid">
                <div className="t-field">
                  <span className="t-label">Nombre y apellido <span className="t-req">*</span></span>
                  <input className="t-input" value={nombre} onChange={e => setNombre(e.target.value)}
                         placeholder="Juan Vargas" autoFocus />
                </div>
                <div className="t-field">
                  <span className="t-label">Email <span className="t-req">*</span></span>
                  <input className="t-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                         placeholder="juan@taller.com" />
                </div>
              </div>

              <Accesos perfil={perfil} setPerfil={setPerfil} etapas={etapas} setEtapas={setEtapas} />

              {error && <p className="t-error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</p>}

              <div className="t-acciones">
                <button className="t-btn" onClick={invitar} disabled={ocupado}>
                  {ocupado ? 'Generando…' : 'Generar invitación'}
                </button>
                <button className="t-btn fantasma" onClick={volver}>Cancelar</button>
              </div>
            </>
          )}
        </section>
      </main>
    )
  }

  // ── Editar a alguien ─────────────────────────────────────────
  if (vista === 'editar' && editando) {
    const p = editando.profile
    return (
      <main className="t-page">
        <button className="t-eyebrow" onClick={volver}>← VOLVER A ADMINISTRACIÓN</button>
        <h1 className="t-h1" style={{ marginTop: 8 }}>
          {[p?.nombre, p?.apellido].filter(Boolean).join(' ') || 'Integrante'}
        </h1>
        <p className="t-sub">Cambiá qué puede hacer y en qué etapas trabaja.</p>

        <section className="t-panel" style={{ marginTop: 20 }}>
          <Accesos perfil={perfil} setPerfil={setPerfil} etapas={etapas} setEtapas={setEtapas} />

          {error && <p className="t-error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</p>}

          <div className="t-acciones">
            <button className="t-btn" onClick={guardarEdicion} disabled={ocupado}>
              {ocupado ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button className="t-btn fantasma" onClick={volver}>Cancelar</button>
          </div>
        </section>
      </main>
    )
  }

  // ── Lista ────────────────────────────────────────────────────
  const activos = equipo.filter(m => m.activa)

  return (
    <main className="t-page">
      <div className="t-head">
        <div>
          <p className="t-eyebrow">
            {(empresaActiva?.nombre_fantasia || 'TALLER').toUpperCase()} · ADMINISTRACIÓN
          </p>
          <h1 className="t-h1">Equipo del taller</h1>
          <p className="t-sub">
            {activos.length} {activos.length === 1 ? 'persona activa' : 'personas activas'}
            {invitaciones.length > 0 && ` · ${invitaciones.length} invitación${invitaciones.length > 1 ? 'es' : ''} sin usar`}
          </p>
        </div>
        <button className="t-btn" onClick={() => { volver(); setVista('invitar') }}>
          Sumar a alguien
        </button>
      </div>

      <section className="t-panel" style={{ marginTop: 20 }}>
        <p className="t-legend">GENTE DEL TALLER</p>
        {equipo.map(m => {
          const p = m.profile
          const soyYo = m.usuario_id === user?.id
          const etapasTexto = (m.taller_etapas || []).map(etapaLabel).join(' · ')
          return (
            <div key={m.id} className="t-persona">
              <div style={{ minWidth: 0 }}>
                <p className="t-persona-n">
                  {[p?.nombre, p?.apellido].filter(Boolean).join(' ') || 'Sin nombre'}
                  {soyYo && <span className="t-chip vos" style={{ marginLeft: 8 }}>VOS</span>}
                  {!m.activa && <span className="t-chip baja" style={{ marginLeft: 8 }}>DADO DE BAJA</span>}
                </p>
                <p className="t-persona-d">{resumenDeAccesos(m.permisos)}</p>
                {etapasTexto && <p className="t-persona-e">TRABAJA EN {etapasTexto.toUpperCase()}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="t-btn fantasma" style={{ fontSize: 13, padding: '7px 11px' }}
                        onClick={() => abrirEdicion(m)}>
                  Editar
                </button>
                {!soyYo && (
                  <button className="t-btn fantasma" style={{ fontSize: 13, padding: '7px 11px' }}
                          disabled={ocupado} onClick={() => cambiarEstado(m)}>
                    {m.activa ? 'Dar de baja' : 'Reactivar'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </section>

      {invitaciones.length > 0 && (
        <section className="t-panel">
          <p className="t-legend">INVITACIONES SIN USAR</p>
          {invitaciones.map(inv => {
            const vencida = new Date(inv.expira_en) < new Date()
            const link = `${window.location.origin}/invitacion/${inv.token}`
            return (
              <div key={inv.id} className="t-persona">
                <div style={{ minWidth: 0 }}>
                  <p className="t-persona-n">
                    {inv.nombre}
                    {vencida && <span className="t-chip vence" style={{ marginLeft: 8 }}>VENCIDA</span>}
                  </p>
                  <p className="t-persona-d">{inv.email}</p>
                  <p className="t-persona-e">
                    {vencida ? 'VENCIÓ EL ' : 'VENCE EL '}
                    {new Date(inv.expira_en).toLocaleDateString('es-AR')}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {!vencida && (
                    <button className="t-btn fantasma" style={{ fontSize: 13, padding: '7px 11px' }}
                            onClick={() => copiar(link, inv.id)}>
                      {copiado === inv.id ? 'Copiado' : 'Copiar link'}
                    </button>
                  )}
                  <button className="t-btn fantasma" style={{ fontSize: 13, padding: '7px 11px' }}
                          disabled={ocupado} onClick={() => revocar(inv)}>
                    Revocar
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <p className="t-aviso" style={{ marginTop: 12 }}>
        Quien queda dado de baja pierde el acceso pero no se borra: su trabajo sigue registrado en
        la bitácora de cada vehículo.
      </p>
    </main>
  )
}
