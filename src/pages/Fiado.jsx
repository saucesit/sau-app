import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatPesos, formatFecha } from '../lib/format'

// ── Helpers ───────────────────────────────────────────────────────
function iniciales(nombre) {
  return nombre.trim().split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

function estadoSaldo(saldo, limite) {
  if (saldo <= 0)                          return 'dia'
  if (limite && saldo >= limite)           return 'limite'
  if (limite && saldo >= limite * 0.8)     return 'alerta'
  return 'debe'
}

const ESTADO = {
  dia:    { texto: 'Al día',          bg: 'bg-emerald-500', anillo: 'ring-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  debe:   { texto: 'Con deuda',       bg: 'bg-red-500',     anillo: 'ring-red-400',     badge: 'bg-red-50 text-red-600 border-red-100' },
  alerta: { texto: 'Cerca del límite',bg: 'bg-amber-400',   anillo: 'ring-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-100' },
  limite: { texto: 'Límite alcanzado',bg: 'bg-red-600',     anillo: 'ring-red-500',     badge: 'bg-red-100 text-red-700 border-red-200' },
}

// ── Modal Nuevo / Editar cliente ──────────────────────────────────
function ModalCliente({ cliente, empresaId, esPractica, onGuardado, onCerrar }) {
  const esEdicion = !!cliente
  const [nombre,   setNombre]   = useState(cliente?.nombre   || '')
  const [telefono, setTelefono] = useState(cliente?.telefono || '')
  const [nota,     setNota]     = useState(cliente?.nota     || '')
  const [limite,   setLimite]   = useState(cliente?.limite_fiado ?? '')
  const [guardando,setGuardando]= useState(false)
  const [error,    setError]    = useState(null)

  async function guardar() {
    if (!nombre.trim()) return setError('El nombre es obligatorio')
    setError(null); setGuardando(true)

    const datos = {
      nombre:       nombre.trim(),
      telefono:     telefono.trim() || null,
      nota:         nota.trim()     || null,
      limite_fiado: limite ? parseFloat(limite) : null,
    }

    if (esEdicion) {
      const { error: err } = await supabase.from('cliente_fiado').update(datos).eq('id', cliente.id)
      setGuardando(false)
      if (err) return setError('No se pudo guardar')
    } else {
      const { error: err } = await supabase.from('cliente_fiado').insert({
        ...datos,
        empresa_id:    empresaId,
        es_simulacion: esPractica,
      })
      setGuardando(false)
      if (err) return setError('No se pudo crear el cliente')
    }
    onGuardado()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-[500px] rounded-t-[2rem] shadow-2xl">
        <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between rounded-t-[2rem]">
          <h2 className="font-extrabold text-slate-800">
            {esEdicion ? 'Editar cliente' : 'Nuevo cliente de fiado'}
          </h2>
          <button onClick={onCerrar} className="text-slate-400 text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100">×</button>
        </div>
        <div className="px-5 py-4 grid gap-3">

          <div className="bg-slate-50 rounded-2xl px-4 py-3">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Nombre o apodo *</p>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} autoFocus
              placeholder="Ej: La Rusa, Pepito, Ramón..."
              className="w-full text-lg font-bold text-slate-800 outline-none bg-transparent placeholder:text-slate-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Teléfono</p>
              <input type="tel" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)}
                placeholder="11 1234-5678"
                className="w-full text-sm font-bold text-slate-700 outline-none bg-transparent placeholder:text-slate-300"
              />
            </div>
            <div className="bg-slate-50 rounded-2xl px-4 py-3">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Límite de fiado</p>
              <div className="flex items-center gap-1">
                <span className="text-slate-300 font-bold text-sm">$</span>
                <input type="number" inputMode="decimal" value={limite} onChange={e => setLimite(e.target.value)}
                  placeholder="Sin límite"
                  className="w-full text-sm font-bold text-slate-700 outline-none bg-transparent placeholder:text-slate-300"
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl px-4 py-3">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">Nota</p>
            <input type="text" value={nota} onChange={e => setNota(e.target.value)}
              placeholder="Ej: Vecina del 4to, viene los sábados..."
              className="w-full text-sm text-slate-600 outline-none bg-transparent placeholder:text-slate-300"
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="grid grid-cols-2 gap-3 pb-2">
            <button onClick={onCerrar} className="py-4 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all">
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              className="py-4 rounded-3xl bg-slate-900 text-white font-extrabold active:scale-95 transition-all disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : esEdicion ? 'Guardar' : 'Agregar cliente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal movimiento (Fiado / Pago) ───────────────────────────────
function ModalMovimiento({ cliente, tipo: tipoInicial, empresaId, esPractica, userId, onGuardado, onCerrar }) {
  const [tipo,      setTipo]      = useState(tipoInicial || 'fiado')
  const [monto,     setMonto]     = useState('')
  const [descripcion,setDesc]     = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  const esFiado = tipo === 'fiado'
  const limite  = cliente.limite_fiado

  async function guardar() {
    const num = parseFloat(monto)
    if (!num || num <= 0) return setError('Ingresá un monto válido')

    // Alerta si supera límite
    if (esFiado && limite && (cliente.saldo_actual + num) > limite) {
      const ok = window.confirm(
        `⚠️ Este fiado supera el límite de ${formatPesos(limite)}.\n¿Querés fiarlo igual?`
      )
      if (!ok) return
    }

    setError(null); setGuardando(true)
    const { error: err } = await supabase.from('movimiento_fiado').insert({
      empresa_id:       empresaId,
      cliente_fiado_id: cliente.id,
      tipo,
      monto:            num,
      descripcion:      descripcion.trim() || null,
      registrado_por:   userId,
      es_simulacion:    esPractica,
    })
    setGuardando(false)
    if (err) return setError('No se pudo registrar')
    onGuardado()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-[500px] rounded-t-[2rem] shadow-2xl">
        <div className="px-5 pt-5 pb-4 border-b border-slate-100 rounded-t-[2rem]">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Registrar movimiento</p>
          <h2 className="font-extrabold text-slate-800 truncate">{cliente.nombre}</h2>
        </div>
        <div className="px-5 py-4 grid gap-4">

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTipo('fiado')}
              className={`py-4 rounded-2xl font-extrabold text-base transition-all active:scale-95 ${
                tipo === 'fiado'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              📝 Le fío
            </button>
            <button onClick={() => setTipo('pago')}
              className={`py-4 rounded-2xl font-extrabold text-base transition-all active:scale-95 ${
                tipo === 'pago'
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              💵 Pagó
            </button>
          </div>

          {/* Monto */}
          <div className={`rounded-2xl px-4 py-4 text-center transition-colors ${
            esFiado ? 'bg-red-50' : 'bg-emerald-50'
          }`}>
            <p className={`text-xs font-semibold uppercase tracking-widest mb-2 ${
              esFiado ? 'text-red-400' : 'text-emerald-500'
            }`}>
              {esFiado ? '¿Cuánto le fiás?' : '¿Cuánto pagó?'}
            </p>
            <div className="flex items-center justify-center gap-2">
              <span className={`text-2xl font-black ${esFiado ? 'text-red-300' : 'text-emerald-300'}`}>$</span>
              <input
                type="number" inputMode="decimal"
                value={monto} onChange={e => setMonto(e.target.value)}
                autoFocus placeholder="0"
                className={`text-5xl font-black outline-none bg-transparent w-40 text-center placeholder:opacity-20 ${
                  esFiado ? 'text-red-600' : 'text-emerald-600'
                }`}
              />
            </div>
            {limite && esFiado && (
              <p className="text-xs text-slate-400 mt-2">
                Saldo actual: <strong className="text-red-500">{formatPesos(cliente.saldo_actual)}</strong>
                {' '}· Límite: <strong>{formatPesos(limite)}</strong>
              </p>
            )}
          </div>

          {/* Descripción */}
          <input type="text" value={descripcion} onChange={e => setDesc(e.target.value)}
            placeholder={esFiado ? '¿Qué llevó? (opcional)' : 'Nota del pago (opcional)'}
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 outline-none text-slate-700 placeholder:text-slate-300"
          />

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="grid grid-cols-2 gap-3 pb-2">
            <button onClick={onCerrar} className="py-4 rounded-3xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all">
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              className={`py-4 rounded-3xl text-white font-extrabold active:scale-95 transition-all disabled:opacity-50 shadow-lg ${
                esFiado
                  ? 'bg-slate-900'
                  : 'bg-emerald-500 shadow-emerald-100'
              }`}
            >
              {guardando ? 'Guardando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pantalla detalle cliente ──────────────────────────────────────
function DetalleCliente({ cliente: clienteInicial, empresaId, esPractica, userId, onVolver, onActualizado }) {
  const [cliente,    setCliente]    = useState(clienteInicial)
  const [movimientos,setMovimientos]= useState([])
  const [cargando,   setCargando]   = useState(true)
  const [modalMov,   setModalMov]   = useState(null)  // 'fiado' | 'pago' | null
  const [modalEdit,  setModalEdit]  = useState(false)

  async function cargar() {
    const [{ data: cl }, { data: movs }] = await Promise.all([
      supabase.from('cliente_fiado').select('*').eq('id', cliente.id).single(),
      supabase.from('movimiento_fiado')
        .select('*')
        .eq('cliente_fiado_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    if (cl) setCliente(cl)
    setMovimientos(movs || [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [cliente.id])

  const estado = estadoSaldo(cliente.saldo_actual, cliente.limite_fiado)
  const est    = ESTADO[estado]

  const headerBg = {
    dia:    'bg-emerald-600',
    debe:   'bg-slate-900',
    alerta: 'bg-amber-500',
    limite: 'bg-red-700',
  }[estado]

  function handleMovGuardado() {
    setModalMov(null)
    cargar()
    onActualizado()
  }

  if (modalEdit) return (
    <ModalCliente
      cliente={cliente}
      empresaId={empresaId}
      esPractica={esPractica}
      onGuardado={() => { setModalEdit(false); cargar(); onActualizado() }}
      onCerrar={() => setModalEdit(false)}
    />
  )

  if (modalMov) return (
    <ModalMovimiento
      cliente={cliente}
      tipo={modalMov}
      empresaId={empresaId}
      esPractica={esPractica}
      userId={userId}
      onGuardado={handleMovGuardado}
      onCerrar={() => setModalMov(null)}
    />
  )

  return (
    <div className="grid gap-4">

      {/* Header del cliente */}
      <div className={`${headerBg} text-white rounded-3xl p-5 shadow-lg`}>
        <button onClick={onVolver} className="text-xs font-bold bg-white/20 px-3 py-1.5 rounded-full mb-4">
          ← Volver
        </button>

        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-extrabold shrink-0">
            {iniciales(cliente.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-extrabold leading-tight truncate">{cliente.nombre}</h2>
            {cliente.telefono && (
              <a href={`tel:${cliente.telefono}`} className="text-white/70 text-sm font-medium">
                📱 {cliente.telefono}
              </a>
            )}
          </div>
          <button onClick={() => setModalEdit(true)}
            className="text-xs font-bold bg-white/20 px-3 py-1.5 rounded-full shrink-0"
          >
            Editar
          </button>
        </div>

        {/* Saldo protagonista */}
        <div className="text-center mb-3">
          <p className="text-xs text-white/60 font-semibold uppercase tracking-widest mb-1">
            {cliente.saldo_actual > 0 ? 'Saldo pendiente' : 'Estado'}
          </p>
          <p className="font-black leading-none"
            style={{ fontSize: 'clamp(2.5rem, 12vw, 3.5rem)' }}
          >
            {cliente.saldo_actual > 0
              ? formatPesos(cliente.saldo_actual)
              : cliente.saldo_actual < 0
              ? `A favor ${formatPesos(Math.abs(cliente.saldo_actual))}`
              : '✓ Al día'
            }
          </p>
        </div>

        {/* Badge + límite */}
        <div className="flex items-center justify-center gap-3">
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${est.badge}`}>
            {est.texto}
          </span>
          {cliente.limite_fiado && (
            <span className="text-xs text-white/60">
              Límite: {formatPesos(cliente.limite_fiado)}
            </span>
          )}
        </div>

        {cliente.nota && (
          <p className="text-white/60 text-xs text-center mt-2 italic">"{cliente.nota}"</p>
        )}
      </div>

      {/* Botones acción */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setModalMov('fiado')}
          className="py-5 rounded-3xl bg-slate-900 text-white font-extrabold text-base active:scale-95 transition-all shadow-lg"
        >
          📝 Le fío algo
        </button>
        <button onClick={() => setModalMov('pago')}
          className="py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-base active:scale-95 transition-all shadow-lg shadow-emerald-100"
        >
          💵 Pagó
        </button>
      </div>

      {/* Historial */}
      <div>
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-3">
          Historial
        </p>
        {cargando && <p className="text-slate-400 text-sm text-center py-6">Cargando…</p>}
        {!cargando && movimientos.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-6">Sin movimientos todavía</p>
        )}
        <div className="grid gap-2">
          {movimientos.map(m => {
            const esFiado = m.tipo === 'fiado'
            return (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${
                esFiado ? 'bg-red-50' : 'bg-emerald-50'
              }`}>
                <span className="text-xl">{esFiado ? '🛒' : '💵'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${esFiado ? 'text-red-700' : 'text-emerald-700'}`}>
                    {m.descripcion || (esFiado ? 'Fiado' : 'Pago')}
                  </p>
                  <p className="text-xs text-slate-400">{formatFecha(m.created_at?.slice(0,10))}</p>
                </div>
                <p className={`text-base font-extrabold ${esFiado ? 'text-red-600' : 'text-emerald-600'}`}>
                  {esFiado ? '+' : '−'}{formatPesos(m.monto)}
                </p>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ── Página principal Fiado ────────────────────────────────────────
export default function Fiado() {
  const { empresaActivaId, empresaActiva, user } = useAuth()
  const esPractica = empresaActiva?.modo_simulacion ?? false

  const [clientes,     setClientes]     = useState([])
  const [cargando,     setCargando]     = useState(true)
  const [busqueda,     setBusqueda]     = useState('')
  const [modalNuevo,   setModalNuevo]   = useState(false)
  const [seleccionado, setSeleccionado] = useState(null)

  async function cargar() {
    if (!empresaActivaId) return
    const { data } = await supabase
      .from('cliente_fiado')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .eq('activo', true)
      .eq('es_simulacion', esPractica)
      .order('saldo_actual', { ascending: false })
    setClientes(data || [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [empresaActivaId, esPractica])

  const clientesFiltrados = useMemo(() => {
    if (!busqueda) return clientes
    const b = busqueda.toLowerCase()
    return clientes.filter(c =>
      c.nombre.toLowerCase().includes(b) ||
      (c.telefono || '').includes(b)
    )
  }, [clientes, busqueda])

  const totalPendiente = useMemo(() =>
    clientes.reduce((s, c) => s + (c.saldo_actual > 0 ? c.saldo_actual : 0), 0)
  , [clientes])

  const conDeuda = clientes.filter(c => c.saldo_actual > 0).length
  const enLimite = clientes.filter(c =>
    c.limite_fiado && c.saldo_actual >= c.limite_fiado
  ).length

  // Si hay un cliente seleccionado, mostramos su detalle
  if (seleccionado) {
    return (
      <DetalleCliente
        cliente={seleccionado}
        empresaId={empresaActivaId}
        esPractica={esPractica}
        userId={user?.id}
        onVolver={() => setSeleccionado(null)}
        onActualizado={cargar}
      />
    )
  }

  return (
    <div className="grid gap-4">

      {/* Header métricas */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-lg">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest mb-1">
          Total pendiente
        </p>
        <p className="font-black mb-4" style={{ fontSize: 'clamp(2.5rem, 12vw, 3.5rem)' }}>
          {formatPesos(totalPendiente)}
        </p>
        <div className="flex gap-4">
          <div>
            <p className="text-2xl font-extrabold">{conDeuda}</p>
            <p className="text-xs text-slate-400">con deuda</p>
          </div>
          <div className="w-px bg-slate-700" />
          <div>
            <p className="text-2xl font-extrabold">{clientes.length}</p>
            <p className="text-xs text-slate-400">clientes</p>
          </div>
          {enLimite > 0 && (
            <>
              <div className="w-px bg-slate-700" />
              <div>
                <p className="text-2xl font-extrabold text-red-400">{enLimite}</p>
                <p className="text-xs text-red-400">en límite</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Buscador */}
      <input
        type="text"
        placeholder="Buscar por nombre o teléfono…"
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl bg-white shadow-sm outline-none text-slate-700 placeholder:text-slate-300"
      />

      {/* Lista clientes */}
      {cargando && <p className="text-center text-slate-400 py-8 text-sm">Cargando…</p>}

      <div className="grid gap-2">
        {clientesFiltrados.map(c => {
          const estado = estadoSaldo(c.saldo_actual, c.limite_fiado)
          const est    = ESTADO[estado]
          return (
            <button key={c.id} onClick={() => setSeleccionado(c)}
              className="bg-white rounded-3xl p-4 shadow-sm text-left w-full active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm text-white shrink-0 ${est.bg}`}>
                  {iniciales(c.nombre)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 truncate">{c.nombre}</p>
                  <p className="text-xs text-slate-400">
                    {c.telefono || 'Sin teléfono'}
                    {c.limite_fiado && ` · Límite ${formatPesos(c.limite_fiado)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {c.saldo_actual > 0 ? (
                    <>
                      <p className="text-base font-extrabold text-red-600">{formatPesos(c.saldo_actual)}</p>
                      <p className="text-xs text-red-400">debe</p>
                    </>
                  ) : c.saldo_actual < 0 ? (
                    <>
                      <p className="text-base font-extrabold text-emerald-600">{formatPesos(Math.abs(c.saldo_actual))}</p>
                      <p className="text-xs text-emerald-500">a favor</p>
                    </>
                  ) : (
                    <span className="text-emerald-500 font-bold text-sm">✓ Al día</span>
                  )}
                </div>
              </div>
              {estado === 'limite' && (
                <div className="mt-2 text-xs font-bold text-red-500 bg-red-50 rounded-xl px-3 py-1.5 text-center">
                  ⚠️ Límite de fiado alcanzado
                </div>
              )}
              {estado === 'alerta' && (
                <div className="mt-2 text-xs font-bold text-amber-600 bg-amber-50 rounded-xl px-3 py-1.5 text-center">
                  Cerca del límite
                </div>
              )}
            </button>
          )
        })}
      </div>

      {!cargando && clientesFiltrados.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-4xl mb-3">📒</p>
          <p className="font-medium">
            {busqueda ? 'No encontramos ese cliente' : 'Todavía no hay clientes de fiado'}
          </p>
          {!busqueda && (
            <p className="text-sm mt-1 text-slate-300">
              Agregá al primero con el botón de abajo
            </p>
          )}
        </div>
      )}

      {/* Botón nuevo cliente */}
      <button onClick={() => setModalNuevo(true)}
        className="w-full py-5 rounded-full bg-slate-900 text-white font-extrabold text-base active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg"
      >
        + Nuevo cliente
      </button>

      {/* Modal */}
      {modalNuevo && (
        <ModalCliente
          empresaId={empresaActivaId}
          esPractica={esPractica}
          onGuardado={() => { setModalNuevo(false); cargar() }}
          onCerrar={() => setModalNuevo(false)}
        />
      )}

    </div>
  )
}
