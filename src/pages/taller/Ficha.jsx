import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  ETAPAS, ETAPAS_ACTIVAS, EXCEPCIONES, etapaLabel,
  diasEnTaller, diasEnEtapa, estado, proximaAccion, patenteLegible,
  pendiente, total, fmtMonto, fmtFecha,
  RUBROS, ESTADOS_FACTURACION, estadoFacturacion,
  DOCUMENTOS_FICHA, TIPO_ARCHIVO, tipoFoto, etapaPrevia, motivoCarga,
} from '../../lib/taller'

function Panel({ legend, accion, children }) {
  return (
    <section className="t-panel">
      {legend && (
        <div className="t-legend-fila">
          <p className="t-legend">{legend}</p>
          {accion}
        </div>
      )}
      {children}
    </section>
  )
}

/** Un campo del expediente en modo edición. */
function Campo({ k, campo, form, setForm, tipo = 'text', obligatorio, disabled, nota }) {
  return (
    <div className="t-kv editable">
      <dt>{k}{obligatorio && ' *'}</dt>
      <dd>
        <input className="t-input" type={tipo}
               value={form[campo] ?? ''}
               disabled={disabled}
               onChange={e => setForm(p => ({ ...p, [campo]: e.target.value }))} />
        {nota && <span className="t-campo-nota">{nota}</span>}
      </dd>
    </div>
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
  // Importe en edición, por rubro. Se rellena con lo guardado, igual que arriba.
  const [montos,   setMontos]   = useState({})
  // Modo edición del expediente, y el formulario mientras dura.
  const [editando, setEditando] = useState(false)
  const [form,     setForm]     = useState({})
  const [subiendo, setSubiendo] = useState(null)
  // Resultado de la última tanda de adjuntos: cuántos entraron y cuáles no.
  // Se muestra al lado de los botones de carga, que es donde está mirando
  // quien acaba de elegir cinco archivos.
  const [carga,    setCarga]    = useState(null)

  const verMontos     = tienePermiso('taller.montos')
  const puedeValidar  = tienePermiso('taller.validar')
  const puedeTrabajar = tienePermiso('taller.trabajar')
  const puedeCargar   = tienePermiso('taller.cargar')
  // Solo la foto del trabajo. El operario la tiene; no da documentos ni
  // habilita tocar el vehículo. Lo hace cumplir la base (migración 0043).
  const puedeFotos    = tienePermiso('taller.fotos')
  // Solo adjuntar documentos. El contador lo tiene; no da alta ni edición, y
  // los que llevan importes siguen pidiendo taller.montos (migración 0047).
  const puedeDocs     = tienePermiso('taller.documentos')
  const puedeAnular   = tienePermiso('taller.anular')
  // Reabrir un entregado devuelve un trabajo cerrado a la pizarra y sus
  // importes pendientes a los totales: va con empresa.admin, no con validar.
  const puedeAdministrar = tienePermiso('empresa.admin')
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
    setFEntrega(veh?.fecha_entrega || new Date().toISOString().slice(0, 10))
    setFacturas(Object.fromEntries(RUBROS.map(r => [r.id, monto?.[r.factura] || ''])))
    setMontos(Object.fromEntries(RUBROS.map(r => [r.id, String(monto?.[r.monto] ?? '')])))

    // Quién hizo cada cosa, en una sola consulta para los movimientos y los
    // papeles. La policy profile_empresa deja leer el perfil de los compañeros
    // de empresa; si alguno no se encuentra, se muestra igual sin el nombre.
    // Los movimientos viejos no tienen autor y se muestran sin él.
    const autores = [...new Set([
      ...(evs  || []).map(e => e.autor_id),
      ...(arch || []).flatMap(a => [a.autor_id, a.anulado_por]),
    ].filter(Boolean))]
    let porId = {}
    if (autores.length) {
      const { data: perfiles } = await supabase
        .from('profile').select('id, nombre, apellido').in('id', autores)
      porId = Object.fromEntries((perfiles || []).map(p => [p.id, p]))
    }

    setEventos((evs || []).map(e => ({ ...e, autor: porId[e.autor_id] || null })))

    if (arch?.length) {
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
  /**
   * Corregir un importe después del alta: Forani carga rápido, muchas veces en
   * cero, y completa cuando la compañía aprueba la orden.
   *
   * Cambiar el importe de un concepto ya facturado se permite —bloquearlo
   * empujaría a volverlo a pendiente y se perdería el número de factura— pero
   * se avisa antes, porque el papel emitido deja de coincidir. Ni el estado ni
   * el número se tocan: eso lo garantiza la función del servidor.
   */
  async function guardarMonto(rubro) {
    const crudo = montos[rubro.id]
    if (crudo === undefined || crudo === '') return
    const nuevo = Number(crudo)
    if (!Number.isFinite(nuevo) || nuevo < 0) {
      setError('El importe tiene que ser un número de cero para arriba.')
      return
    }
    if (nuevo === Number(v[rubro.monto] || 0)) return

    if (estadoFacturacion(v, rubro) === 'facturado' && !window.confirm(
      `${rubro.label} ya está facturado${v[rubro.factura] ? ` con la factura ${v[rubro.factura]}` : ''}.\n\n` +
      `Vas a cambiar el importe de ${fmtMonto(v[rubro.monto])} a ${fmtMonto(nuevo)}.\n` +
      'El estado y el número de factura quedan como están, y el cambio se registra ' +
      'en el reporte diario con tu nombre.\n\n¿Lo guardo igual?'
    )) return

    await llamar('taller_registrar_monto', {
      p_vehiculo: id, p_rubro: rubro.id, p_monto: nuevo,
    })
  }

  /* ── Editar el expediente ────────────────────────────────────────
   *
   * El alta es rápida y acá se completa: la asesora carga tres autos que
   * llegaron juntos y vuelve después con el siniestro, el perito y los paños.
   *
   * Los diez datos administrativos se guardan sin preguntar nada. Los tres que
   * sí preguntan son los que mueven algo más que su propio casillero: la
   * patente es la identidad del expediente, la fecha de ingreso decide la
   * antigüedad y las alertas de demora, y mover una fecha pactada que ya
   * existía es renegociar un plazo. Completar una vacía no pregunta: es
   * exactamente lo que queremos que haga.
   *
   * Quién puede es taller.cargar, el mismo permiso que da de alta. El servidor
   * registra cada cambio con su valor anterior (migración 0045).
   */
  const CAMPOS_EDITABLES = [
    'patente', 'vehiculo', 'kilometraje', 'cliente_nombre', 'telefono',
    'panos', 'dias_chapa', 'compania', 'productor', 'perito', 'nro_siniestro',
    'fecha_ingreso', 'fecha_pactada',
  ]

  function abrirEdicion() {
    setForm(Object.fromEntries(CAMPOS_EDITABLES.map(c => [c, v[c] ?? ''])))
    setError(null)
    setEditando(true)
  }

  async function guardarFicha() {
    const limpio = (x) => (typeof x === 'string' ? x.trim() : x)
    const obligatorios = {
      patente: 'la patente', vehiculo: 'el vehículo', cliente_nombre: 'el cliente',
      compania: 'la compañía', fecha_ingreso: 'la fecha de ingreso',
    }
    const faltan = Object.entries(obligatorios)
      .filter(([c]) => !limpio(form[c]))
      .map(([, label]) => label)
    if (faltan.length) {
      setError(`No puede quedar vacío: ${faltan.join(', ')}.`)
      return
    }

    // Solo se manda lo que cambió: así la bitácora no registra un cambio por
    // haber abierto el formulario, y los campos que no se tocan ni se rozan.
    const cambios = {}
    CAMPOS_EDITABLES.forEach(c => {
      const antes  = v[c] ?? ''
      const ahora  = limpio(form[c] ?? '')
      const nulos  = ['kilometraje', 'panos', 'dias_chapa', 'telefono',
                      'productor', 'perito', 'nro_siniestro', 'fecha_pactada']
      if (String(antes) === String(ahora)) return
      cambios[c] = ahora === '' && nulos.includes(c) ? null
                 : ['kilometraje', 'panos', 'dias_chapa'].includes(c) ? Number(ahora)
                 : ahora
    })

    if (Object.keys(cambios).length === 0) { setEditando(false); return }

    if ('patente' in cambios && !window.confirm(
      `Vas a cambiar la patente de ${patenteLegible(v.patente)} a ` +
      `${patenteLegible(String(cambios.patente).replace(/[^A-Za-z0-9]/g, '').toUpperCase())}.\n\n` +
      'Es con lo que se busca este vehículo en el taller. Las fotos y los ' +
      'documentos ya cargados siguen en esta misma ficha.\n\n¿Lo guardo?'
    )) return

    if ('fecha_ingreso' in cambios && !window.confirm(
      `Vas a cambiar la fecha de ingreso de ${fmtFecha(v.fecha_ingreso)} a ` +
      `${fmtFecha(cambios.fecha_ingreso)}.\n\n` +
      'Cambia cuántos días figura en taller, y con eso puede encenderse o ' +
      'apagarse la alerta de demora.\n\n¿Lo guardo?'
    )) return

    // Completar una fecha pactada vacía no pregunta. Cambiar una ya pactada, sí.
    if ('fecha_pactada' in cambios && v.fecha_pactada && !window.confirm(
      `Este vehículo ya tenía fecha pactada: ${fmtFecha(v.fecha_pactada)}.\n\n` +
      `La vas a cambiar a ${cambios.fecha_pactada ? fmtFecha(cambios.fecha_pactada) : 'sin fecha'}. ` +
      'Es el plazo comprometido y mueve el contador de vehículos fuera de plazo.' +
      '\n\n¿Lo guardo?'
    )) return

    setAccion(true)
    setError(null)
    const { error: err } = await supabase.from('vehiculo').update(cambios).eq('id', id)
    if (err) setError(err.message.replace(/^.*?:\s*/, ''))
    else setEditando(false)
    await cargar()
    setAccion(false)
  }

  /**
   * Volver una etapa atrás. Pasa por dos motivos y los dos son reales: se
   * apretó avanzar de más, o hay que rehacer un trabajo ya dado por terminado.
   *
   * El motivo es obligatorio porque el servidor lo exige, y porque alguien va a
   * querer saber el mes que viene por qué este auto volvió de Pintura.
   */
  async function retroceder() {
    const destino = etapaLabel(etapaAnterior)
    const motivo = window.prompt(
      `Volver ${patenteLegible(v.patente)} de ${etapaLabel(v.etapa)} a ${destino}.\n\n` +
      '¿Por qué vuelve? Queda en el reporte diario con tu nombre.\n' +
      'El avance anterior no se borra: queda el ida y el vuelta.'
    )
    if (motivo === null) return
    if (!motivo.trim()) { setError('Hace falta un motivo para volver de etapa.'); return }
    await llamar('taller_retroceder_etapa', { p_vehiculo: id, p_motivo: motivo.trim() })
  }

  /** Sacar un entregado del archivo y devolverlo al taller. */
  async function reabrir() {
    const motivo = window.prompt(
      `Reabrir ${patenteLegible(v.patente)}, entregado el ${fmtFecha(v.fecha_entrega)}.\n\n` +
      'Vuelve a la pizarra en Control de Calidad y se le borra la fecha de entrega. ' +
      'La facturación, los cobros y los adjuntos quedan como están.\n\n' +
      '¿Por qué vuelve al taller?'
    )
    if (motivo === null) return
    if (!motivo.trim()) { setError('Hace falta un motivo para reabrir el vehículo.'); return }
    await llamar('taller_reabrir_vehiculo', { p_vehiculo: id, p_motivo: motivo.trim() })
  }

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
   * Suma archivos a la ficha, en cualquier etapa y también después de entregar.
   *
   * Van al mismo bucket y con el mismo formato de ruta, porque la policy
   * reconoce el tipo por el nombre del archivo. Solo escribe en
   * vehiculo_archivo: no toca el vehículo, así que no lo hace avanzar ni —si ya
   * está entregado— lo reactiva.
   *
   * Acepta varios de una: las fotos se sacan de a tandas y las facturas llegan
   * en lotes. Un archivo que falla NO corta la tanda —los que vienen detrás no
   * tienen nada que ver con él— y al final se dice exactamente cuántos
   * entraron y cuáles no, con nombre y motivo.
   *
   * Lo que subió, queda subido. No hay deshacer del lote completo: cada
   * archivo es su propia fila, con su propio autor y su propia fecha, y
   * descartar filas buenas porque otra falló sería borrar trabajo hecho.
   */
  async function adjuntar(tipo, files) {
    const lista = Array.from(files || [])
    if (!lista.length) return
    setSubiendo(tipo)
    setError(null)
    setCarga(null)

    const subidos = []
    const fallas  = []

    for (const file of lista) {
      const ext  = file.name.split('.').pop()
      const path = `${v.empresa_id}/${id}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`

      const { error: upErr } = await supabase.storage.from('taller').upload(path, file)
      if (upErr) {
        fallas.push({ nombre: file.name, motivo: motivoCarga(upErr) })
        continue
      }
      // El autor y la fecha los pone la base.
      const { error: insErr } = await supabase.from('vehiculo_archivo')
        .insert({ vehiculo_id: id, tipo, path, nombre: file.name })
      if (insErr) {
        // El objeto quedó en el bucket sin fila que lo reclame. No se intenta
        // sacar: la ficha lista filas, no objetos, así que para el usuario no
        // existe —igual que un adjunto anulado, que también sigue en el
        // bucket a propósito.
        fallas.push({ nombre: file.name, motivo: motivoCarga(insErr) })
        continue
      }
      subidos.push(file.name)
    }

    setCarga({ tipo, total: lista.length, subidos, fallas })
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
  // La última etapa antes de entregar. Desde 0040 es Control de Calidad.
  const terminado = v.etapa === 'control_calidad'
  const fotos     = archivos.filter(x => x.tipo.startsWith('foto'))
  // Todo lo que no es foto se lista como documento: órdenes, recibos, facturas.
  const pdfs      = archivos.filter(x => !x.tipo.startsWith('foto'))
  // Qué clase de foto corresponde acá: de ingreso, del proceso o de la entrega.
  const tFoto     = tipoFoto(v.etapa)
  // La etapa de la que viene, para poder volver. null en Recepción y en un
  // entregado, que se reabre en vez de retroceder.
  const etapaAnterior = entregado ? null : etapaPrevia(v.etapa)
  // Quien solo tiene taller.fotos sube la foto del trabajo y nada más: ni
  // documentos, ni la foto de recepción, ni la de la entrega. Mostrarle un
  // botón que la base va a rechazar sería peor que no mostrarlo.
  const subeFoto  = puedeCargar || (puedeFotos && tFoto === 'foto_proceso')
  // Los documentos los sube quien carga o quien tiene el permiso específico.
  // La lista de tipos la sigue filtrando verMontos, como siempre.
  const subeDocs  = puedeCargar || puedeDocs

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
            {/* Volver atrás: por un clic de más, o porque hay que rehacer un
                trabajo. Una etapa por vez, nunca desde Recepción. */}
            {puedeValidar && etapaAnterior && (
              <button className="t-btn fantasma" onClick={retroceder} disabled={accion}>
                Volver a {etapaLabel(etapaAnterior)}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reabrir es otra cosa que retroceder: saca el auto del archivo, le
          borra la fecha de entrega y devuelve sus importes pendientes al
          tablero. Por eso lo hace quien administra el taller. */}
      {entregado && puedeAdministrar && (
        <div className="t-accion" style={{ marginTop: 16 }}>
          <div className="t-accion-l">ENTREGADO EL {fmtFecha(v.fecha_entrega)}</div>
          <div className="t-accion-t">Reabrir vehículo</div>
          <div className="t-accion-d">
            Vuelve al taller en Control de Calidad y sale del archivo. La
            facturación, los cobros y los adjuntos quedan como están.
          </div>
          <div className="t-acciones">
            <button className="t-btn fantasma" onClick={reabrir} disabled={accion}>
              Reabrir vehículo
            </button>
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

                {/* El importe se completa o se corrige acá: el alta deja de ser
                    la única oportunidad. El estado y el número de factura no
                    se tocan al cambiarlo. */}
                <div className="t-fila" style={{ marginBottom: 8 }}>
                  <input className="t-input mono" type="number" min="0" step="0.01"
                         placeholder="Importe"
                         value={montos[r.id] ?? ''}
                         disabled={accion}
                         onChange={ev => setMontos(p => ({ ...p, [r.id]: ev.target.value }))}
                         onKeyDown={ev => { if (ev.key === 'Enter') guardarMonto(r) }} />
                  <button className="t-btn fantasma" disabled={accion}
                          onClick={() => guardarMonto(r)}>
                    Guardar importe
                  </button>
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

      <Panel legend="DATOS DEL CASO"
             accion={puedeCargar && !editando && (
               <button className="t-btn fantasma chico" onClick={abrirEdicion} disabled={accion}>
                 Editar
               </button>
             )}>
        {!editando ? (
          <dl>
            <Dato k="Patente"        v={patenteLegible(v.patente)} />
            <Dato k="Vehículo"       v={v.vehiculo} />
            <Dato k="Cliente"        v={v.cliente_nombre} />
            <Dato k="Teléfono del cliente" v={v.telefono
              ? <a className="t-tel" href={`tel:${v.telefono.replace(/[^\d+]/g, '')}`}>{v.telefono}</a>
              : null} />
            <Dato k="Compañía"       v={v.compania} />
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
        ) : (
          <>
            <p className="t-aviso" style={{ marginBottom: 12 }}>
              Se guarda solo lo que cambies, y cada cambio queda en el reporte
              diario con tu nombre.
            </p>
            <dl>
              <Campo k="Patente"   campo="patente"        form={form} setForm={setForm} obligatorio />
              <Campo k="Vehículo"  campo="vehiculo"       form={form} setForm={setForm} obligatorio />
              <Campo k="Cliente"   campo="cliente_nombre" form={form} setForm={setForm} obligatorio />
              <Campo k="Teléfono del cliente" campo="telefono" form={form} setForm={setForm} tipo="tel" />
              <Campo k="Compañía"  campo="compania"       form={form} setForm={setForm} obligatorio />
              <Campo k="N° de siniestro" campo="nro_siniestro" form={form} setForm={setForm} />
              <Campo k="Productor" campo="productor"      form={form} setForm={setForm} />
              <Campo k="Perito"    campo="perito"         form={form} setForm={setForm} />
              <Campo k="Kilometraje" campo="kilometraje"  form={form} setForm={setForm} tipo="number" />
              <Campo k="Paños asignados" campo="panos"    form={form} setForm={setForm} tipo="number" />
              <Campo k="Días de chapa"   campo="dias_chapa" form={form} setForm={setForm} tipo="number" />
              {/* En un entregado la fecha de ingreso queda quieta: reescribiría
                  cuánto tardó un trabajo que ya está cerrado. */}
              <Campo k="Ingreso" campo="fecha_ingreso" form={form} setForm={setForm}
                     tipo="date" obligatorio disabled={entregado}
                     nota={entregado ? 'No se modifica en un vehículo entregado.' : null} />
              <Campo k="Fecha pactada" campo="fecha_pactada" form={form} setForm={setForm} tipo="date" />
            </dl>

            <div className="t-acciones" style={{ marginTop: 14 }}>
              <button className="t-btn" onClick={guardarFicha} disabled={accion}>
                {accion ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <button className="t-btn fantasma" disabled={accion}
                      onClick={() => { setEditando(false); setError(null) }}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </Panel>

      {(fotos.length > 0 || pdfs.length > 0 || subeFoto || subeDocs) && (
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
              <a href={x.url} target="_blank" rel="noreferrer"
                 style={{ flex: 1, minWidth: 0, color: 'inherit' }}>
                <span style={{ display: 'block' }}>{TIPO_ARCHIVO[x.tipo] || x.tipo}</span>
                {/* El nombre del archivo es lo único que distingue tres
                    facturas del mismo auto cargadas el mismo día. */}
                <span className="t-doc-m">
                  {x.nombre ? `${x.nombre} · ` : ''}
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

          {/* Sumar archivos no es exclusivo de la recepción ni de la entrega:
              las fotos y los papeles aparecen en cualquier momento. Agregar uno
              no mueve al vehículo, y en un entregado no lo reactiva. */}
          {(subeFoto || subeDocs) && (
            <>
              <p className="t-aviso" style={{ marginTop: 14 }}>
                {!subeFoto
                  ? 'Podés adjuntar documentación en cualquier momento, también después de entregar.'
                  : !subeDocs
                    ? 'Podés sumar fotos del trabajo. Los documentos los carga administración.'
                    : entregado
                      ? 'Sumar un documento no reactiva el vehículo ni devuelve sus importes al tablero.'
                      : 'Podés sumar fotos y papeles en cualquier etapa. No hace avanzar el vehículo.'}
              </p>
              <div className="t-grid" style={{ marginTop: 10 }}>
                {/* Las fotos van en un solo lugar y de a varias: la etapa decide
                    si son de ingreso, del proceso o de la entrega. */}
                {subeFoto && (
                  <label className="t-drop" style={{ margin: 0 }}>
                    {subiendo === tFoto ? 'Subiendo…' : `Agregar ${TIPO_ARCHIVO[tFoto].toLowerCase()}`}
                    <input type="file" hidden multiple accept="image/*"
                           disabled={subiendo !== null}
                           onChange={ev => {
                             adjuntar(tFoto, ev.target.files)
                             ev.target.value = ''
                           }} />
                  </label>
                )}

                {/* Los documentos también van de a varios: una orden puede
                    tener tres hojas escaneadas y la facturación llega en
                    lote. Cada archivo queda como su propia fila, con su
                    propio autor, y se anula por separado. */}
                {subeDocs && DOCUMENTOS_FICHA
                  .filter(d => !d.economico || verMontos)
                  .map(d => (
                    <label key={d.id} className="t-drop" style={{ margin: 0 }}>
                      {subiendo === d.id ? 'Subiendo…' : `Agregar ${d.label.toLowerCase()}`}
                      <input type="file" hidden multiple accept="application/pdf,image/*"
                             disabled={subiendo !== null}
                             onChange={ev => {
                               adjuntar(d.id, ev.target.files)
                               ev.target.value = ''
                             }} />
                    </label>
                  ))}
              </div>

              {/* Qué pasó con la última tanda. Si falló alguno, el aviso es
                  rojo y dice cuál: el riesgo real es elegir cinco archivos,
                  ver la pantalla volver a la normalidad y suponer que
                  entraron los cinco. */}
              {carga && (
                <div className={carga.fallas.length ? 't-error' : 't-aviso'}
                     style={{ marginTop: 12, marginBottom: 0 }}>
                  <strong style={{ fontWeight: 600 }}>
                    {carga.fallas.length === 0
                      ? carga.total === 1
                        ? '1 archivo cargado.'
                        : `${carga.total} archivos cargados.`
                      : carga.subidos.length === 0
                        ? carga.total === 1
                          ? 'No se pudo cargar el archivo.'
                          : `No se pudo cargar ninguno de los ${carga.total} archivos.`
                        : `Se cargaron ${carga.subidos.length} de ${carga.total} archivos.`}
                  </strong>
                  {carga.fallas.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {carga.fallas.map((f, i) => (
                        <li key={`${f.nombre}-${i}`} style={{ overflowWrap: 'anywhere' }}>
                          <strong style={{ fontWeight: 600 }}>{f.nombre}</strong>: {f.motivo}
                        </li>
                      ))}
                    </ul>
                  )}
                  {carga.fallas.length > 0 && carga.subidos.length > 0 && (
                    <p style={{ margin: '6px 0 0' }}>
                      Los demás quedaron cargados. Volvé a intentar solo con los que fallaron.
                    </p>
                  )}
                </div>
              )}
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
                  {ev.autor &&
                    `${ev.autor.nombre}${ev.autor.apellido ? ' ' + ev.autor.apellido : ''} · `}
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
