import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  patenteLegible, fmtFecha, fmtMonto, total, aFecha, facturacionCompleta,
  limpiarBusqueda, normalizarPatente, etapaLabel,
} from '../../lib/taller'

/**
 * Archivo de vehículos entregados.
 *
 * Es una pantalla de CONSULTA: no mueve el flujo ni toca montos. Existe porque
 * la pizarra muestra solo lo que está adentro del taller, y a Forani le pasa
 * que una compañía le pregunta por un trabajo de hace dos años. Desde acá se
 * busca la patente y se abre la misma ficha de siempre, con sus fotos, sus
 * órdenes firmadas y su bitácora completa.
 *
 * Lo que NO está todavía, a propósito: marcar como facturado. Ya está definido
 * que facturado y cobrado son dos cosas separadas —se factura a la compañía y
 * se cobra a sesenta días—, así que las validaciones de cobro no se reutilizan
 * para eso. Lo que falta definir es cómo se registra la facturación: si lleva
 * su propio tilde por rubro, fecha y número de factura, y quién la marca.
 */

const PAGINA = 40

/**
 * Las dos salidas del circuito, en la misma pantalla y en solapas separadas.
 *
 * Un anulado no es un entregado: no se terminó el trabajo, se canceló el
 * ingreso. Mezclarlos ensuciaría el archivo —que es lo que se le muestra a una
 * compañía cuando pregunta por un trabajo— y esconderlos los volvería
 * imposibles de auditar. Por eso van acá, aparte y con nombre propio.
 */
const VISTAS = [
  { id: 'entregados', label: 'Entregados', fecha: 'Entrega' },
  { id: 'anulados',   label: 'Anulados',   fecha: 'Anulado' },
]

function Fila({ v, vista, verMontos, onAbrir }) {
  const anulados = vista === 'anulados'
  return (
    <button className={`t-row${anulados ? ' anulada' : ''}`} onClick={() => onAbrir(v.id)}>
      <span className="t-row-plate">{patenteLegible(v.patente)}</span>
      <span className="t-row-veh">{v.vehiculo}</span>
      <span className="t-row-cli">{v.cliente_nombre}</span>
      {/* En anulados importa más en qué etapa quedó que de qué compañía era:
          dice si se canceló al ingresar o con el trabajo empezado. */}
      <span className="t-row-cia">
        {anulados ? etapaLabel(v.etapa) : v.compania}
      </span>
      <span className="t-row-fec">
        {fmtFecha(anulados ? v.anulado_en : v.fecha_entrega)}
      </span>
      {verMontos && <span className="t-row-tot">{fmtMonto(total(v))}</span>}
      {verMontos && (
        anulados
          ? <span className="t-row-fact">{v.anulado_motivo || '—'}</span>
          : <span className={`t-row-fact${facturacionCompleta(v) ? ' ok' : ''}`}>
              {facturacionCompleta(v) ? 'Facturado' : 'Pendiente'}
            </span>
      )}
    </button>
  )
}

export default function Entregados() {
  const { empresaActivaId, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const verMontos = tienePermiso('taller.montos')

  const [filas,    setFilas]    = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [vista,    setVista]    = useState('entregados')
  const [cargando, setCargando] = useState(true)
  const [hayMas,   setHayMas]   = useState(false)
  const [error,    setError]    = useState(null)
  // Cuántos anulados hay, para que la solapa lo diga sin tener que entrar.
  const [cuantosAnulados, setCuantosAnulados] = useState(0)

  const buscar = useCallback(async (termino, desde = 0, cual = 'entregados') => {
    if (!empresaActivaId) return
    setCargando(true)
    setError(null)

    let q = supabase
      .from('vehiculo')
      .select('*')
      .eq('empresa_id', empresaActivaId)

    // Un entregado anulado sigue anulado: la marca manda sobre la etapa, y por
    // eso cada solapa excluye explícitamente a la otra.
    q = cual === 'anulados'
      ? q.not('anulado_en', 'is', null)
      : q.eq('etapa', 'entregado').is('anulado_en', null)

    // Misma regla que la pizarra: limpiarBusqueda y normalizarPatente viven en
    // lib/taller.js y las usan las dos pantallas. Acá se arma el `or` del
    // servidor; allá se filtra en memoria con coincide(), que es su espejo.
    const t = limpiarBusqueda(termino)
    if (t) {
      const plano = normalizarPatente(t)
      q = q.or(
        `patente.ilike.%${plano}%,` +
        `nro_siniestro.ilike.%${plano}%,` +
        `cliente_nombre.ilike.%${t}%,` +
        `vehiculo.ilike.%${t}%`,
      )
    }

    const { data, error: err } = await q
      .order(cual === 'anulados' ? 'anulado_en' : 'fecha_entrega',
             { ascending: false, nullsFirst: false })
      .range(desde, desde + PAGINA - 1)

    if (err) {
      setError('No se pudo leer el archivo: ' + err.message)
      setCargando(false)
      return
    }

    const autos = data || []
    setHayMas(autos.length === PAGINA)

    // Los montos viven aparte y su policy exige taller.montos: sin permiso esto
    // vuelve vacío y la tabla sale sin la columna de plata.
    let conMontos = autos
    if (autos.length && verMontos) {
      const { data: montos } = await supabase
        .from('vehiculo_monto').select('*').in('vehiculo_id', autos.map(v => v.id))
      const porId = Object.fromEntries((montos || []).map(m => [m.vehiculo_id, m]))
      conMontos = autos.map(v => ({ ...v, ...(porId[v.id] || {}) }))
    }

    setFilas(prev => (desde === 0 ? conMontos : [...prev, ...conMontos]))
    setCargando(false)
  }, [empresaActivaId, verMontos])

  // Se espera a que deje de tipear: son patentes cortas y cada tecla es una consulta.
  useEffect(() => {
    const t = setTimeout(() => buscar(busqueda, 0, vista), busqueda ? 300 : 0)
    return () => clearTimeout(t)
  }, [busqueda, vista, buscar])

  // El contador de la solapa. Es una consulta de conteo, no trae filas.
  useEffect(() => {
    if (!empresaActivaId) return
    supabase.from('vehiculo')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaActivaId)
      .not('anulado_en', 'is', null)
      .then(({ count }) => setCuantosAnulados(count || 0))
  }, [empresaActivaId, filas])

  const abrir = (id) => navigate(`/taller/${id}`)

  const esAnulados = vista === 'anulados'

  // Agrupa por año para que un archivo largo siga siendo legible.
  const grupos = []
  filas.forEach(v => {
    const f = aFecha(esAnulados ? v.anulado_en : v.fecha_entrega)
    const anio = f ? f.getFullYear() : 'Sin fecha'
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.anio === anio) ultimo.autos.push(v)
    else grupos.push({ anio, autos: [v] })
  })

  return (
    <main className="t-main">
      <div className="t-head">
        <div>
          <p className="t-eyebrow">ARCHIVO DEL TALLER</p>
          <h1 className="t-h1">{esAnulados ? 'Ingresos anulados' : 'Vehículos entregados'}</h1>
          <p className="t-sub">
            {esAnulados
              ? 'Ingresos cargados por error y dados de baja. Conservan todo: archivos, bitácora, importes y facturación.'
              : 'Historial de consulta. No se mezcla con la pizarra de vehículos activos.'}
          </p>
        </div>
      </div>

      {/* Dos solapas, no un filtro escondido: un anulado no es un entregado y
          tiene que verse que son dos cosas distintas. */}
      <div className="t-opciones" style={{ marginTop: 14 }}>
        {VISTAS.map(x => (
          <button key={x.id} type="button"
                  className={`t-opcion${vista === x.id ? ' elegida' : ''}`}
                  onClick={() => { if (vista !== x.id) { setFilas([]); setVista(x.id) } }}>
            <span className="t-opcion-t">
              {x.label.toUpperCase()}
              {x.id === 'anulados' && cuantosAnulados > 0 && ` · ${cuantosAnulados}`}
            </span>
          </button>
        ))}
      </div>

      <div className="t-buscador" style={{ marginTop: 12 }}>
        <input
          className="t-input"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por patente, cliente, vehículo o N° de siniestro"
          autoComplete="off"
          inputMode="search"
        />
        {busqueda && (
          <button className="t-btn fantasma" onClick={() => setBusqueda('')}>Limpiar</button>
        )}
      </div>

      {error && <p className="t-error" style={{ marginTop: 14 }}>{error}</p>}

      {cargando && filas.length === 0 ? (
        <p className="t-eyebrow" style={{ marginTop: 20 }}>BUSCANDO…</p>
      ) : filas.length === 0 ? (
        <p className="t-aviso" style={{ marginTop: 18 }}>
          {busqueda
            ? `No hay ${esAnulados ? 'ingresos anulados' : 'vehículos entregados'} que coincidan con "${busqueda}".`
            : esAnulados
              ? 'No hay ningún ingreso anulado. Si alguna vez se carga un vehículo por error, se anula desde su ficha y aparece acá.'
              : 'Todavía no se entregó ningún vehículo. Cuando se entregue el primero, queda archivado acá.'}
        </p>
      ) : (
        <>
          <div className={`t-tabla${verMontos ? ' con-montos' : ''}`} style={{ marginTop: 18 }}>
            <div className="t-row cabecera" aria-hidden="true">
              <span>Patente</span>
              <span>Vehículo</span>
              <span>Cliente</span>
              <span>{esAnulados ? 'Etapa' : 'Compañía'}</span>
              <span>{esAnulados ? 'Anulado' : 'Entrega'}</span>
              {verMontos && <span>Total</span>}
              {verMontos && <span>{esAnulados ? 'Motivo' : 'Facturación'}</span>}
            </div>

            {grupos.map(g => (
              <div key={g.anio} className="t-grupo">
                <p className="t-grupo-t">{g.anio}</p>
                {g.autos.map(v => (
                  <Fila key={v.id} v={v} vista={vista} verMontos={verMontos} onAbrir={abrir} />
                ))}
              </div>
            ))}
          </div>

          {hayMas && (
            <div className="t-acciones">
              <button className="t-btn fantasma" disabled={cargando}
                      onClick={() => buscar(busqueda, filas.length, vista)}>
                {cargando ? 'Cargando…' : (esAnulados ? 'Ver más anulados' : 'Ver más entregados')}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}
