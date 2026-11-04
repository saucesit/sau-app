import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  ETAPAS_ACTIVAS, etapaLabel, excepcionCfg,
  diasEnTaller, estado, proximaAccion, patenteLegible, pendiente, fmtMonto, aFecha,
  RUBROS, totalesAFacturar, totalesOperativos, pendienteFacturar, coincide, fechaCorta,
} from '../../lib/taller'

/**
 * Cuántas novedades entran en el panel antes de que deje de ser un vistazo.
 * Las que sobran se cuentan al pie: el lugar para leerlas todas es la ficha.
 */
const TOPE_NOVEDADES = 10
import { useCelular } from '../../lib/useCelular'

/**
 * Las seis etapas siempre visibles, aunque estén vacías: es una pizarra, no una
 * lista. Con búsqueda activa tampoco desaparecen; lo que cambia es el contador,
 * que pasa a decir "01 DE 03" para que se entienda que está filtrada y no vacía.
 */
function Columna({ etapa, autos, total, filtrando, sel, onElegir, onAbrir }) {
  const dos = (n) => String(n).padStart(2, '0')
  return (
    <section className="t-col">
      <header className="t-col-head">
        <div className="t-col-n">{etapa.label}</div>
        <div className="t-col-c">
          {filtrando
            ? `${dos(autos.length)} DE ${dos(total)}`
            : `${dos(total)} ${total === 1 ? 'VEHÍCULO' : 'VEHÍCULOS'}`}
        </div>
      </header>
      <div className="t-col-body">
        {autos.length === 0
          ? <p className="t-vacia">{filtrando ? 'SIN COINCIDENCIAS' : 'SIN VEHÍCULOS'}</p>
          : autos.map(v => (
              <Tarjeta key={v.id} v={v} activa={sel === v.id}
                       onElegir={onElegir} onAbrir={onAbrir} />
            ))}
      </div>
    </section>
  )
}

/**
 * El campo de búsqueda. Filtra las tarjetas de la pizarra y nada más: los
 * contadores de arriba, los totales a facturar y la cola de decisiones siguen
 * describiendo el taller completo. Si una búsqueda bajara el KPI a "01 ACTIVO",
 * el tablero estaría mintiendo sobre el estado del negocio.
 */
function Buscador({ valor, onCambiar, encontrados, totalAutos }) {
  return (
    <div className="t-buscar">
      <div className="t-buscador">
        <input
          className="t-input"
          value={valor}
          onChange={e => onCambiar(e.target.value)}
          placeholder="Buscar por patente, cliente, vehículo o N° de siniestro"
          autoComplete="off"
          inputMode="search"
          aria-label="Buscar un vehículo en el taller"
        />
        {valor && (
          <button className="t-btn fantasma" onClick={() => onCambiar('')}>Limpiar</button>
        )}
      </div>
      {valor.trim() && (
        <p className="t-buscar-c">
          {encontrados === 0
            ? `Ningún vehículo activo coincide con "${valor.trim()}".`
            : `${encontrados} de ${totalAutos} vehículos`}
        </p>
      )}
    </div>
  )
}

/**
 * En escritorio un clic selecciona (llena el panel de la derecha, que es como
 * se barre la pizarra sin perder el contexto) y el doble clic abre la ficha.
 * En celular el panel queda apilado abajo, fuera de la vista: ahí seleccionar
 * no sirve para nada y el toque abre la ficha directo.
 */
function Tarjeta({ v, activa, conEtapa, onElegir, onAbrir }) {
  const e   = estado(v)
  const exc = excepcionCfg(v.excepcion)
  return (
    <button className={`t-card s-${e.s}`} aria-pressed={activa}
            onClick={() => onElegir(v.id)}
            onDoubleClick={() => onAbrir(v.id)}>
      {/* Fuera de la pizarra la tarjeta pierde su columna, así que la etapa
          tiene que decirla ella misma. */}
      {conEtapa && <div className="t-card-etapa">{etapaLabel(v.etapa).toUpperCase()}</div>}
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
  // Los comentarios del reporte diario de los vehículos que están adentro,
  // del más reciente al más viejo. Salen de la misma consulta que la última
  // nota de cada tarjeta.
  const [novedades, setNovedades] = useState([])
  const [cargando,  setCargando]  = useState(true)
  const [sel,       setSel]       = useState(null)
  const [busqueda,  setBusqueda]  = useState('')
  // Se calcula una sola vez al montar: leer el reloj en cada render es impuro.
  const [hoy] = useState(() =>
    new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))

  const verMontos = tienePermiso('taller.montos')
  const puedeAlta = tienePermiso('taller.cargar')
  const esCelular = useCelular()

  const abrirFicha = (id) => navigate(`/taller/${id}`)
  const elegir     = (id) => (esCelular ? abrirFicha(id) : setSel(id))

  async function cargar() {
    if (!empresaActivaId) return
    setCargando(true)

    // Las dos salidas del circuito. Un anulado no está en la pizarra ni suma
    // en los contadores de arriba: se consulta desde el archivo. Ver 0052.
    const { data } = await supabase
      .from('vehiculo')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .neq('etapa', 'entregado')
      .is('anulado_en', null)
      .order('fecha_ingreso', { ascending: true })

    const autos = data || []

    if (autos.length) {
      const ids = autos.map(v => v.id)

      // Los montos viven en otra tabla y su policy exige taller.montos:
      // sin permiso esto vuelve vacío y el tablero simplemente no los muestra.
      const { data: montos } = await supabase
        .from('vehiculo_monto').select('*').in('vehiculo_id', ids)
      const porId = Object.fromEntries((montos || []).map(m => [m.vehiculo_id, m]))

      // El reporte diario, una sola vez. De acá salen dos cosas: la última
      // observación de cada auto —que es lo que se lee de un vistazo en su
      // tarjeta— y la lista de novedades del panel de la derecha. Es la misma
      // fuente, no dos: las notas viven en vehiculo_evento con tipo 'nota' y
      // no hay ningún otro lugar donde se guarde un reporte.
      //
      // Ordenado por created_at, que además es el único orden posible: la
      // bitácora no tiene updated_at y no se puede editar —la RLS solo tiene
      // select e insert—, así que una corrección es una nota nueva.
      const { data: notas } = await supabase
        .from('vehiculo_evento')
        .select('id, vehiculo_id, texto, created_at, autor_id')
        .in('vehiculo_id', ids).eq('tipo', 'nota')
        .order('created_at', { ascending: false })

      const ultima = {}
      ;(notas || []).forEach(n => { if (!ultima[n.vehiculo_id]) ultima[n.vehiculo_id] = n.texto })

      // Quién escribió cada una. El autor no se puede traer con un join
      // embebido: autor_id apunta a auth.users y PostgREST no encuentra la
      // relación. Se buscan todos los perfiles de una, como en la ficha.
      // Las notas viejas de la importación no tienen autor y se muestran sin él.
      const autores = [...new Set((notas || []).map(n => n.autor_id).filter(Boolean))]
      let perfiles = {}
      if (autores.length) {
        const { data: ps } = await supabase
          .from('profile').select('id, nombre, apellido').in('id', autores)
        perfiles = Object.fromEntries((ps || []).map(p =>
          [p.id, [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || null]))
      }

      const porVehiculo = Object.fromEntries(autos.map(v => [v.id, v]))
      setNovedades((notas || []).map(n => ({
        id: n.id,
        vehiculo_id: n.vehiculo_id,
        texto: n.texto,
        cuando: n.created_at,
        autor: n.autor_id ? (perfiles[n.autor_id] || null) : null,
        patente: porVehiculo[n.vehiculo_id]?.patente || '',
        vehiculo: porVehiculo[n.vehiculo_id]?.vehiculo || '',
      })))

      setVehiculos(autos.map(v => ({ ...v, ...(porId[v.id] || {}), ultima_nota: ultima[v.id] || null })))
    } else {
      setVehiculos([])
      setNovedades([])
    }
    setCargando(false)
  }

  useEffect(() => { cargar() }, [empresaActivaId])

  // Filtra en memoria: la pizarra ya tiene todos los activos cargados, así que
  // buscar no necesita ni consulta ni espera. La regla la comparte con el
  // archivo de entregados (coincide, en lib/taller.js).
  const filtrando = busqueda.trim().length > 0
  const visibles  = useMemo(
    () => (filtrando ? vehiculos.filter(v => coincide(v, busqueda)) : vehiculos),
    [vehiculos, busqueda, filtrando])

  const agrupar = (lista) => {
    const m = Object.fromEntries(ETAPAS_ACTIVAS.map(e => [e.id, []]))
    lista.forEach(v => { if (m[v.etapa]) m[v.etapa].push(v) })
    return m
  }
  // Dos agrupaciones: lo que se muestra y el total de cada etapa, que es lo que
  // hace posible el "01 DE 03" del encabezado.
  const porEtapa      = useMemo(() => agrupar(visibles),  [visibles])
  const porEtapaTotal = useMemo(() => agrupar(vehiculos), [vehiculos])

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

  // Solo lo pendiente de facturar, y solo de lo que está adentro del taller.
  // `vehiculos` ya viene sin entregados; la función lo vuelve a filtrar para
  // que el total no dependa de cómo se cargó la lista.
  const aFacturar = useMemo(() => totalesAFacturar(vehiculos), [vehiculos])

  // Cuánto trabajo hay adentro, medido en paños y en días de chapa. Mismo
  // conjunto de autos que los totales de plata.
  const trabajo = useMemo(() => totalesOperativos(vehiculos), [vehiculos])

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

        {/* En celular va arriba de todo: si quedara debajo de los contadores
            habría que scrollear para buscar, que es justo lo que se quiere
            evitar. En escritorio entra junto al título de la pizarra. */}
        {esCelular && (
          <Buscador valor={busqueda} onCambiar={setBusqueda}
                    encontrados={visibles.length} totalAutos={vehiculos.length} />
        )}

        {/* Cinco contadores de la misma clase: cuántos autos hay, cuántos
            piden atención, y cuánto trabajo representan. Los paños y los días
            de chapa no son plata, así que los ve cualquiera que vea el taller
            —a diferencia de la fila de abajo—. */}
        <div className="t-kpis cinco">
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
          <div className="t-kpi">
            <div className="t-kpi-n">{String(trabajo.panos).padStart(2, '0')}</div>
            <div className="t-kpi-l">PAÑOS A PINTAR</div>
          </div>
          <div className="t-kpi">
            <div className="t-kpi-n">{String(trabajo.diasChapa).padStart(2, '0')}</div>
            <div className="t-kpi-l">DÍAS DE CHAPA</div>
          </div>
        </div>

        {/* La plata la ve solo quien tiene taller.montos. Sin ese permiso la
            base no devuelve los montos, pero igual no dibujamos la fila: si no,
            el operario ve tres carteles en cero y parece que el taller no cobra. */}
        {verMontos && (
          <div className="t-kpis plata cuatro">
            {RUBROS.map(r => (
              <div key={r.id} className="t-kpi">
                <div className="t-kpi-n money">{fmtMonto(aFacturar[r.id])}</div>
                <div className="t-kpi-l">A FACTURAR · {r.label.toUpperCase()}</div>
              </div>
            ))}
            {/* La suma de los tres de al lado, no otra cuenta: sale del mismo
                totalesAFacturar que los arma. */}
            <div className="t-kpi total">
              <div className="t-kpi-n money">{fmtMonto(aFacturar.total)}</div>
              <div className="t-kpi-l">TOTAL GENERAL</div>
            </div>
          </div>
        )}

        <div className="t-board-head">
          <h2 className="t-h2">{esCelular && filtrando ? 'Resultados' : 'Flujo de producción'}</h2>
          <p className="t-hint">UN CLIC MUESTRA LA PRÓXIMA ACCIÓN · DOBLE CLIC ABRE LA FICHA</p>
        </div>

        {!esCelular && (
          <Buscador valor={busqueda} onCambiar={setBusqueda}
                    encontrados={visibles.length} totalAutos={vehiculos.length} />
        )}

        {/* En celular la pizarra es un scroll horizontal de columnas angostas:
            con un filtro activo, el auto encontrado puede quedar tres columnas
            a la derecha y la pantalla mostrar "SIN COINCIDENCIAS". Mientras haya
            búsqueda se cambia por una lista plana, y cada tarjeta dice su etapa.
            Al limpiar vuelve la pizarra sola. */}
        {esCelular && filtrando ? (
          visibles.length === 0 ? (
            <p className="t-aviso" style={{ marginTop: 14 }}>
              Ningún vehículo activo coincide. Probá con parte de la patente, o
              buscá en los entregados si el auto ya salió del taller.
            </p>
          ) : (
            <div className="t-resultados">
              {visibles.map(v => (
                <Tarjeta key={v.id} v={v} activa={sel === v.id} conEtapa
                         onElegir={elegir} onAbrir={abrirFicha} />
              ))}
            </div>
          )
        ) : (
          <div className="t-board">
            {ETAPAS_ACTIVAS.map(e => (
              <Columna key={e.id} etapa={e}
                       autos={porEtapa[e.id]} total={porEtapaTotal[e.id].length}
                       filtrando={filtrando} sel={sel}
                       onElegir={elegir} onAbrir={abrirFicha} />
            ))}
          </div>
        )}
      </main>

      <aside className="t-side">
        {/* Lo último que se anotó en los reportes diarios, de todos los autos
            que están adentro. Es lo que permite entrar a la mañana y saber qué
            pasó ayer sin abrir ficha por ficha. Un toque abre la ficha: en esta
            lista no hay nada que seleccionar, se viene a leer y a ir. */}
        <p className="t-eyebrow">REPORTE DIARIO</p>
        <h2 className="t-side-h2">No pierdas de vista</h2>
        <div className="t-side-rule" />

        {novedades.length === 0 ? (
          <p className="t-sel-empty">
            Todavía no hay comentarios en los reportes de los vehículos que están
            en el taller. Se escriben desde la ficha de cada auto.
          </p>
        ) : (
          <>
            {novedades.slice(0, TOPE_NOVEDADES).map(n => (
              <button key={n.id} className="t-nov" onClick={() => abrirFicha(n.vehiculo_id)}>
                <div className="t-nov-head">
                  <span className="t-nov-plate">{patenteLegible(n.patente)}</span>
                  <span className="t-nov-cuando">{fechaCorta(n.cuando)}</span>
                </div>
                <p className="t-nov-texto">{n.texto}</p>
                <div className="t-nov-pie">
                  {n.vehiculo}
                  {n.autor ? ` · ${n.autor}` : ''}
                </div>
              </button>
            ))}
            {novedades.length > TOPE_NOVEDADES && (
              <p className="t-nov-mas">
                {novedades.length - TOPE_NOVEDADES} comentario
                {novedades.length - TOPE_NOVEDADES === 1 ? '' : 's'} más en las fichas
              </p>
            )}
          </>
        )}

        <p className="t-eyebrow" style={{ marginTop: 22 }}>COLA DE DECISIONES</p>
        <h2 className="t-side-h2">Vehículos demorados</h2>
        <div className="t-side-rule" />

        {cola.length === 0 ? (
          <p className="t-sel-empty">Ningún vehículo demorado ni por vencer. Todo en plazo.</p>
        ) : cola.map(v => {
          const e = estado(v)
          return (
            <button key={v.id} className="t-q" onClick={() => elegir(v.id)}
                    onDoubleClick={() => abrirFicha(v.id)}>
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
            <Seleccionado v={elegido} verMontos={verMontos} onAbrir={() => abrirFicha(elegido.id)} />
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
        {v.dias_chapa ? <div className="t-kv"><dt>Días de chapa</dt><dd>{v.dias_chapa}</dd></div> : null}
        <div className="t-kv"><dt>En taller</dt><dd>{diasEnTaller(v)} días</dd></div>
        <div className="t-kv">
          <dt>A facturar</dt>
          <dd>{verMontos
            ? fmtMonto(RUBROS.reduce((s, r) => s + pendienteFacturar(v, r), 0))
            : <span className="t-oculto">sin permiso</span>}</dd>
        </div>
        <div className="t-kv">
          <dt>Pendiente de cobro</dt>
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
