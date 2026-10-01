import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  ETAPAS, ETAPAS_ACTIVAS, EXCEPCIONES, etapaLabel,
  diasEnTaller, diasEnEtapa, estado, proximaAccion, patenteLegible,
  pendiente, total, fmtMonto, fmtFecha,
  RUBROS, ESTADOS_FACTURACION, estadoFacturacion,
  DOCUMENTOS_ENTREGA, TIPO_ARCHIVO,
} from '../../lib/taller'

function Panel({ legend, children }) {
  return (
    <section className="t-panel">
      {legend && <p className="t-legend">{legend}</p>}
      {children}
    </section>
  )
}

function Dato({ k, v }) {
  return <div className="t-kv"><dt>{k}</dt><dd>{v || '—'}</dd></div>
}

/** La cadena completa, con la etapa actual marcada en naranja. */
function Cadena({ etapa }) {
  const i = ETAPAS.findIndex(e => e.id === etapa)
  return (
    <div className="t-cadena">
      {ETAPAS_ACTIVAS.map((e, idx) => (
        <div key={e.id} className={`t-paso${idx < i ? ' hecho' : ''}${idx === i ? ' actual' : ''}`}>
          <div className="t-paso-bar" />
          <div className="t-paso-l">{e.label.toUpperCase()}</div>
        </div>
      ))}
    </div>
  )
}

export default function Ficha() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tienePermiso, tallerEtapas } = useAuth()

  const [v,        setV]        = useState(null)
  const [eventos,  setEventos]  = useState([])
  const [archivos, setArchivos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nota,     setNota]     = useState('')
  const [accion,   setAccion]   = useState(false)
  const [fEntrega, setFEntrega] = useState('')
  const [error,    setError]    = useState(null)
  // Número de factura en edición, por rubro. Se rellena con lo guardado.
  const [facturas, setFacturas] = useState({})
  const [subiendo, setSubiendo] = useState(null)

  const verMontos     = tienePermiso('taller.montos')
  const puedeValidar  = tienePermiso('taller.validar')
  const puedeTrabajar = tienePermiso('taller.trabajar')
  const puedeCargar   = tienePermiso('taller.cargar')
  const puedeAnular   = tienePermiso('taller.eliminar')
  // El permiso solo no alcanza: hay que tener cargadas las etapas del oficio.
  // Quien no las tiene veía el botón y recién al tocarlo le saltaba el error.
  const sinEtapas     = puedeTrabajar && tallerEtapas.length === 0

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    setCargando(true)
    const [{ data: veh }, { data: monto }, { data: evs }, { data: arch }] = await Promise.all([
      supabase.from('vehiculo').select('*').eq('id', id).single(),
      supabase.from('vehiculo_monto').select('*').eq('vehiculo_id', id).maybeSingle(),
      supabase.from('vehiculo_evento').select('*').eq('vehiculo_id', id).order('created_at', { ascending: false }),
      // El autor NO se puede traer con un join embebido: autor_id apunta a
      // auth.users, no a profile, y PostgREST no encuentra la relación. Se
      // busca aparte, más abajo.
      supabase.from('vehiculo_archivo').select('*').eq('vehiculo_id', id).order('created_at'),
    ])
    // Sin permiso taller.montos la consulta vuelve vacía y la ficha no muestra precios.
    setV(veh ? { ...veh, ...(monto || {}) } : null)
    setEventos(evs || [])
    setFEntrega(veh?.fecha_entrega || new Date().toISOString().slice(0, 10))
    setFacturas(Object.fromEntries(RUBROS.map(r => [r.id, monto?.[r.factura] || ''])))

    if (arch?.length) {
      // Quién subió cada papel. La policy profile_empresa deja leer el perfil
      // de los compañeros de empresa; si alguno no se encuentra, se muestra
      // igual el documento sin el nombre.
      const autores = [...new Set(arch.flatMap(a => [a.autor_id, a.anulado_por]).filter(Boolean))]
      let porId = {}
      if (autores.length) {
        const { data: perfiles } = await supabase
          .from('profile').select('id, nombre, apellido').in('id', autores)
        porId = Object.fromEntries((perfiles || []).map(p => [p.id, p]))
      }

      const firmados = await Promise.all(arch.map(async a => {
        const { data } = await supabase.storage.from('taller').createSignedUrl(a.path, 3600)
        return { ...a, url: data?.signedUrl || null,
                 autor: porId[a.autor_id] || null,
                 anuladoPor: porId[a.anulado_por] || null }
      }))
      setArchivos(firmados)
    } else {
      setArchivos([])
    }
    setCargando(false)
  }

  /**
   * Todo el flujo pasa por funciones del servidor, que validan permiso, etapa y
   * transición. Si rechazan, el mensaje viene de la base y se muestra tal cual.
   */
  async function llamar(fn, args) {
    setAccion(true)
    setError(null)
    const { error: err } = await supabase.rpc(fn, args)
    if (err) setError(err.message.replace(/^.*?:\s*/, ''))
    await cargar()
    setAccion(false)
    return !err
  }

  const marcarHecho    = () => llamar('taller_marcar_trabajo_hecho', { p_vehiculo: id })
  const validarAvance  = () => llamar('taller_validar_avance', { p_vehiculo: id })
  const toggleCobro    = (campo) =>
    llamar('taller_registrar_cobro', { p_vehiculo: id, p_campo: campo, p_valor: !v[campo] })

  /**
   * Facturar es manual y a mano: no se dispara solo desde los tildes de cobro
   * ni al entregar el auto. Es una decisión tomada para esta prueba.
   */
  const marcarFacturacion = (rubro, nuevoEstado) =>
    llamar('taller_registrar_facturacion', {
      p_vehiculo: id,
      p_rubro:    rubro.id,
      p_estado:   nuevoEstado,
      p_factura:  nuevoEstado === 'facturado' ? (facturas[rubro.id] || null) : null,
    })
  const toggleExcepcion = (exId) =>
    llamar('taller_cambiar_excepcion', { p_vehiculo: id, p_excepcion: v.excepcion === exId ? null : exId })

  async function entregar() {
    if (await llamar('taller_entregar', { p_vehiculo: id, p_fecha: fEntrega })) navigate('/taller')
  }

  /** Lo único que el navegador escribe directo en la bitácora. El autor lo pone la base. */
  async function agregarNota() {
    if (!nota.trim()) return
    setAccion(true)
    setError(null)
    const { error: err } = await supabase.from('vehiculo_evento')
      .insert({ vehiculo_id: id, tipo: 'nota', texto: nota.trim(), etapa: v.etapa })
    if (err) setError(err.message)
    else setNota('')
    await cargar()
    setAccion(false)
  }

  /**
   * Papeles que llegan después de la entrega: orden firmada, recibo, factura.
   *
   * Van al mismo bucket y con el mismo formato de ruta, porque la policy
   * reconoce el tipo por el nombre del archivo. Solo escribe en
   * vehiculo_archivo: no toca el vehículo, así que no lo reactiva ni le
   * devuelve los importes al tablero.
   */
  async function adjuntar(tipo, file) {
    if (!file) return
    setSubiendo(tipo)
    setError(null)
    const ext  = file.name.split('.').pop()
    const path = `${v.empresa_id}/${id}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`

    const { error: upErr } = await supabase.storage.from('taller').upload(path, file)
    if (upErr) {
      setError('No se pudo subir el archivo: ' + upErr.message)
      setSubiendo(null)
      return
    }
    // El autor y la fecha los pone la base.
    const { error: insErr } = await supabase.from('vehiculo_archivo')
      .insert({ vehiculo_id: id, tipo, path, nombre: file.name })
    if (insErr) setError(insErr.message)

    await cargar()
    setSubiendo(null)
  }

  /**
   * Anular no es borrar: el archivo queda en el bucket, la fila queda en la
   * tabla y el movimiento queda en la bitácora. Solo deja de contar como
   * documento válido de la ficha, con el motivo y el responsable escritos.
   */
  async function anular(archivo) {
    const motivo = window.prompt(
      `¿Por qué se anula "${archivo.nombre || TIPO_ARCHIVO[archivo.tipo]}"?\n\n` +
      'El archivo no se borra: queda guardado con el motivo y tu nombre.')
    if (motivo === null) return
    if (!motivo.trim()) return setError('Hace falta decir por qué se anula')
    await llamar('taller_anular_archivo', { p_archivo: archivo.id, p_motivo: motivo.trim() })
  }

  if (cargando) return <main className="t-page"><p className="t-eyebrow">CARGANDO FICHA…</p></main>
  if (!v)       return <main className="t-page"><p className="t-eyebrow">NO SE ENCONTRÓ EL VEHÍCULO</p></main>

  const e         = estado(v)
  const a         = proximaAccion(v)
  const entregado = v.etapa === 'entregado'
  const terminado = v.etapa === 'terminado'
  const fotos     = archivos.filter(x => x.tipo.startsWith('foto'))
  // Todo lo que no es foto se lista como documento: órdenes, recibos, facturas.
  const pdfs      = archivos.filter(x => !x.tipo.startsWith('foto'))

  return (
    <main className="t-page">
      {/* Un entregado no está en la pizarra: se llegó desde el archivo. */}
      <button className="t-eyebrow" style={{ cursor: 'pointer' }}
              onClick={() => navigate(entregado ? '/taller/entregados' : '/taller')}>
        {entregado ? '← VOLVER AL ARCHIVO' : '← VOLVER A LA PIZARRA'}
      </button>

      <div className="t-head" style={{ marginTop: 8 }}>
        <div>
          <h1 className="t-h1" style={{ fontFamily: 'var(--t-mono)', fontSize: 30 }}>
            {patenteLegible(v.patente)}
          </h1>
          <p className="t-sub">{v.vehiculo} · {v.cliente_nombre} · {v.compania}</p>
        </div>
        <p className="t-live">
          <span className="t-dot" style={{ background: 'var(--t-' + (e.s === 'ok' ? 'ink-3' : e.s) + ')' }} />
          {e.tag}
        </p>
      </div>

      <Cadena etapa={v.etapa} />

      {error && <p className="t-error" style={{ marginTop: 16 }}>{error}</p>}

      {!entregado && (
        <div className={`t-accion${a.bloqueado ? ' bloq' : ''}`} style={{ marginTop: 16 }}>
          <div className="t-accion-l">PRÓXIMA ACCIÓN · {diasEnEtapa(v)} DÍAS EN {etapaLabel(v.etapa).toUpperCase()}</div>
          <div className="t-accion-t">{a.titulo}</div>
          <div className="t-accion-d">{a.detalle}</div>

          <div className="t-acciones">
            {puedeTrabajar && !v.trabajo_hecho && !terminado && !v.excepcion && (
              sinEtapas
                ? <p className="t-aviso" style={{ flex: 1 }}>
                    Todavía no tenés etapas habilitadas, así que no podés marcar trabajo.
                    Quien administra el taller tiene que configurar tu oficio en ADMIN.
                  </p>
                : <button className="t-btn fantasma" onClick={marcarHecho} disabled={accion}
                          style={{ background: '#fff' }}>
                    Marcar mi trabajo
                  </button>
            )}
            {puedeValidar && !terminado && !v.excepcion && (
              <button className="t-btn urgente" onClick={validarAvance} disabled={accion}>
                Validar y avanzar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Un auto entregado no puede entrar en mecánica ni quedar detenido:
          el panel quedaba visible con los botones muertos y un texto que decía
          que "retoma en Entregado". */}
      {!entregado && (
      <Panel legend="ESTADOS EN PARALELO">
        <div className="t-fila">
          {EXCEPCIONES.map(x => (
            <button key={x.id}
                    className={`t-btn fantasma${v.excepcion === x.id ? ' urgente' : ''}`}
                    style={{ flex: 1, fontSize: 13, padding: '9px 6px',
                             color: v.excepcion === x.id ? '#f2efe9' : undefined }}
                    disabled={accion || entregado || !puedeValidar}
                    onClick={() => toggleExcepcion(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="t-aviso" style={{ marginTop: 10 }}>
          {puedeValidar
            ? `No sacan el vehículo de su etapa. Al levantarlos, retoma en ${etapaLabel(v.etapa)}.`
            : 'Frenar o liberar un vehículo lo decide quien coordina. Si hay algo que lo traba, dejalo anotado en el reporte diario.'}
        </p>
      </Panel>
      )}

      {verMontos && (
        <Panel legend="FACTURACIÓN">
          <p className="t-aviso" style={{ marginBottom: 14 }}>
            Mientras un rubro esté pendiente, su importe suma en los totales de la
            pizarra. Se puede facturar antes de entregar el auto.
          </p>

          {RUBROS.map(r => {
            const est = estadoFacturacion(v, r)
            return (
              <div key={r.id} className="t-rubro">
                <div className="t-rubro-head">
                  <span className="t-rubro-n">{r.label}</span>
                  <span className="t-rubro-m">{fmtMonto(v[r.monto])}</span>
                </div>

                <div className="t-opciones tres">
                  {ESTADOS_FACTURACION.map(e => (
                    <button key={e.id}
                            className={`t-estado${est === e.id ? ' elegido' : ''}`}
                            disabled={accion || est === e.id}
                            onClick={() => marcarFacturacion(r, e.id)}>
                      {e.label}
                    </button>
                  ))}
                </div>

                {est === 'facturado' && (
                  <div className="t-fila" style={{ marginTop: 8 }}>
                    <input className="t-input mono" placeholder="N° de factura"
                           value={facturas[r.id] || ''}
                           onChange={ev => setFacturas(p => ({ ...p, [r.id]: ev.target.value }))} />
                    <button className="t-btn fantasma" disabled={accion}
                            onClick={() => marcarFacturacion(r, 'facturado')}>
                      Guardar N°
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </Panel>
      )}

      {verMontos && (
        <Panel legend="COBRO">
          {/* Cobrar es otra cosa que facturar y sigue funcionando como antes:
              marcar una no marca la otra. */}
          {RUBROS.map(r => (
            <button key={r.cobro}
                    className={`t-toggle${v[r.cobro] ? ' si' : ''}`}
                    disabled={accion || entregado}
                    onClick={() => toggleCobro(r.cobro)}>
              <span>
                <span className="t-toggle-t">Cobro · {r.label}</span>
                <span className="t-toggle-m" style={{ display: 'block' }}>
                  {Number(v[r.monto]) ? fmtMonto(v[r.monto]) : 'Sin importe'}
                </span>
              </span>
              <span className="t-toggle-i">{v[r.cobro] ? '✓' : '○'}</span>
            </button>
          ))}

          <div className="t-kv" style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>
            <dt style={{ color: 'var(--t-ink-2)' }}>Pendiente de cobro</dt>
            <dd style={{ fontSize: 14 }}>{fmtMonto(pendiente(v))}</dd>
          </div>

          {terminado && puedeValidar && (
            <div className="t-acciones">
              <input type="date" className="t-input" style={{ width: 'auto' }}
                     value={fEntrega} onChange={ev => setFEntrega(ev.target.value)} />
              <button className="t-btn" onClick={entregar} disabled={accion}>
                Entregar vehículo
              </button>
            </div>
          )}
        </Panel>
      )}

      <Panel legend="DATOS DEL CASO">
        <dl>
          <Dato k="Teléfono del cliente" v={v.telefono
            ? <a className="t-tel" href={`tel:${v.telefono.replace(/[^\d+]/g, '')}`}>{v.telefono}</a>
            : null} />
          <Dato k="N° de siniestro" v={v.nro_siniestro} />
          <Dato k="Productor"       v={v.productor} />
          <Dato k="Perito"          v={v.perito} />
          <Dato k="Kilometraje"     v={v.kilometraje ? `${Number(v.kilometraje).toLocaleString('es-AR')} km` : null} />
          {/* Trabajo asignado al ingreso. No se recalcula con el tiempo ni
              tiene que ver con la fecha pactada, que va más abajo. */}
          <Dato k="Paños asignados" v={v.panos} />
          <Dato k="Días de chapa"   v={v.dias_chapa} />
          <Dato k="Ingreso"         v={fmtFecha(v.fecha_ingreso)} />
          <Dato k="Fecha pactada"   v={fmtFecha(v.fecha_pactada)} />
          <Dato k="En taller"       v={`${diasEnTaller(v)} días`} />
          {v.fecha_entrega && <Dato k="Entregado" v={fmtFecha(v.fecha_entrega)} />}
          {verMontos && <Dato k="Total a facturar" v={fmtMonto(total(v))} />}
        </dl>
      </Panel>

      {(fotos.length > 0 || pdfs.length > 0 || entregado) && (
        <Panel legend="RESPALDO">
          {fotos.length > 0 && (
            <div className="t-fotos" style={{ marginBottom: pdfs.length ? 14 : 0 }}>
              {fotos.map(x => (
                <a key={x.id} className="t-foto" href={x.url} target="_blank" rel="noreferrer">
                  {x.url && <img src={x.url} alt="Estado del vehículo" />}
                </a>
              ))}
            </div>
          )}

          {pdfs.map(x => (
            <div key={x.id} className={`t-doc${x.anulado_en ? ' anulado' : ''}`}>
              <a href={x.url} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'inherit' }}>
                <span style={{ display: 'block' }}>{TIPO_ARCHIVO[x.tipo] || x.tipo}</span>
                <span className="t-doc-m">
                  {x.autor ? `${x.autor.nombre}${x.autor.apellido ? ' ' + x.autor.apellido : ''} · ` : ''}
                  {new Date(x.created_at).toLocaleDateString('es-AR',
                    { day: '2-digit', month: '2-digit', year: '2-digit' })}
                </span>
                {x.anulado_en && (
                  <span className="t-doc-anulado">
                    ANULADO · {x.anulado_motivo}
                    {x.anuladoPor ? ` · ${x.anuladoPor.nombre}` : ''}
                    {' · '}
                    {new Date(x.anulado_en).toLocaleDateString('es-AR',
                      { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </span>
                )}
              </a>
              {puedeAnular && !x.anulado_en && (
                <button className="t-anular" onClick={() => anular(x)} disabled={accion}>
                  Anular
                </button>
              )}
            </div>
          ))}

          {/* Los papeles que llegan después de entregar. Agregar uno no
              reactiva el vehículo: sigue entregado y fuera de los totales. */}
          {entregado && puedeCargar && (
            <>
              <p className="t-aviso" style={{ marginTop: 14 }}>
                Sumar un documento no reactiva el vehículo ni devuelve sus importes al tablero.
              </p>
              <div className="t-grid" style={{ marginTop: 10 }}>
                {DOCUMENTOS_ENTREGA
                  .filter(d => !d.economico || verMontos)
                  .map(d => (
                    <label key={d.id} className="t-drop" style={{ margin: 0 }}>
                      {subiendo === d.id ? 'Subiendo…' : `Agregar ${d.label.toLowerCase()}`}
                      <input type="file" hidden
                             accept={d.id === 'foto_entrega' ? 'image/*' : 'application/pdf,image/*'}
                             disabled={subiendo !== null}
                             onChange={ev => {
                               adjuntar(d.id, ev.target.files?.[0])
                               ev.target.value = ''
                             }} />
                    </label>
                  ))}
              </div>
            </>
          )}
        </Panel>
      )}

      <Panel legend="REPORTE DIARIO">
        <div className="t-fila" style={{ marginBottom: 14 }}>
          <input className="t-input" value={nota} onChange={ev => setNota(ev.target.value)}
                 onKeyDown={ev => { if (ev.key === 'Enter') agregarNota() }}
                 placeholder="Qué pasó hoy con este auto…" />
          <button className="t-btn" onClick={agregarNota} disabled={accion || !nota.trim()}>
            Anotar
          </button>
        </div>

        {eventos.length === 0 ? (
          <p className="t-aviso">Todavía no hay movimientos registrados.</p>
        ) : (
          <div className="t-bitacora">
            {eventos.map(ev => (
              <div key={ev.id} className={`t-ev${ev.tipo === 'nota' ? ' nota' : ''}`}>
                <p className="t-ev-t">{ev.texto}</p>
                <p className="t-ev-m">
                  {new Date(ev.created_at).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                  {ev.etapa && ` · ${etapaLabel(ev.etapa).toUpperCase()}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </main>
  )
}
