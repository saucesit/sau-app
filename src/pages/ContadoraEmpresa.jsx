import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatPesos, formatFecha } from '../lib/format'
import { TECHO_MONO } from '../lib/constants'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ── Sección certificado ARCA ──────────────────────────────────────
function CertificadoARCA({ empresaId }) {
  const [cert,        setCert]        = useState(null)
  const [cargando,    setCargando]    = useState(true)
  const [editando,    setEditando]    = useState(false)
  const [certPEM,     setCertPEM]     = useState('')
  const [keyPEM,      setKeyPEM]      = useState('')
  const [ambiente,    setAmbiente]    = useState('homologacion')
  const [vigencia,    setVigencia]    = useState('')
  const [guardando,   setGuardando]   = useState(false)
  const [resultado,   setResultado]   = useState(null)

  useEffect(() => {
    supabase.from('certificado_arca')
      .select('cert_pem, ambiente, vigente_hasta, activo, updated_at')
      .eq('empresa_id', empresaId)
      .maybeSingle()
      .then(({ data }) => { setCert(data); setCargando(false) })
  }, [empresaId])

  async function guardar() {
    if (!certPEM.trim() || !keyPEM.trim()) return setResultado({ ok: false, msg: 'Pegá el certificado y la clave privada' })
    setGuardando(true)
    const payload = {
      empresa_id:    empresaId,
      cuit:          '',   // se completa desde la empresa
      cert_pem:      certPEM.trim(),
      key_pem:       keyPEM.trim(),
      ambiente,
      vigente_hasta: vigencia || null,
      activo:        true,
    }
    const { error } = cert
      ? await supabase.from('certificado_arca').update(payload).eq('empresa_id', empresaId)
      : await supabase.from('certificado_arca').insert(payload)
    setGuardando(false)
    if (error) return setResultado({ ok: false, msg: error.message })
    setResultado({ ok: true, msg: 'Certificado guardado' })
    setEditando(false)
    setCert({ ...payload, updated_at: new Date().toISOString() })
    setTimeout(() => setResultado(null), 3000)
  }

  if (cargando) return null

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
          Certificado ARCA
        </p>
        {cert && !editando && (
          <button onClick={() => setEditando(true)}
            className="text-xs text-indigo-500 font-bold">
            Actualizar
          </button>
        )}
      </div>

      {!cert && !editando && (
        <button onClick={() => setEditando(true)}
          className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 active:scale-[0.98] transition-all"
        >
          <div>
            <p className="text-sm font-bold text-amber-700">Sin certificado configurado</p>
            <p className="text-xs text-amber-500 mt-0.5">Sin esto, las facturas no generan CAE real</p>
          </div>
          <span className="text-amber-500 text-lg">→</span>
        </button>
      )}

      {cert && !editando && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <p className="text-sm font-bold text-emerald-700">Certificado activo</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ml-auto ${
              cert.ambiente === 'produccion'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {cert.ambiente === 'produccion' ? 'Producción' : 'Homologación'}
            </span>
          </div>
          {cert.vigente_hasta && (
            <p className="text-xs text-emerald-600">Vence: {new Date(cert.vigente_hasta).toLocaleDateString('es-AR')}</p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            Actualizado: {new Date(cert.updated_at).toLocaleDateString('es-AR')}
          </p>
        </div>
      )}

      {editando && (
        <div className="bg-white border border-slate-100 rounded-3xl p-4 grid gap-3 shadow-sm">
          <div>
            <p className="text-xs text-slate-400 font-semibold mb-1.5">Ambiente</p>
            <div className="flex gap-2">
              {['homologacion','produccion'].map(a => (
                <button key={a} onClick={() => setAmbiente(a)}
                  className={`flex-1 py-2.5 rounded-2xl text-sm font-bold transition-all ${
                    ambiente === a ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {a === 'homologacion' ? 'Test (Homologación)' : 'Producción real'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-semibold mb-1.5">
              Certificado (.crt / .pem) — comenzá con -----BEGIN CERTIFICATE-----
            </p>
            <textarea
              value={certPEM}
              onChange={e => setCertPEM(e.target.value)}
              rows={4}
              placeholder="-----BEGIN CERTIFICATE-----&#10;MIIEp...&#10;-----END CERTIFICATE-----"
              className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-2xl p-3 outline-none resize-none"
            />
          </div>

          <div>
            <p className="text-xs text-slate-400 font-semibold mb-1.5">
              Clave privada (.key / .pem) — comenzá con -----BEGIN RSA PRIVATE KEY-----
            </p>
            <textarea
              value={keyPEM}
              onChange={e => setKeyPEM(e.target.value)}
              rows={4}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;MIIEo...&#10;-----END RSA PRIVATE KEY-----"
              className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-2xl p-3 outline-none resize-none"
            />
          </div>

          <div>
            <p className="text-xs text-slate-400 font-semibold mb-1.5">Fecha de vencimiento del certificado</p>
            <input type="date" value={vigencia} onChange={e => setVigencia(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 outline-none text-sm"
            />
          </div>

          {resultado && (
            <p className={`text-sm font-bold text-center ${resultado.ok ? 'text-emerald-600' : 'text-red-500'}`}>
              {resultado.ok ? '✅ ' : '❌ '}{resultado.msg}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setEditando(false); setResultado(null) }}
              className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm active:scale-95 transition-all"
            >Cancelar</button>
            <button onClick={guardar} disabled={guardando}
              className="py-3 rounded-2xl bg-indigo-600 text-white font-bold text-sm active:scale-95 transition-all disabled:opacity-50"
            >{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

const CHECKLIST = [
  { id: 'datos_arca', label: 'Datos del contribuyente verificados en ARCA' },
  { id: 'sin_deuda',  label: 'Sin deuda exigible con ARCA' },
  { id: 'libro_iva',  label: 'Libro IVA completo y sin huecos' },
  { id: 'posicion',   label: 'Posición IVA calculada y razonable' },
  { id: 'cliente_ok', label: 'Cliente notificado y de acuerdo' },
]

export default function ContadoraEmpresa() {
  const { empresaId } = useParams()
  const hoyDate = new Date()

  const [year,     setYear]     = useState(hoyDate.getFullYear())
  const [month,    setMonth]    = useState(hoyDate.getMonth() + 1)
  const [empresa,  setEmpresa]  = useState(null)
  const [datos,    setDatos]    = useState(null)
  const [checks,   setChecks]   = useState({})
  const [cargando, setCargando] = useState(true)
  const [copiado,  setCopiado]  = useState(false)

  const inicio   = `${year}-${String(month).padStart(2,'0')}-01`
  const fin      = new Date(year, month, 0).toISOString().slice(0, 10)
  const hace12m  = new Date(year, month - 1, 1); hace12m.setFullYear(hace12m.getFullYear() - 1)
  const hace12mISO = hace12m.toISOString().slice(0, 10)

  function mesAnterior() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function mesSiguiente() {
    const esActual = year === hoyDate.getFullYear() && month === hoyDate.getMonth() + 1
    if (esActual) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const cargar = useCallback(async () => {
    if (!empresaId) return
    setCargando(true)

    const [
      { data: emp },
      { data: fac12m },
      { data: sinCae },
      { data: sinCuit },
      { data: ventasMes },
      { data: comprasMes },
    ] = await Promise.all([
      supabase.from('empresa').select('*').eq('id', empresaId).single(),
      supabase.from('venta').select('total')
        .eq('empresa_id', empresaId).eq('tipo_registro', 'fiscal')
        .eq('es_simulacion', false)
        .gte('fecha', hace12mISO).lte('fecha', fin),
      supabase.from('venta')
        .select('id, fecha, total, descripcion')
        .eq('empresa_id', empresaId).eq('tipo_registro', 'fiscal')
        .is('cae', null)
        .gte('fecha', inicio).lte('fecha', fin)
        .order('fecha', { ascending: false }),
      supabase.from('compra')
        .select('id, fecha, total, proveedor:proveedor_id(nombre)')
        .eq('empresa_id', empresaId)
        .is('cuit_proveedor', null)
        .gte('fecha', inicio).lte('fecha', fin)
        .order('fecha', { ascending: false }),
      supabase.from('venta').select('total, neto, iva')
        .eq('empresa_id', empresaId).eq('tipo_registro', 'fiscal')
        .eq('es_simulacion', false)
        .gte('fecha', inicio).lte('fecha', fin),
      supabase.from('compra').select('total, iva')
        .eq('empresa_id', empresaId)
        .gte('fecha', inicio).lte('fecha', fin),
    ])

    const fac12mTotal    = (fac12m     || []).reduce((s, v) => s + Number(v.total), 0)
    const ivaDebito      = (ventasMes  || []).reduce((s, v) => s + Number(v.iva   || 0), 0)
    const ivaCredito     = (comprasMes || []).reduce((s, v) => s + Number(v.iva   || 0), 0)
    const ventasMesTotal = (ventasMes  || []).reduce((s, v) => s + Number(v.total), 0)
    const netoMes        = (ventasMes  || []).reduce((s, v) => s + Number(v.neto  || 0), 0)
    const cantFacturas   = (ventasMes  || []).length

    setEmpresa(emp)
    setDatos({ fac12mTotal, ivaDebito, ivaCredito, ventasMesTotal, netoMes,
               cantFacturas, sinCae: sinCae || [], sinCuit: sinCuit || [] })
    setCargando(false)
  }, [empresaId, inicio, fin, hace12mISO])

  useEffect(() => { cargar() }, [cargar])

  function toggle(id) { setChecks(p => ({ ...p, [id]: !p[id] })) }

  function generarResumen() {
    if (!empresa || !datos) return ''
    const nombre  = empresa.nombre_fantasia || empresa.razon_social
    const periodo = `${MESES[month - 1]} ${year}`
    const esMono  = empresa.condicion_fiscal === 'monotributo'
    const esRI    = empresa.condicion_fiscal === 'responsable_inscripto'
    const techo   = TECHO_MONO[empresa.categoria_monotributo]
    const pct     = techo ? (datos.fac12mTotal / techo * 100).toFixed(0) : null
    const saldo   = datos.ivaDebito - datos.ivaCredito

    let txt = `📊 *RESUMEN FISCAL · ${nombre.toUpperCase()}*\n`
    txt += `Período: ${periodo}\n`
    if (empresa.cuit) txt += `CUIT: ${empresa.cuit}\n`
    txt += `\n`

    txt += `💰 *Facturación del mes*\n`
    txt += `  Total: ${formatPesos(datos.ventasMesTotal)}\n`
    txt += `  Facturas: ${datos.cantFacturas}\n`
    if (datos.sinCae.length > 0) txt += `  ⚠️ Sin CAE: ${datos.sinCae.length}\n`
    txt += `\n`

    if (esMono && techo) {
      txt += `📈 *Monotributo · Cat. ${empresa.categoria_monotributo}*\n`
      txt += `  Facturado últimos 12 meses: ${formatPesos(datos.fac12mTotal)}\n`
      txt += `  Techo: ${formatPesos(techo)} (${pct}% utilizado)\n`
      if (Number(pct) > 80) txt += `  ⚠️ Cerca del techo — revisar recategorización\n`
      txt += `\n`
    }

    if (esRI) {
      txt += `📋 *Posición IVA · ${periodo}*\n`
      txt += `  Neto gravado: ${formatPesos(datos.netoMes)}\n`
      txt += `  IVA débito: ${formatPesos(datos.ivaDebito)}\n`
      txt += `  IVA crédito: ${formatPesos(datos.ivaCredito)}\n`
      txt += `  *Saldo: ${saldo > 0 ? formatPesos(saldo) + ' a pagar' : formatPesos(Math.abs(saldo)) + ' a favor'}*\n`
      txt += `\n`
    }

    const checksOk = CHECKLIST.filter(c => checks[c.id]).length
    txt += `✅ *Checklist pre-firma:* ${checksOk}/${CHECKLIST.length}\n`
    txt += `\n`
    txt += `_Generado con SAU · ${new Date().toLocaleDateString('es-AR')}_`
    return txt
  }

  function compartir() {
    const txt = generarResumen()
    navigator.clipboard.writeText(txt)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  if (cargando || !empresa) {
    return <p className="text-center text-slate-400 py-12 text-sm">Cargando…</p>
  }

  const esMono   = empresa.condicion_fiscal === 'monotributo'
  const esRI     = empresa.condicion_fiscal === 'responsable_inscripto'
  const techo    = TECHO_MONO[empresa.categoria_monotributo]
  const pctTecho = techo ? (datos.fac12mTotal / techo * 100) : 0
  const saldoIVA = datos.ivaDebito - datos.ivaCredito
  const checksOk = CHECKLIST.filter(c => checks[c.id]).length
  const hayRojos = datos.sinCae.length > 0 || (esMono && pctTecho > 100)
  const esActual = year === hoyDate.getFullYear() && month === hoyDate.getMonth() + 1

  const alertas = [
    ...datos.sinCae.map(v => ({
      nivel: 'rojo', icon: '🧾',
      titulo: 'Venta sin CAE',
      detalle: `${formatFecha(v.fecha)} · ${formatPesos(v.total)}${v.descripcion ? ` · ${v.descripcion}` : ''}`,
    })),
    ...datos.sinCuit.map(c => ({
      nivel: 'amarillo', icon: '🛍️',
      titulo: 'Compra sin CUIT proveedor',
      detalle: `${formatFecha(c.fecha)} · ${formatPesos(c.total)}${c.proveedor?.nombre ? ` · ${c.proveedor.nombre}` : ''}`,
    })),
    ...(esMono && pctTecho > 100 ? [{
      nivel: 'rojo', icon: '🚨',
      titulo: `Facturación excedió techo Cat. ${empresa.categoria_monotributo}`,
      detalle: `${formatPesos(datos.fac12mTotal)} / ${formatPesos(techo)} — recategorización urgente`,
    }] : []),
    ...(esMono && pctTecho > 80 && pctTecho <= 100 ? [{
      nivel: 'amarillo', icon: '⚠️',
      titulo: `Cerca del techo Cat. ${empresa.categoria_monotributo}`,
      detalle: `${pctTecho.toFixed(0)}% — quedan ${formatPesos(techo - datos.fac12mTotal)}`,
    }] : []),
  ]

  return (
    <div className="grid gap-4">

      {/* Selector de período */}
      <div className="flex items-center justify-between bg-white rounded-3xl px-4 py-3 shadow-sm">
        <button onClick={mesAnterior}
          className="text-indigo-600 font-extrabold text-xl w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-indigo-50 active:scale-90 transition-all"
        >‹</button>
        <div className="text-center">
          <p className="font-extrabold text-slate-800">{MESES[month - 1]} {year}</p>
          {!esActual && (
            <button onClick={() => { setYear(hoyDate.getFullYear()); setMonth(hoyDate.getMonth() + 1) }}
              className="text-xs text-indigo-500 font-semibold mt-0.5"
            >
              Mes actual
            </button>
          )}
        </div>
        <button onClick={mesSiguiente} disabled={esActual}
          className="text-indigo-600 font-extrabold text-xl w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-indigo-50 active:scale-90 transition-all disabled:opacity-20"
        >›</button>
      </div>

      {/* Header empresa */}
      <div className="bg-indigo-600 text-white rounded-3xl p-5 shadow-lg shadow-indigo-100">
        <p className="text-indigo-300 text-xs uppercase tracking-widest mb-1">
          {empresa.condicion_fiscal?.replace(/_/g, ' ')}
          {empresa.categoria_monotributo ? ` · Cat. ${empresa.categoria_monotributo}` : ''}
        </p>
        <h2 className="text-xl font-extrabold leading-tight">
          {empresa.nombre_fantasia || empresa.razon_social}
        </h2>
        {empresa.cuit && <p className="text-indigo-200 text-sm mt-1">CUIT: {empresa.cuit}</p>}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="bg-white/15 rounded-2xl p-3">
            <p className="text-indigo-200 text-xs mb-1">Facturado el mes</p>
            <p className="font-extrabold">{formatPesos(datos.ventasMesTotal)}</p>
          </div>
          <div className="bg-white/15 rounded-2xl p-3">
            <p className="text-indigo-200 text-xs mb-1">Facturas emitidas</p>
            <p className="font-extrabold">
              {datos.cantFacturas}
              {datos.sinCae.length > 0 &&
                <span className="ml-1 text-red-300 text-sm">({datos.sinCae.length} sin CAE)</span>
              }
            </p>
          </div>
        </div>
      </div>

      {/* Gauge recategorización (Monotributo) */}
      {esMono && techo && (
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <div className="flex justify-between items-baseline mb-1">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
              Facturación últimos 12 meses
            </p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              pctTecho > 100 ? 'bg-red-100 text-red-600'
              : pctTecho > 80 ? 'bg-amber-100 text-amber-600'
              : 'bg-emerald-100 text-emerald-700'
            }`}>{pctTecho.toFixed(0)}%</span>
          </div>
          <p className="text-2xl font-extrabold text-slate-800 mb-3">{formatPesos(datos.fac12mTotal)}</p>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                pctTecho > 100 ? 'bg-red-500' : pctTecho > 80 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(pctTecho, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <p className="text-xs text-slate-300">$0</p>
            <p className="text-xs text-slate-400">Techo: {formatPesos(techo)}</p>
          </div>
        </div>
      )}

      {/* Posición IVA (RI) */}
      {esRI && (
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-4">
            Posición IVA · {MESES[month - 1]} {year}
          </p>
          <div className="grid gap-2.5">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">Neto gravado</span>
              <span className="text-sm font-bold text-slate-700">{formatPesos(datos.netoMes)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">IVA débito fiscal</span>
              <span className="text-sm font-bold text-rose-600">+{formatPesos(datos.ivaDebito)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">IVA crédito fiscal</span>
              <span className="text-sm font-bold text-emerald-600">−{formatPesos(datos.ivaCredito)}</span>
            </div>
            <div className="border-t border-slate-100 pt-2.5 flex justify-between items-center">
              <span className="text-sm font-extrabold text-slate-800">Saldo</span>
              <span className={`text-lg font-extrabold ${saldoIVA > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {saldoIVA > 0
                  ? `${formatPesos(saldoIVA)} a pagar`
                  : `${formatPesos(Math.abs(saldoIVA))} a favor`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Alertas */}
      <div className="grid gap-2">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
          {alertas.length > 0 ? `Inconsistencias (${alertas.length})` : 'Inconsistencias'}
        </p>
        {alertas.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-4 bg-emerald-50 rounded-2xl border border-emerald-100">
            <span className="text-xl">✅</span>
            <p className="text-sm font-medium text-emerald-700">Sin inconsistencias en este período</p>
          </div>
        ) : alertas.map((a, i) => (
          <div key={i} className={`flex items-start gap-3 px-4 py-3.5 rounded-2xl border ${
            a.nivel === 'rojo' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'
          }`}>
            <span className="text-lg shrink-0">{a.icon}</span>
            <div>
              <p className={`text-sm font-bold ${a.nivel === 'rojo' ? 'text-red-700' : 'text-amber-700'}`}>
                {a.titulo}
              </p>
              <p className={`text-xs mt-0.5 ${a.nivel === 'rojo' ? 'text-red-500' : 'text-amber-600'}`}>
                {a.detalle}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Checklist pre-firma */}
      <div className="grid gap-2">
        <div className="flex justify-between items-center">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Checklist pre-firma</p>
          <p className="text-xs font-bold text-slate-400">{checksOk}/{CHECKLIST.length}</p>
        </div>
        {CHECKLIST.map(item => {
          const ok = !!checks[item.id]
          return (
            <button key={item.id} onClick={() => toggle(item.id)}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all active:scale-95 ${
                ok ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                ok ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200'
              }`}>
                {ok && <span className="text-white text-[0.6rem] font-extrabold">✓</span>}
              </div>
              <span className={`text-sm font-medium ${ok ? 'text-emerald-700' : 'text-slate-600'}`}>
                {item.label}
              </span>
            </button>
          )
        })}

        <button
          disabled={checksOk < CHECKLIST.length || hayRojos}
          className={`mt-1 w-full py-4 rounded-3xl font-extrabold text-white shadow-lg transition-all active:scale-95 ${
            hayRojos
              ? 'bg-red-400 shadow-red-100 cursor-not-allowed'
              : checksOk < CHECKLIST.length
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-emerald-600 shadow-emerald-100'
          }`}
        >
          {hayRojos
            ? '🚨 Hay errores críticos pendientes'
            : checksOk < CHECKLIST.length
            ? `Completá el checklist (${checksOk}/${CHECKLIST.length})`
            : '✓ Período listo para presentar'}
        </button>
      </div>

      {/* Certificado ARCA */}
      <CertificadoARCA empresaId={empresaId} />

      {/* Compartir resumen */}
      <div className="grid gap-2 pb-4">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Comunicación</p>
        <button onClick={compartir}
          className={`w-full py-4 rounded-3xl font-extrabold text-base shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2 ${
            copiado
              ? 'bg-emerald-500 text-white shadow-emerald-100'
              : 'bg-white text-slate-700 border border-slate-100'
          }`}
        >
          {copiado ? '✅ Copiado — pegalo en WhatsApp' : '📤 Generar resumen para el cliente'}
        </button>
        <p className="text-xs text-slate-400 text-center">
          Genera un resumen listo para enviar por WhatsApp con todos los datos del período
        </p>
      </div>

    </div>
  )
}
