import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  ETAPAS, ETAPAS_ACTIVAS, EXCEPCIONES, etapaLabel, etapaSiguiente, excepcionCfg,
  diasEnTaller, diasEnEtapa, alertas, pendiente, total, fmtMonto, fmtFecha,
} from '../lib/taller'

function Panel({ titulo, children, className = '' }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {titulo && <h2 className="text-white font-extrabold text-base mb-3">{titulo}</h2>}
      {children}
    </div>
  )
}

function Dato({ k, v }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-zinc-800 last:border-0 text-sm">
      <span className="text-zinc-500">{k}</span>
      <span className="text-zinc-200 font-semibold text-right">{v || '—'}</span>
    </div>
  )
}

/** Barra de progreso de la cadena secuencial */
function Cadena({ etapa }) {
  const iActual = ETAPAS.findIndex(e => e.id === etapa)
  return (
    <div className="flex gap-1">
      {ETAPAS_ACTIVAS.map((e, i) => (
        <div key={e.id} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= iActual ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
          <p className={`text-[0.55rem] mt-1 text-center leading-tight ${
            i === iActual ? 'text-emerald-400 font-bold' : 'text-zinc-600'
          }`}>
            {e.label}
          </p>
        </div>
      ))}
    </div>
  )
}

export default function TallerVehiculo() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tienePermiso, user } = useAuth()

  const [v,        setV]        = useState(null)
  const [eventos,  setEventos]  = useState([])
  const [archivos, setArchivos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nota,     setNota]     = useState('')
  const [accion,   setAccion]   = useState(false)   // hay una acción en curso
  const [fEntrega, setFEntrega] = useState('')

  const verMontos  = tienePermiso('taller.montos')
  const puedeValidar  = tienePermiso('taller.validar')
  const puedeTrabajar = tienePermiso('taller.trabajar')

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    setCargando(true)
    const [{ data: veh }, { data: monto }, { data: evs }, { data: arch }] = await Promise.all([
      supabase.from('vehiculo').select('*').eq('id', id).single(),
      supabase.from('vehiculo_monto').select('*').eq('vehiculo_id', id).maybeSingle(),
      supabase.from('vehiculo_evento').select('*').eq('vehiculo_id', id).order('created_at', { ascending: false }),
      supabase.from('vehiculo_archivo').select('*').eq('vehiculo_id', id),
    ])
    // Sin permiso taller.montos la consulta devuelve null y la ficha no muestra precios.
    setV(veh ? { ...veh, ...(monto || {}) } : null)
    setEventos(evs || [])
    setFEntrega(veh?.fecha_entrega || new Date().toISOString().slice(0, 10))

    // Los archivos viven en un bucket privado: hay que firmar cada URL para poder verlos.
    if (arch?.length) {
      const firmados = await Promise.all(arch.map(async a => {
        const { data } = await supabase.storage.from('taller').createSignedUrl(a.path, 3600)
        return { ...a, url: data?.signedUrl || null }
      }))
      setArchivos(firmados)
    } else {
      setArchivos([])
    }
    setCargando(false)
  }

  async function registrar(tipo, texto, etapa) {
    await supabase.from('vehiculo_evento').insert({
      vehiculo_id: id, tipo, texto, etapa: etapa ?? v.etapa, autor_id: user?.id,
    })
  }

  /**
   * El operario marca lo suyo como hecho. No mueve el vehículo: queda esperando validación.
   * Va por RPC porque el operario no tiene permiso de UPDATE sobre vehiculo — la función
   * valida el permiso del lado del servidor y es lo único que puede tocar.
   */
  async function marcarHecho() {
    setAccion(true)
    const { error } = await supabase.rpc('taller_marcar_trabajo_hecho', { p_vehiculo: id })
    if (error) console.error('No se pudo marcar el trabajo:', error)
    await cargar()
    setAccion(false)
  }

  /** Validación de un rol habilitado: recién acá el vehículo avanza de etapa. */
  async function validarYAvanzar() {
    const sig = etapaSiguiente(v.etapa)
    if (!sig) return
    setAccion(true)
    await supabase.from('vehiculo').update({
      etapa: sig, etapa_desde: new Date().toISOString(),
      trabajo_hecho: false, updated_at: new Date().toISOString(),
    }).eq('id', id)
    await registrar('avance', `${etapaLabel(v.etapa)} validada — pasa a ${etapaLabel(sig)}`, sig)
    await cargar()
    setAccion(false)
  }

  /** La excepción es una etiqueta encima de la etapa: no la reemplaza ni la reinicia. */
  async function toggleExcepcion(exId) {
    setAccion(true)
    const activar = v.excepcion !== exId
    await supabase.from('vehiculo').update({
      excepcion:       activar ? exId : null,
      excepcion_desde: activar ? new Date().toISOString() : null,
      updated_at:      new Date().toISOString(),
    }).eq('id', id)
    const label = excepcionCfg(exId)?.label
    await registrar('excepcion', activar
      ? `Activado ${label} (sigue en ${etapaLabel(v.etapa)})`
      : `Levantado ${label} — retoma en ${etapaLabel(v.etapa)}`)
    await cargar()
    setAccion(false)
  }

  async function toggleCobro(campo, label) {
    setAccion(true)
    const nuevo = !v[campo]
    await supabase.from('vehiculo_monto')
      .update({ [campo]: nuevo, updated_at: new Date().toISOString() })
      .eq('vehiculo_id', id)
    await registrar('cobro', `${label}: ${nuevo ? 'validado' : 'desmarcado'}`)
    await cargar()
    setAccion(false)
  }

  async function entregar() {
    setAccion(true)
    await supabase.from('vehiculo').update({
      etapa: 'entregado', etapa_desde: new Date().toISOString(),
      fecha_entrega: fEntrega, updated_at: new Date().toISOString(),
    }).eq('id', id)
    await registrar('entrega', `Vehículo entregado al cliente`, 'entregado')
    navigate('/taller')
  }

  async function agregarNota() {
    if (!nota.trim()) return
    setAccion(true)
    await registrar('nota', nota.trim())
    setNota('')
    await cargar()
    setAccion(false)
  }

  if (cargando) return <p className="text-zinc-500 text-sm text-center py-10">Cargando…</p>
  if (!v)       return <p className="text-zinc-500 text-sm text-center py-10">No se encontró el vehículo</p>

  const als       = alertas(v)
  const exc       = excepcionCfg(v.excepcion)
  const siguiente = etapaSiguiente(v.etapa)
  const enTerminado = v.etapa === 'terminado'
  const entregado   = v.etapa === 'entregado'
  const fotos = archivos.filter(a => a.tipo.startsWith('foto'))
  const pdfs  = archivos.filter(a => a.tipo.startsWith('orden'))

  return (
    <div className="space-y-3 pb-4">

      {/* Encabezado */}
      <Panel>
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <p className="text-2xl font-extrabold text-white tracking-wide leading-none">{v.patente}</p>
            <p className="text-sm text-zinc-400 mt-1">{v.vehiculo}</p>
            <p className="text-sm text-zinc-300 font-semibold mt-0.5">{v.cliente_nombre}</p>
          </div>
          <span className="text-[0.6rem] uppercase font-bold text-zinc-400 bg-zinc-800 px-2.5 py-1 rounded-full whitespace-nowrap">
            {v.compania}
          </span>
        </div>

        <div className="flex gap-1.5 mt-3 flex-wrap">
          {v.trabajo_hecho && (
            <span className="text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-500/15">
              Espera validación
            </span>
          )}
          {exc && (
            <span className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full ${exc.color}`}>
              {exc.label}
            </span>
          )}
          {als.map((a, i) => (
            <span key={i} className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full ${
              a.nivel === 'alto' ? 'text-red-400 bg-red-500/15' : 'text-amber-400 bg-amber-500/15'
            }`}>
              {a.texto}
            </span>
          ))}
        </div>

        <div className="mt-4"><Cadena etapa={v.etapa} /></div>
      </Panel>

      {/* Etapa actual y avance */}
      {!entregado && (
        <Panel titulo={`Etapa: ${etapaLabel(v.etapa)}`}>
          <p className="text-xs text-zinc-500 -mt-2 mb-3">
            {diasEnEtapa(v)} días en esta etapa · {diasEnTaller(v)} días en el taller
          </p>

          {puedeTrabajar && !v.trabajo_hecho && !enTerminado && (
            <button
              onClick={marcarHecho} disabled={accion}
              className="w-full bg-zinc-800 text-white font-bold py-3 rounded-2xl mb-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              Marcar mi trabajo como realizado
            </button>
          )}

          {puedeValidar && siguiente && (
            <button
              onClick={validarYAvanzar} disabled={accion}
              className="w-full bg-emerald-500 text-black font-extrabold py-3.5 rounded-2xl active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              Validar y pasar a {etapaLabel(siguiente)}
            </button>
          )}

          {!puedeValidar && v.trabajo_hecho && (
            <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2.5">
              Trabajo marcado como realizado. Espera la validación de administración o del coordinador
              para avanzar a {siguiente ? etapaLabel(siguiente) : 'la etapa siguiente'}.
            </p>
          )}
          {!puedeValidar && !v.trabajo_hecho && !puedeTrabajar && (
            <p className="text-xs text-zinc-500">No tenés permiso para mover esta etapa.</p>
          )}

          {/* Excepciones */}
          <p className="text-[0.65rem] uppercase tracking-widest text-zinc-500 font-bold mt-5 mb-2">
            Estados en paralelo
          </p>
          <div className="flex gap-2">
            {EXCEPCIONES.map(e => {
              const activa = v.excepcion === e.id
              return (
                <button
                  key={e.id}
                  onClick={() => toggleExcepcion(e.id)}
                  disabled={accion || (!puedeValidar && !puedeTrabajar)}
                  className={`flex-1 text-xs font-bold py-2.5 rounded-xl border transition-colors disabled:opacity-40 ${
                    activa ? `${e.color} border-current` : 'bg-zinc-950 text-zinc-500 border-zinc-800'
                  }`}
                >
                  {e.label}
                </button>
              )
            })}
          </div>
          <p className="text-[0.65rem] text-zinc-600 mt-2 leading-snug">
            No sacan el vehículo de su etapa. Al levantarlos, retoma donde estaba.
          </p>
        </Panel>
      )}

      {/* Cobro y entrega */}
      {verMontos && (enTerminado || entregado) && (
        <Panel titulo="Validaciones de cobro">
          {[
            { campo: 'cobro_franquicia', label: 'Franquicia cobrada',        monto: v.monto_franquicia },
            { campo: 'cobro_compania',   label: 'Orden de compañía facturada', monto: v.monto_compania  },
            { campo: 'cobro_particular', label: 'Reparación particular pagada', monto: v.monto_particular },
          ].map(x => (
            <button
              key={x.campo}
              onClick={() => toggleCobro(x.campo, x.label)}
              disabled={accion || entregado}
              className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border mb-2 text-left disabled:opacity-60 ${
                v[x.campo] ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-zinc-950 border-zinc-800'
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-zinc-200">{x.label}</p>
                <p className="text-xs text-zinc-500">{Number(x.monto) ? fmtMonto(x.monto) : 'No aplica'}</p>
              </div>
              <span className={`text-lg ${v[x.campo] ? 'text-emerald-400' : 'text-zinc-700'}`}>
                {v[x.campo] ? '✓' : '○'}
              </span>
            </button>
          ))}

          <div className="flex justify-between pt-3 mt-1 border-t border-dashed border-zinc-800 text-base font-extrabold">
            <span className="text-zinc-400">Pendiente</span>
            <span className="text-white">{fmtMonto(pendiente(v))}</span>
          </div>

          {enTerminado && puedeValidar && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <label className="block mb-2.5">
                <span className="text-xs text-zinc-400 font-semibold">Fecha de entrega</span>
                <input
                  type="date" value={fEntrega} onChange={e => setFEntrega(e.target.value)}
                  className="mt-1.5 w-full bg-zinc-950 border border-zinc-800 text-white text-base rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-emerald-500"
                />
              </label>
              <button
                onClick={entregar} disabled={accion}
                className="w-full bg-emerald-500 text-black font-extrabold py-3.5 rounded-2xl active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                Pasar a Entregado
              </button>
              <p className="text-[0.65rem] text-zinc-600 mt-2 leading-snug">
                No hace falta que las tres validaciones estén tildadas para entregar.
              </p>
            </div>
          )}
        </Panel>
      )}

      {/* Datos del caso */}
      <Panel titulo="Datos del caso">
        <Dato k="N° de siniestro" v={v.nro_siniestro} />
        <Dato k="Productor"       v={v.productor} />
        <Dato k="Perito"          v={v.perito} />
        <Dato k="Kilometraje"     v={v.kilometraje ? `${Number(v.kilometraje).toLocaleString('es-AR')} km` : null} />
        <Dato k="Paños"           v={v.panos} />
        <Dato k="Ingreso"         v={fmtFecha(v.fecha_ingreso)} />
        <Dato k="Pactada"         v={fmtFecha(v.fecha_pactada)} />
        {v.fecha_entrega && <Dato k="Entrega" v={fmtFecha(v.fecha_entrega)} />}
        {verMontos && <Dato k="Total a facturar" v={fmtMonto(total(v))} />}
      </Panel>

      {/* Fotos y documentación */}
      {(fotos.length > 0 || pdfs.length > 0) && (
        <Panel titulo="Fotos y documentación">
          {fotos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {fotos.map(a => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer"
                   className="block aspect-[4/3] rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800">
                  {a.url && <img src={a.url} alt="Foto del vehículo" className="w-full h-full object-cover" />}
                </a>
              ))}
            </div>
          )}
          {pdfs.map(a => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer"
               className="flex items-center gap-2 py-2.5 border-b border-zinc-800 last:border-0 text-sm text-zinc-200 font-semibold">
              📄 {a.tipo === 'orden_interna' ? 'Orden de trabajo interna' : 'Orden de la compañía'}
            </a>
          ))}
        </Panel>
      )}

      {/* Reporte diario */}
      <Panel titulo="Reporte diario y observaciones">
        <div className="flex gap-2 mb-3">
          <input
            value={nota} onChange={e => setNota(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') agregarNota() }}
            placeholder="Qué pasó hoy con este auto…"
            className="flex-1 bg-zinc-950 border border-zinc-800 text-white text-sm rounded-xl px-3.5 py-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={agregarNota} disabled={accion || !nota.trim()}
            className="bg-emerald-500 text-black font-extrabold px-4 rounded-xl disabled:opacity-40"
          >
            +
          </button>
        </div>

        {eventos.length === 0 ? (
          <p className="text-zinc-600 text-xs">Todavía no hay movimientos registrados.</p>
        ) : (
          <div className="space-y-2.5">
            {eventos.map(ev => (
              <div key={ev.id} className="border-l-2 border-zinc-800 pl-3">
                <p className="text-sm text-zinc-200">{ev.texto}</p>
                <p className="text-[0.65rem] text-zinc-600 mt-0.5">
                  {new Date(ev.created_at).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                  {ev.etapa && ` · ${etapaLabel(ev.etapa)}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
