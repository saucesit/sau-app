import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  ETAPAS_ACTIVAS, etapaLabel, excepcionCfg,
  diasEnTaller, estado, proximaAccion, patenteLegible, pendiente, fmtMonto, aFecha,
} from '../../lib/taller'

/** Las seis etapas siempre visibles, aunque estén vacías: es una pizarra, no una lista. */
function Columna({ etapa, autos, sel, onElegir }) {
  return (
    <section className="t-col">
      <header className="t-col-head">
        <div className="t-col-n">{etapa.label}</div>
        <div className="t-col-c">
          {String(autos.length).padStart(2, '0')} {autos.length === 1 ? 'VEHÍCULO' : 'VEHÍCULOS'}
        </div>
      </header>
      <div className="t-col-body">
        {autos.length === 0
          ? <p className="t-vacia">SIN VEHÍCULOS</p>
          : autos.map(v => <Tarjeta key={v.id} v={v} activa={sel === v.id} onElegir={onElegir} />)}
      </div>
    </section>
  )
}

function Tarjeta({ v, activa, onElegir }) {
  const e   = estado(v)
  const exc = excepcionCfg(v.excepcion)
  return (
    <button className={`t-card s-${e.s}`} aria-pressed={activa} onClick={() => onElegir(v.id)}>
      <div className="t-plate">{patenteLegible(v.patente)}</div>
      <div className="t-who">{v.vehiculo} · {v.cliente_nombre}</div>
      <div className="t-meta">
        <span className="t-days">{diasEnTaller(v)}d</span>
        <span className={`t-tag s-${e.s}`}>{e.tag}</span>
      </div>
      {exc && <span className={`t-exc e-${exc.id}`}>{exc.label.toUpperCase()}</span>}
      {v.ultima_nota && <p className="t-nota">{v.ultima_nota}</p>}
    </button>
  )
}

export default function Tablero() {
  const { empresaActivaId, tienePermiso, empresaActiva } = useAuth()
  const navigate = useNavigate()

  const [vehiculos, setVehiculos] = useState([])
  const [cargando,  setCargando]  = useState(true)
  const [sel,       setSel]       = useState(null)
  // Se calcula una sola vez al montar: leer el reloj en cada render es impuro.
  const [hoy] = useState(() =>
    new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))

  const verMontos = tienePermiso('taller.montos')
  const puedeAlta = tienePermiso('taller.cargar')

  async function cargar() {
    if (!empresaActivaId) return
    setCargando(true)

    const { data } = await supabase
      .from('vehiculo')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .neq('etapa', 'entregado')
      .order('fecha_ingreso', { ascending: true })

    const autos = data || []

    if (autos.length) {
      const ids = autos.map(v => v.id)

      // Los montos viven en otra tabla y su policy exige taller.montos:
      // sin permiso esto vuelve vacío y el tablero simplemente no los muestra.
      const { data: montos } = await supabase
        .from('vehiculo_monto').select('*').in('vehiculo_id', ids)
      const porId = Object.fromEntries((montos || []).map(m => [m.vehiculo_id, m]))

      // Última observación del reporte diario, que es lo que de verdad se lee
      // de un vistazo para saber qué pasa con cada auto.
      const { data: notas } = await supabase
        .from('vehiculo_evento')
        .select('vehiculo_id, texto, created_at')
        .in('vehiculo_id', ids).eq('tipo', 'nota')
        .order('created_at', { ascending: false })
      const ultima = {}
      ;(notas || []).forEach(n => { if (!ultima[n.vehiculo_id]) ultima[n.vehiculo_id] = n.texto })

      setVehiculos(autos.map(v => ({ ...v, ...(porId[v.id] || {}), ultima_nota: ultima[v.id] || null })))
    } else {
      setVehiculos([])
    }
    setCargando(false)
  }

  useEffect(() => { cargar() }, [empresaActivaId])

  const porEtapa = useMemo(() => {
    const m = Object.fromEntries(ETAPAS_ACTIVAS.map(e => [e.id, []]))
    vehiculos.forEach(v => { if (m[v.etapa]) m[v.etapa].push(v) })
    return m
  }, [vehiculos])

  const cola = useMemo(() =>
    vehiculos
      .filter(v => estado(v).motivo)
      .sort((a, b) =>
        (estado(a).s === 'urgent' ? 0 : 1) - (estado(b).s === 'urgent' ? 0 : 1) ||
        diasEnTaller(b) - diasEnTaller(a)),
    [vehiculos])

  const urgentes = vehiculos.filter(v => estado(v).s === 'urgent').length
  const vencidos = vehiculos.filter(v => {
    const f = aFecha(v.fecha_pactada)
    return f && f.getTime() < Date.now()
  }).length

  const elegido = vehiculos.find(v => v.id === sel) || null

  if (cargando) {
    return <main className="t-main"><p className="t-eyebrow">CARGANDO PIZARRA…</p></main>
  }

  return (
    <>
      <main className="t-main">
        <div className="t-head">
          <div>
            <p className="t-eyebrow">
              {(empresaActiva?.nombre_fantasia || 'TALLER').toUpperCase()} · CHAPA Y PINTURA
            </p>
            <h1 className="t-h1">Control de taller</h1>
            <p className="t-sub">{vehiculos.length} vehículos en proceso · {hoy}</p>
          </div>
          {puedeAlta && (
            <button className="t-btn" onClick={() => navigate('/taller/nuevo')}>
              Ingresar vehículo
            </button>
          )}
        </div>

        <div className="t-kpis">
          <div className="t-kpi">
            <div className="t-kpi-n">{String(vehiculos.length).padStart(2, '0')}</div>
            <div className="t-kpi-l">ACTIVOS EN TALLER</div>
          </div>
          <div className="t-kpi alerta">
            <div className="t-kpi-n">{String(urgentes).padStart(2, '0')}</div>
            <div className="t-kpi-l">REQUIEREN ATENCIÓN</div>
          </div>
          <div className="t-kpi plazo">
            <div className="t-kpi-n">{String(vencidos).padStart(2, '0')}</div>
            <div className="t-kpi-l">FUERA DE PLAZO</div>
          </div>
        </div>

        <div className="t-board-head">
          <h2 className="t-h2">Flujo de producción</h2>
          <p className="t-hint">ELEGÍ UN VEHÍCULO PARA VER SU PRÓXIMA ACCIÓN</p>
        </div>

        <div className="t-board">
          {ETAPAS_ACTIVAS.map(e => (
            <Columna key={e.id} etapa={e} autos={porEtapa[e.id]} sel={sel} onElegir={setSel} />
          ))}
        </div>
      </main>

      <aside className="t-side">
        <p className="t-eyebrow">COLA DE DECISIONES</p>
        <h2 className="t-side-h2">No pierdas de vista</h2>
        <div className="t-side-rule" />

        {cola.length === 0 ? (
          <p className="t-sel-empty">Ningún vehículo demorado ni por vencer. Todo en plazo.</p>
        ) : cola.map(v => {
          const e = estado(v)
          return (
            <button key={v.id} className="t-q" onClick={() => setSel(v.id)}>
              <div className="t-q-plate">{patenteLegible(v.patente)}</div>
              <div className="t-q-sub">
                {v.vehiculo} · {v.excepcion ? excepcionCfg(v.excepcion).label : etapaLabel(v.etapa)}
              </div>
              <div className={`t-q-why s-${e.s}`}>{e.motivo.toUpperCase()}</div>
            </button>
          )
        })}

        <div className="t-sel">
          <p className="t-eyebrow">VEHÍCULO SELECCIONADO</p>
          {!elegido ? (
            <p className="t-sel-empty" style={{ marginTop: 8 }}>
              Elegí una orden de la pizarra o de la cola para ver qué hay que hacer con ella.
            </p>
          ) : (
            <Seleccionado v={elegido} verMontos={verMontos} onAbrir={() => navigate(`/taller/${elegido.id}`)} />
          )}
        </div>
      </aside>
    </>
  )
}

function Seleccionado({ v, verMontos, onAbrir }) {
  const a = proximaAccion(v)
  return (
    <>
      <div className="t-sel-plate" style={{ marginTop: 8 }}>{patenteLegible(v.patente)}</div>
      <div className="t-who">{v.vehiculo} · {v.cliente_nombre}</div>

      <dl style={{ marginTop: 12 }}>
        <div className="t-kv"><dt>Compañía</dt><dd>{v.compania}</dd></div>
        <div className="t-kv"><dt>Etapa</dt><dd>{etapaLabel(v.etapa)}</dd></div>
        {v.panos ? <div className="t-kv"><dt>Paños</dt><dd>{v.panos}</dd></div> : null}
        <div className="t-kv"><dt>En taller</dt><dd>{diasEnTaller(v)} días</dd></div>
        <div className="t-kv">
          <dt>Pendiente</dt>
          <dd>{verMontos ? fmtMonto(pendiente(v)) : <span className="t-oculto">sin permiso</span>}</dd>
        </div>
      </dl>

      <div className={`t-accion${a.bloqueado ? ' bloq' : ''}`}>
        <div className="t-accion-l">PRÓXIMA ACCIÓN</div>
        <div className="t-accion-t">{a.titulo}</div>
        <div className="t-accion-d">{a.detalle}</div>
      </div>

      <button className="t-btn bloque" style={{ marginTop: 10 }} onClick={onAbrir}>
        Abrir ficha
      </button>
    </>
  )
}
