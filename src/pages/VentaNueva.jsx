import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos } from '../lib/format'

const MEDIOS = [
  { id: 'efectivo', label: 'Efectivo', icon: '💵' },
  { id: 'tarjeta', label: 'Tarjeta', icon: '💳' },
  { id: 'transferencia', label: 'Transfer.', icon: '🏦' },
  { id: 'mercadopago', label: 'MercadoPago', icon: '📲' },
]

export default function VentaNueva() {
  const { empresaActivaId, empresaActiva, user } = useAuth()
  const navigate = useNavigate()
  const [monto, setMonto] = useState('')
  const [tipoRegistro, setTipoRegistro] = useState('interno')
  const [medioPago, setMedioPago] = useState('efectivo')
  const [descripcion, setDescripcion] = useState('')
  const [guardando,      setGuardando]      = useState(false)
  const [ok,             setOk]             = useState(false)
  const [error,          setError]          = useState(null)
  const [solicitandoCae, setSolicitandoCae] = useState(false)
  const [caeObtenido,    setCaeObtenido]    = useState(null)
  const [caeError,       setCaeError]       = useState(null)

  const valor      = parseFloat((monto || '').replace(',', '.')) || 0
  const esPractica = empresaActiva?.modo_simulacion ?? false

  // Calcula IVA según condición fiscal de la empresa
  const condicion  = empresaActiva?.condicion_fiscal
  const esRI       = condicion === 'responsable_inscripto'
  const ivaCalc    = esRI && tipoRegistro === 'fiscal' ? +(valor - valor / 1.21).toFixed(2) : 0
  const netoCalc   = esRI && tipoRegistro === 'fiscal' ? +(valor / 1.21).toFixed(2) : valor

  async function guardar() {
    if (valor <= 0) return setError('Ingresá un monto válido')
    setError(null)
    setGuardando(true)

    const { data: ventaCreada, error: errInsert } = await supabase
      .from('venta')
      .insert({
        empresa_id:    empresaActivaId,
        tipo_registro: tipoRegistro,
        total:         valor,
        neto:          netoCalc,
        iva:           ivaCalc,
        alicuota_iva:  esRI ? 21 : 0,
        medio_pago:    medioPago,
        descripcion:   descripcion.trim() || null,
        cargado_por:   user.id,
        es_simulacion: esPractica,
      })
      .select('id')
      .single()

    if (errInsert) {
      setGuardando(false)
      return setError('No se pudo guardar. Revisá la conexión.')
    }

    // Solicitar CAE solo si es fiscal y no es simulación
    if (tipoRegistro === 'fiscal' && !esPractica) {
      setGuardando(false)
      setSolicitandoCae(true)
      try {
        const res = await supabase.functions.invoke('solicitar-cae', {
          body: { venta_id: ventaCreada.id, empresa_id: empresaActivaId }
        })
        const data = res.data
        if (data?.ok) {
          setCaeObtenido(data.cae)
        } else {
          setCaeError(data?.error || 'No se pudo obtener el CAE')
        }
      } catch {
        setCaeError('Error de conexión al solicitar CAE')
      }
      setSolicitandoCae(false)
    }

    setGuardando(false)
    setOk(true)
    setMonto(''); setDescripcion('')
    if (tipoRegistro !== 'fiscal' || esPractica) {
      setTimeout(() => navigate('/'), 1200)
    }
  }

  if (ok) {
    return (
      <div className="text-center py-16 px-4 grid gap-4">
        <div>
          <p className="text-6xl mb-3">{caeObtenido ? '🧾' : '✅'}</p>
          <p className="text-xl font-extrabold text-emerald-600">¡Venta registrada!</p>
        </div>

        {solicitandoCae && (
          <div className="bg-indigo-50 rounded-3xl p-5">
            <p className="text-sm font-bold text-indigo-700 animate-pulse">
              Solicitando CAE a ARCA…
            </p>
          </div>
        )}

        {caeObtenido && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-5">
            <p className="text-xs text-emerald-500 font-semibold uppercase tracking-widest mb-1">
              CAE obtenido ✓
            </p>
            <p className="text-xl font-extrabold text-emerald-800 tracking-wider">{caeObtenido}</p>
          </div>
        )}

        {caeError && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4">
            <p className="text-xs font-bold text-amber-700 mb-1">Venta guardada · CAE pendiente</p>
            <p className="text-xs text-amber-600">{caeError}</p>
          </div>
        )}

        <button onClick={() => navigate('/')}
          className="w-full py-4 rounded-3xl bg-slate-100 text-slate-700 font-bold active:scale-95 transition-all"
        >
          Volver al inicio
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-4">

      {/* Monto */}
      <div className="bg-white rounded-3xl p-6 shadow-sm text-center">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">¿Cuánto vendiste?</p>
        <div className="flex items-center justify-center gap-1">
          <span className="text-3xl font-extrabold text-slate-300">$</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            autoFocus
            className="text-5xl font-extrabold text-slate-800 outline-none w-full text-center bg-transparent"
          />
        </div>
        {valor > 0 && <p className="text-sm text-slate-400 mt-2">{formatPesos(valor)}</p>}
      </div>

      {/* Fiscal vs Interno */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setTipoRegistro('fiscal')}
          className={`rounded-3xl py-5 font-bold transition-all active:scale-95 ${
            tipoRegistro === 'fiscal'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
              : 'bg-white text-slate-500 shadow-sm'
          }`}
        >
          <span className="text-2xl block mb-1">🧾</span>
          Fiscal
          <span className="block text-xs font-medium opacity-70 mt-0.5">con factura</span>
        </button>
        <button
          onClick={() => setTipoRegistro('interno')}
          className={`rounded-3xl py-5 font-bold transition-all active:scale-95 ${
            tipoRegistro === 'interno'
              ? 'bg-slate-700 text-white shadow-lg shadow-slate-200'
              : 'bg-white text-slate-500 shadow-sm'
          }`}
        >
          <span className="text-2xl block mb-1">📦</span>
          Interno
          <span className="block text-xs font-medium opacity-70 mt-0.5">sin factura</span>
        </button>
      </div>

      {/* Medio de pago */}
      <div className="grid grid-cols-4 gap-2">
        {MEDIOS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMedioPago(m.id)}
            className={`rounded-2xl py-3 px-1 text-center transition-all active:scale-95 ${
              medioPago === m.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'bg-white text-slate-500 shadow-sm'
            }`}
          >
            <span className="text-xl block">{m.icon}</span>
            <span className="text-[0.6rem] font-semibold mt-0.5 block">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Descripción */}
      <input
        type="text"
        placeholder="Detalle (opcional)"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        className="w-full px-5 py-4 rounded-3xl border-0 outline-none text-slate-700 bg-white shadow-sm placeholder:text-slate-300"
      />

      {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || valor <= 0}
        className="w-full py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-lg shadow-lg shadow-emerald-200 disabled:opacity-40 active:scale-95 transition-all"
      >
        {guardando ? 'Guardando…' : '✓ Guardar venta'}
      </button>

    </div>
  )
}
