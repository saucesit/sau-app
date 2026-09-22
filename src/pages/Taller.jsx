import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  ETAPAS_ACTIVAS, etapaLabel, excepcionCfg,
  diasEnTaller, diasEnEtapa, alertas, pendiente, fmtMonto,
} from '../lib/taller'

const NIVEL_CLASE = {
  alto:  'text-red-400 bg-red-500/15',
  medio: 'text-amber-400 bg-amber-500/15',
}

function Kpi({ label, valor, detalle }) {
  return (
    <div className="min-w-[150px] bg-zinc-900 border border-zinc-800 border-t-2 border-t-emerald-500 rounded-2xl px-4 py-3">
      <p className="text-[0.6rem] uppercase tracking-widest text-zinc-500 font-bold">{label}</p>
      <p className="text-2xl font-extrabold text-white mt-0.5">{valor}</p>
      {detalle && <p className="text-[0.65rem] text-zinc-500 mt-1 leading-snug">{detalle}</p>}
    </div>
  )
}

function VehiculoCard({ v, verMontos, onClick }) {
  const als  = alertas(v)
  const exc  = excepcionCfg(v.excepcion)
  const peor = als[0]
  const borde = peor?.nivel === 'alto' ? 'border-l-red-500'
              : peor?.nivel === 'medio' ? 'border-l-amber-500'
              : 'border-l-emerald-500'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-zinc-900 border border-zinc-800 border-l-4 ${borde} rounded-2xl p-4 mb-2.5 active:scale-[0.99] transition-transform`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="text-lg font-extrabold text-white leading-none tracking-wide">{v.patente}</p>
          <p className="text-xs text-zinc-400 mt-1 truncate">{v.vehiculo} — {v.cliente_nombre}</p>
        </div>
        <span className="text-[0.6rem] uppercase font-bold text-zinc-400 bg-zinc-800 px-2 py-1 rounded-full whitespace-nowrap">
          {v.compania}
        </span>
      </div>

      <div className="flex justify-between items-center mt-3 text-xs text-zinc-500">
        <span>{diasEnTaller(v)} días en taller</span>
        {verMontos && <span className="font-bold text-zinc-300">{fmtMonto(pendiente(v))}</span>}
      </div>

      <div className="flex gap-1.5 mt-2.5 flex-wrap">
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
          <span key={i} className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full ${NIVEL_CLASE[a.nivel]}`}>
            {a.texto}
          </span>
        ))}
        {!exc && als.length === 0 && (
          <span className="text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full text-emerald-400 bg-emerald-500/15">
            En plazo
          </span>
        )}
      </div>
    </button>
  )
}

export default function Taller() {
  const { empresaActivaId, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const [vehiculos, setVehiculos] = useState([])
  const [cargando,  setCargando]  = useState(true)
  const [etapaSel,  setEtapaSel]  = useState('recepcion')
  const [busqueda,  setBusqueda]  = useState('')

  const verMontos  = tienePermiso('taller.montos')
  const puedeAlta  = tienePermiso('taller.cargar')

  useEffect(() => { cargar() }, [empresaActivaId])

  async function cargar() {
    if (!empresaActivaId) return
    setCargando(true)

    const { data } = await supabase
      .from('vehiculo')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .neq('etapa', 'entregado')
      .order('fecha_ingreso', { ascending: true })

    // Los montos viven en otra tabla, cerrada por policy: quien no tiene
    // taller.montos recibe cero filas y el tablero simplemente no los muestra.
    let montos = {}
    if (data?.length) {
      const { data: ms } = await supabase
        .from('vehiculo_monto')
        .select('*')
        .in('vehiculo_id', data.map(v => v.id))
      ;(ms || []).forEach(m => { montos[m.vehiculo_id] = m })
    }

    setVehiculos((data || []).map(v => ({ ...v, ...(montos[v.id] || {}) })))
    setCargando(false)
  }

  const conAlerta = useMemo(() => vehiculos.filter(v => alertas(v).length > 0), [vehiculos])
  const promedio  = vehiculos.length
    ? Math.round(vehiculos.reduce((s, v) => s + diasEnTaller(v), 0) / vehiculos.length)
    : 0
  const totalPend = useMemo(() => vehiculos.reduce((s, v) => s + pendiente(v), 0), [vehiculos])

  const porEtapa = useMemo(() => {
    const m = {}
    ETAPAS_ACTIVAS.forEach(e => { m[e.id] = [] })
    vehiculos.forEach(v => { if (m[v.etapa]) m[v.etapa].push(v) })
    return m
  }, [vehiculos])

  // El buscador, cuando tiene texto, ignora la etapa seleccionada y busca en todo.
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return porEtapa[etapaSel] || []
    return vehiculos.filter(v =>
      [v.patente, v.vehiculo, v.cliente_nombre, v.compania, v.nro_siniestro, v.perito, v.productor]
        .some(campo => (campo || '').toLowerCase().includes(q))
    )
  }, [busqueda, porEtapa, etapaSel, vehiculos])

  if (cargando) {
    return <p className="text-zinc-500 text-sm text-center py-10">Cargando taller…</p>
  }

  return (
    <div className="space-y-4">

      {/* KPIs */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-4 px-4">
        <Kpi label="En taller" valor={vehiculos.length} detalle={`${conAlerta.length} con alerta`} />
        <Kpi label="Promedio días" valor={promedio} detalle="sobre los activos" />
        {verMontos && (
          <Kpi label="Pendiente" valor={fmtMonto(totalPend)} detalle="sin cobrar ni facturar" />
        )}
      </div>

      {puedeAlta && (
        <button
          onClick={() => navigate('/taller/nuevo')}
          className="w-full bg-emerald-500 text-black font-extrabold py-3.5 rounded-2xl active:scale-[0.98] transition-transform"
        >
          + Ingresar vehículo
        </button>
      )}

      <input
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        placeholder="Buscar patente, cliente, siniestro…"
        className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm rounded-2xl px-4 py-3 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
      />

      {/* Etapas */}
      {!busqueda.trim() && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {ETAPAS_ACTIVAS.map(e => {
            const n = porEtapa[e.id]?.length || 0
            const activa = e.id === etapaSel
            return (
              <button
                key={e.id}
                onClick={() => setEtapaSel(e.id)}
                className={`flex-shrink-0 text-xs font-bold px-3.5 py-2 rounded-full border transition-colors ${
                  activa
                    ? 'bg-emerald-500 text-black border-emerald-500'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                }`}
              >
                {e.label} <span className={activa ? 'text-black/60' : 'text-emerald-400'}>{n}</span>
              </button>
            )
          })}
        </div>
      )}

      <div>
        {busqueda.trim() && (
          <p className="text-xs text-zinc-500 mb-2 px-1">
            {filtrados.length} {filtrados.length === 1 ? 'resultado' : 'resultados'} en todo el taller
          </p>
        )}

        {filtrados.length === 0 ? (
          <p className="text-zinc-600 text-sm text-center py-10">
            {busqueda.trim()
              ? 'No hay vehículos que coincidan'
              : `Ningún vehículo en ${etapaLabel(etapaSel)}`}
          </p>
        ) : (
          filtrados.map(v => (
            <VehiculoCard
              key={v.id}
              v={v}
              verMontos={verMontos}
              onClick={() => navigate(`/taller/${v.id}`)}
            />
          ))
        )}
      </div>
    </div>
  )
}
