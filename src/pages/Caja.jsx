import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, hoyISO } from '../lib/format'

export default function Caja() {
  const { empresaActivaId, empresaActiva, user } = useAuth()
  const [tipo, setTipo] = useState('ingreso')
  const [monto, setMonto] = useState('')
  const [concepto, setConcepto] = useState('')
  const [movs, setMovs] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const cargarMovs = useCallback(async () => {
    if (!empresaActivaId) return
    const { data } = await supabase
      .from('movimiento_caja')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .eq('fecha', hoyISO())
      .order('creado_en', { ascending: false })
    setMovs(data || [])
  }, [empresaActivaId])

  useEffect(() => { cargarMovs() }, [cargarMovs])

  const valor = parseFloat((monto || '').replace(',', '.')) || 0
  const saldo = movs.reduce((s, m) => s + (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto)), 0)

  async function guardar() {
    if (valor <= 0) return setError('Ingresá un monto válido')
    if (!concepto.trim()) return setError('Escribí un concepto')
    setError(null)
    setGuardando(true)
    const { error } = await supabase.from('movimiento_caja').insert({
      empresa_id:    empresaActivaId,
      tipo,
      monto:         valor,
      concepto:      concepto.trim(),
      responsable:   user.id,
      es_simulacion: empresaActiva?.modo_simulacion ?? false,
    })
    setGuardando(false)
    if (error) return setError('No se pudo guardar.')
    setMonto(''); setConcepto('')
    cargarMovs()
  }

  return (
    <div className="grid gap-4">

      {/* Saldo del día */}
      <div className="bg-white rounded-3xl px-5 py-4 shadow-sm flex items-center justify-between">
        <p className="text-sm text-slate-400 font-semibold">Saldo del día</p>
        <p className={`text-2xl font-extrabold ${saldo < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
          {formatPesos(saldo)}
        </p>
      </div>

      {/* Ingreso / Egreso */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setTipo('ingreso')}
          className={`rounded-3xl py-5 font-bold transition-all active:scale-95 ${
            tipo === 'ingreso'
              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
              : 'bg-white text-slate-500 shadow-sm'
          }`}
        >
          <span className="text-2xl block mb-1">⬆️</span>
          Ingreso
        </button>
        <button
          onClick={() => setTipo('egreso')}
          className={`rounded-3xl py-5 font-bold transition-all active:scale-95 ${
            tipo === 'egreso'
              ? 'bg-red-500 text-white shadow-lg shadow-red-100'
              : 'bg-white text-slate-500 shadow-sm'
          }`}
        >
          <span className="text-2xl block mb-1">⬇️</span>
          Egreso
        </button>
      </div>

      {/* Formulario */}
      <div className="bg-white rounded-3xl p-5 shadow-sm grid gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-extrabold text-slate-300">$</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="text-3xl font-extrabold text-slate-800 outline-none flex-1 bg-transparent"
          />
        </div>
        <input
          type="text"
          placeholder="Concepto (ej: pago proveedor, retiro)"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-700 placeholder:text-slate-300"
        />
        {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full py-4 rounded-3xl bg-indigo-600 text-white font-extrabold shadow-lg shadow-indigo-200 disabled:opacity-50 active:scale-95 transition-all"
        >
          {guardando ? 'Guardando…' : 'Registrar movimiento'}
        </button>
      </div>

      {/* Movimientos del día */}
      <div className="grid gap-2">
        {movs.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">Sin movimientos hoy 👀</p>
        )}
        {movs.map((m) => (
          <div key={m.id} className="bg-white rounded-3xl px-5 py-4 shadow-sm flex items-center gap-3">
            <span className="text-xl">{m.tipo === 'ingreso' ? '⬆️' : '⬇️'}</span>
            <p className="flex-1 text-sm font-medium text-slate-700">{m.concepto}</p>
            <p className={`font-extrabold ${m.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-500'}`}>
              {m.tipo === 'ingreso' ? '+' : '−'}{formatPesos(m.monto)}
            </p>
          </div>
        ))}
      </div>

    </div>
  )
}
