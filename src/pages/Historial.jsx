import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, formatFecha, hoyISO } from '../lib/format'

// ── Constantes ────────────────────────────────────────────────────
const MEDIO_ICON = {
  efectivo: '💵', tarjeta: '💳', transferencia: '🏦',
  mercadopago: '📲', cuenta_corriente: '📒', otro: '🔖',
}
const MEDIO_LABEL = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  mercadopago: 'MercadoPago', cuenta_corriente: 'Cta. cte.', otro: 'Otro',
}
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

import { TECHO_MONO } from '../lib/constants'

function formatHora(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}
function restarDias(fecha, dias) {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

// ── Vista 1: Historial por día ────────────────────────────────────
function HistorialDia({ empresaActivaId, esPractica }) {
  const [fecha, setFecha]   = useState(hoyISO())
  const [ventas, setVentas] = useState([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    if (!empresaActivaId) return
    setCargando(true)
    const { data } = await supabase
      .from('venta')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .eq('es_simulacion', esPractica)
      .eq('fecha', fecha)
      .order('creado_en', { ascending: false })
    setVentas(data || [])
    setCargando(false)
  }, [empresaActivaId, fecha, esPractica])

  useEffect(() => { cargar() }, [cargar])

  const total   = ventas.reduce((s, v) => s + Number(v.total), 0)
  const fiscal  = ventas.filter(v => v.tipo_registro === 'fiscal').reduce((s, v) => s + Number(v.total), 0)
  const interno = ventas.filter(v => v.tipo_registro === 'interno').reduce((s, v) => s + Number(v.total), 0)
  const porMedio = ventas.reduce((acc, v) => {
    acc[v.medio_pago] = (acc[v.medio_pago] || 0) + Number(v.total); return acc
  }, {})

  const hoy   = hoyISO()
  const esHoy = fecha === hoy

  return (
    <div className="grid gap-4">
      {/* Selector fecha */}
      <div className="flex items-center justify-between bg-white rounded-3xl px-4 py-3 shadow-sm">
        <button onClick={() => setFecha(f => restarDias(f, 1))}
          className="text-indigo-600 font-extrabold text-xl w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-indigo-50 active:scale-90 transition-all"
        >‹</button>
        <div className="text-center">
          <p className="font-extrabold text-slate-800">{esHoy ? '📅 Hoy' : formatFecha(fecha)}</p>
          {!esHoy && (
            <button onClick={() => setFecha(hoy)} className="text-xs text-indigo-500 font-semibold mt-0.5">
              Volver a hoy
            </button>
          )}
        </div>
        <button onClick={() => setFecha(f => restarDias(f, -1))} disabled={esHoy}
          className="text-indigo-600 font-extrabold text-xl w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-indigo-50 active:scale-90 transition-all disabled:opacity-20"
        >›</button>
      </div>

      {/* Resumen */}
      {ventas.length > 0 && (
        <div className="bg-indigo-600 rounded-3xl p-5 text-white">
          <p className="text-indigo-300 text-xs font-semibold uppercase tracking-widest mb-1">Total del día</p>
          <p className="text-4xl font-extrabold mb-4">{formatPesos(total)}</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-white/15 rounded-2xl p-3">
              <p className="text-indigo-200 text-xs mb-1">🧾 Fiscal</p>
              <p className="text-xl font-extrabold">{formatPesos(fiscal)}</p>
            </div>
            <div className="bg-white/15 rounded-2xl p-3">
              <p className="text-indigo-200 text-xs mb-1">📦 Interno</p>
              <p className="text-xl font-extrabold">{formatPesos(interno)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(porMedio).map(([medio, monto]) => (
              <span key={medio} className="bg-white/15 rounded-2xl px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                {MEDIO_ICON[medio]} {MEDIO_LABEL[medio]} · {formatPesos(monto)}
              </span>
            ))}
          </div>
        </div>
      )}

      {cargando && <p className="text-center text-slate-400 text-sm py-8">Cargando…</p>}
      {!cargando && ventas.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-5xl mb-3">🧾</p>
          <p className="font-semibold">Sin ventas {esHoy ? 'hoy' : 'ese día'}</p>
        </div>
      )}

      <div className="grid gap-2">
        {ventas.map(v => (
          <div key={v.id} className="bg-white rounded-3xl px-5 py-4 shadow-sm flex items-center gap-4">
            <span className="text-2xl">{MEDIO_ICON[v.medio_pago] || '💰'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded-full ${
                  v.tipo_registro === 'fiscal'
                    ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {v.tipo_registro === 'fiscal' ? 'Fiscal' : 'Interno'}
                </span>
                {v.cae && (
                  <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    CAE ✓
                  </span>
                )}
                <span className="text-[0.7rem] text-slate-400">{formatHora(v.creado_en)}</span>
              </div>
              {v.descripcion
                ? <p className="text-sm text-slate-600 truncate">{v.descripcion}</p>
                : <p className="text-sm text-slate-400 italic">{MEDIO_LABEL[v.medio_pago]}</p>
              }
            </div>
            <p className="font-extrabold text-slate-800 text-base shrink-0">{formatPesos(v.total)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Vista 2: Resumen fiscal mensual ──────────────────────────────
function ResumenFiscal({ empresaActivaId, empresaActiva, esPractica }) {
  const hoy      = new Date()
  const [year,   setYear]   = useState(hoy.getFullYear())
  const [month,  setMonth]  = useState(hoy.getMonth() + 1)   // 1-12
  const [datos,  setDatos]  = useState(null)
  const [cargando, setCargando] = useState(true)

  const condicion  = empresaActiva?.condicion_fiscal || 'monotributo'
  const categoria  = empresaActiva?.categoria_monotributo || 'C'
  const techoMono  = TECHO_MONO[categoria] || 0

  const inicio = `${year}-${String(month).padStart(2, '0')}-01`
  const fin    = new Date(year, month, 0).toISOString().slice(0, 10)
  const inicioAnio = `${year}-01-01`

  function mesAnterior() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function mesSiguiente() {
    const esActual = year === hoy.getFullYear() && month === hoy.getMonth() + 1
    if (esActual) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const cargar = useCallback(async () => {
    if (!empresaActivaId) return
    setCargando(true)

    const [
      { data: ventasMes },
      { data: ventasAnio },
      { data: comprasMes },
    ] = await Promise.all([
      // Ventas del mes (todas para estadísticas)
      supabase.from('venta').select('total, neto, iva, tipo_registro, cae, fecha, descripcion, medio_pago')
        .eq('empresa_id', empresaActivaId)
        .eq('es_simulacion', esPractica)
        .gte('fecha', inicio).lte('fecha', fin),

      // Ventas fiscales del año (para techo mono)
      supabase.from('venta').select('total')
        .eq('empresa_id', empresaActivaId)
        .eq('tipo_registro', 'fiscal')
        .eq('es_simulacion', esPractica)
        .gte('fecha', inicioAnio).lte('fecha', fin),

      // Compras del mes (IVA crédito para RI)
      supabase.from('compra').select('iva, neto, total, categoria')
        .eq('empresa_id', empresaActivaId)
        .eq('es_simulacion', esPractica)
        .gte('fecha', inicio).lte('fecha', fin),
    ])

    setDatos({ ventasMes: ventasMes || [], ventasAnio: ventasAnio || [], comprasMes: comprasMes || [] })
    setCargando(false)
  }, [empresaActivaId, inicio, fin, inicioAnio, esPractica])

  useEffect(() => { cargar() }, [cargar])

  const metricas = useMemo(() => {
    if (!datos) return null
    const { ventasMes, ventasAnio, comprasMes } = datos

    const totalMes      = ventasMes.reduce((s, v) => s + Number(v.total), 0)
    const fiscalMes     = ventasMes.filter(v => v.tipo_registro === 'fiscal').reduce((s, v) => s + Number(v.total), 0)
    const netoFiscal    = ventasMes.filter(v => v.tipo_registro === 'fiscal').reduce((s, v) => s + Number(v.neto), 0)
    const ivaDebito     = ventasMes.filter(v => v.tipo_registro === 'fiscal').reduce((s, v) => s + Number(v.iva), 0)
    const ivaCredito    = comprasMes.reduce((s, c) => s + Number(c.iva), 0)
    const saldoIVA      = ivaDebito - ivaCredito
    const facturadoAnio = ventasAnio.reduce((s, v) => s + Number(v.total), 0)
    const sinCae        = ventasMes.filter(v => v.tipo_registro === 'fiscal' && !v.cae).length
    const facturasFiscales = ventasMes.filter(v => v.tipo_registro === 'fiscal')

    return { totalMes, fiscalMes, netoFiscal, ivaDebito, ivaCredito, saldoIVA,
             facturadoAnio, sinCae, facturasFiscales }
  }, [datos])

  const esActual = year === hoy.getFullYear() && month === hoy.getMonth() + 1
  const pctMono  = metricas && techoMono > 0 ? Math.min((metricas.facturadoAnio / techoMono) * 100, 100) : 0
  const colorBarra = pctMono >= 90 ? 'bg-red-500' : pctMono >= 70 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="grid gap-4">

      {/* Selector mes */}
      <div className="flex items-center justify-between bg-white rounded-3xl px-4 py-3 shadow-sm">
        <button onClick={mesAnterior}
          className="text-indigo-600 font-extrabold text-xl w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-indigo-50 active:scale-90 transition-all"
        >‹</button>
        <p className="font-extrabold text-slate-800">{MESES[month - 1]} {year}</p>
        <button onClick={mesSiguiente} disabled={esActual}
          className="text-indigo-600 font-extrabold text-xl w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-indigo-50 active:scale-90 transition-all disabled:opacity-20"
        >›</button>
      </div>

      {cargando && <p className="text-center text-slate-400 text-sm py-8">Cargando…</p>}

      {!cargando && metricas && (
        <>
          {/* ── MONOTRIBUTO ── */}
          {condicion === 'monotributo' && (
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <div className="flex justify-between items-center mb-1">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
                  Facturación anual · Cat. {categoria}
                </p>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  pctMono >= 90 ? 'bg-red-100 text-red-600'
                  : pctMono >= 70 ? 'bg-amber-100 text-amber-600'
                  : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {pctMono.toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 mb-2">
                <span>{formatPesos(metricas.facturadoAnio)} facturado</span>
                <span>Techo {formatPesos(techoMono)}</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${colorBarra}`}
                  style={{ width: `${pctMono}%` }} />
              </div>
              {pctMono >= 90 && (
                <p className="text-xs text-red-500 font-semibold mt-2">
                  ⚠️ Cerca del techo — hablá con tu contadora
                </p>
              )}
              {pctMono >= 70 && pctMono < 90 && (
                <p className="text-xs text-amber-500 font-semibold mt-2">
                  Atención: superás el 70% del techo anual
                </p>
              )}
            </div>
          )}

          {/* ── RESPONSABLE INSCRIPTO: posición IVA ── */}
          {condicion === 'responsable_inscripto' && (
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-4">
                Posición IVA · {MESES[month - 1]}
              </p>
              <div className="grid gap-2">
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-600">Neto gravado</span>
                  <span className="font-bold text-slate-800">{formatPesos(metricas.netoFiscal)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-600">IVA débito fiscal</span>
                  <span className="font-bold text-rose-600">+{formatPesos(metricas.ivaDebito)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-600">IVA crédito fiscal</span>
                  <span className="font-bold text-emerald-600">−{formatPesos(metricas.ivaCredito)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm font-extrabold text-slate-800">Saldo a pagar</span>
                  <span className={`font-extrabold text-lg ${metricas.saldoIVA > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {formatPesos(metricas.saldoIVA)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Resumen del mes */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-3xl p-4 shadow-sm">
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-2">
                Total facturado
              </p>
              <p className="text-lg font-extrabold text-slate-800">{formatPesos(metricas.totalMes)}</p>
            </div>
            <div className="bg-white rounded-3xl p-4 shadow-sm">
              <p className="text-[0.6rem] text-slate-400 font-semibold uppercase tracking-widest mb-2">
                Facturas fiscales
              </p>
              <p className="text-lg font-extrabold text-slate-800">
                {metricas.facturasFiscales.length}
                {metricas.sinCae > 0 && (
                  <span className="ml-1 text-sm font-bold text-red-500">({metricas.sinCae} sin CAE)</span>
                )}
              </p>
            </div>
          </div>

          {/* Alerta sin CAE */}
          {metricas.sinCae > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-3xl px-5 py-4 flex items-start gap-3">
              <span className="text-xl shrink-0">🚨</span>
              <div>
                <p className="font-bold text-red-700 text-sm">
                  {metricas.sinCae} {metricas.sinCae === 1 ? 'venta fiscal sin CAE' : 'ventas fiscales sin CAE'}
                </p>
                <p className="text-xs text-red-500 mt-0.5">
                  Sin CAE la factura no tiene validez fiscal ante ARCA
                </p>
              </div>
            </div>
          )}

          {/* Libro de facturas */}
          {metricas.facturasFiscales.length > 0 && (
            <>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
                Facturas fiscales · {MESES[month - 1]}
              </p>
              <div className="grid gap-2">
                {metricas.facturasFiscales.map((v, i) => (
                  <div key={i} className="bg-white rounded-3xl px-5 py-4 shadow-sm flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-slate-500">{formatFecha(v.fecha)}</span>
                        {v.cae
                          ? <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">CAE ✓</span>
                          : <span className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Sin CAE</span>
                        }
                      </div>
                      {v.cae && <p className="text-[0.65rem] text-slate-400 font-mono">{v.cae}</p>}
                      {v.descripcion && <p className="text-xs text-slate-500 truncate mt-0.5">{v.descripcion}</p>}
                    </div>
                    <p className="font-extrabold text-slate-800 shrink-0">{formatPesos(v.total)}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {metricas.facturasFiscales.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-4xl mb-3">🧾</p>
              <p className="font-semibold">Sin facturas fiscales en {MESES[month - 1]}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────
export default function Historial() {
  const { empresaActivaId, empresaActiva } = useAuth()
  const [vista, setVista] = useState('dia')
  const esPractica = empresaActiva?.modo_simulacion ?? false

  return (
    <div className="grid gap-4">

      {/* Toggle de vistas */}
      <div className="bg-white rounded-3xl p-1.5 flex shadow-sm">
        <button onClick={() => setVista('dia')}
          className={`flex-1 py-2.5 rounded-2xl text-sm font-bold transition-all ${
            vista === 'dia' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'
          }`}
        >
          📋 Por día
        </button>
        <button onClick={() => setVista('fiscal')}
          className={`flex-1 py-2.5 rounded-2xl text-sm font-bold transition-all ${
            vista === 'fiscal' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400'
          }`}
        >
          🧾 Fiscal
        </button>
      </div>

      {vista === 'dia'
        ? <HistorialDia    empresaActivaId={empresaActivaId} esPractica={esPractica} />
        : <ResumenFiscal   empresaActivaId={empresaActivaId} empresaActiva={empresaActiva} esPractica={esPractica} />
      }

    </div>
  )
}
