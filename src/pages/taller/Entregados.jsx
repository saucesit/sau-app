import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { patenteLegible, fmtFecha, fmtMonto, total, aFecha } from '../../lib/taller'

/**
 * Archivo de vehículos entregados.
 *
 * Es una pantalla de CONSULTA: no mueve el flujo ni toca montos. Existe porque
 * la pizarra muestra solo lo que está adentro del taller, y a Forani le pasa
 * que una compañía le pregunta por un trabajo de hace dos años. Desde acá se
 * busca la patente y se abre la misma ficha de siempre, con sus fotos, sus
 * órdenes firmadas y su bitácora completa.
 *
 * Lo que NO está todavía, a propósito: marcar como facturado. Facturado y
 * cobrado son cosas distintas en un taller (se factura a la compañía y se
 * cobra a sesenta días) y reutilizar las validaciones de cobro para eso las
 * dejaría mintiendo. Falta la regla de Forani.
 */

const PAGINA = 40

/** PostgREST separa los filtros de `or` por coma: hay que sacarlas del término. */
function limpiar(t) {
  return t.replace(/[,()*\\]/g, ' ').trim()
}

function Fila({ v, verMontos, onAbrir }) {
  return (
    <button className="t-row" onClick={() => onAbrir(v.id)}>
      <span className="t-row-plate">{patenteLegible(v.patente)}</span>
      <span className="t-row-veh">{v.vehiculo}</span>
      <span className="t-row-cli">{v.cliente_nombre}</span>
      <span className="t-row-cia">{v.compania}</span>
      <span className="t-row-fec">{fmtFecha(v.fecha_entrega)}</span>
      {verMontos && <span className="t-row-tot">{fmtMonto(total(v))}</span>}
    </button>
  )
}

export default function Entregados() {
  const { empresaActivaId, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const verMontos = tienePermiso('taller.montos')

  const [filas,    setFilas]    = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [hayMas,   setHayMas]   = useState(false)
  const [error,    setError]    = useState(null)

  const buscar = useCallback(async (termino, desde = 0) => {
    if (!empresaActivaId) return
    setCargando(true)
    setError(null)

    let q = supabase
      .from('vehiculo')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .eq('etapa', 'entregado')

    const t = limpiar(termino)
    if (t) {
      // La patente se guarda normalizada (sin espacios, en mayúscula), así que
      // "af 350 pm" tiene que buscarse como AF350PM.
      const plano = t.replace(/[\s-]/g, '').toUpperCase()
      q = q.or(
        `patente.ilike.%${plano}%,` +
        `nro_siniestro.ilike.%${plano}%,` +
        `cliente_nombre.ilike.%${t}%,` +
        `vehiculo.ilike.%${t}%`,
      )
    }

    const { data, error: err } = await q
      .order('fecha_entrega', { ascending: false, nullsFirst: false })
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
    const t = setTimeout(() => buscar(busqueda, 0), busqueda ? 300 : 0)
    return () => clearTimeout(t)
  }, [busqueda, buscar])

  const abrir = (id) => navigate(`/taller/${id}`)

  // Agrupa por año para que un archivo largo siga siendo legible.
  const grupos = []
  filas.forEach(v => {
    const f = aFecha(v.fecha_entrega)
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
          <h1 className="t-h1">Vehículos entregados</h1>
          <p className="t-sub">
            Historial de consulta. No se mezcla con la pizarra de vehículos activos.
          </p>
        </div>
      </div>

      <div className="t-buscador">
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
            ? `No hay vehículos entregados que coincidan con "${busqueda}".`
            : 'Todavía no se entregó ningún vehículo. Cuando se entregue el primero, queda archivado acá.'}
        </p>
      ) : (
        <>
          <div className={`t-tabla${verMontos ? ' con-montos' : ''}`} style={{ marginTop: 18 }}>
            <div className="t-row cabecera" aria-hidden="true">
              <span>Patente</span>
              <span>Vehículo</span>
              <span>Cliente</span>
              <span>Compañía</span>
              <span>Entrega</span>
              {verMontos && <span>Total</span>}
            </div>

            {grupos.map(g => (
              <div key={g.anio} className="t-grupo">
                <p className="t-grupo-t">{g.anio}</p>
                {g.autos.map(v => (
                  <Fila key={v.id} v={v} verMontos={verMontos} onAbrir={abrir} />
                ))}
              </div>
            ))}
          </div>

          {hayMas && (
            <div className="t-acciones">
              <button className="t-btn fantasma" disabled={cargando}
                      onClick={() => buscar(busqueda, filas.length)}>
                {cargando ? 'Cargando…' : 'Ver más entregados'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}
