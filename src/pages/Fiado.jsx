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
  dia:    { texto: 'Al día',           bg: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-400' },
  debe:   { texto: 'Con deuda',        bg: 'bg-red-500',     badge: 'bg-red-500/15 text-red-400' },
  alerta: { texto: 'Cerca del límite', bg: 'bg-orange-400',  badge: 'bg-orange-500/15 text-orange-400' },
  limite: { texto: 'Límite alcanzado', bg: 'bg-red-600',     badge: 'bg-red-500/20 text-red-300' },
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

  const campo = 'bg-zinc-800 rounded-2xl px-4 py-3'
  const labelCls = 'text-[0.65rem] text-zinc-500 font-bold uppercase tracking-widest mb-1'

  return (
    <div onClick={onCerrar} className="fixed inset-0 bg-black/70 z-[70] flex items-end justify-center">
      <div onClick={e => e.stopPropagation()}
        className="bg-zinc-900 border-t border-zinc-800 w-full max-w-[500px] rounded-t-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto">

        <div className="pt-3 pb-1 flex justify-center"><div className="w-10 h-1.5 bg-zinc-700 rounded-full" /></div>

        <div className="px-6 pt-2 pb-4 text-center relative">
          <h2 className="font-extrabold text-white text-lg">{esEdicion ? 'Editar cliente' : 'Nuevo cliente'}</h2>
          <p className="text-zinc-500 text-xs mt-0.5">Completá los datos del cliente</p>
          <button onClick={onCerrar}
            className="absolute right-5 top-1 text-zinc-500 text-2xl w-9 h-9 flex items-center justify-center rounded-full hover:bg-zinc-800">×</button>
        </div>

        <div className="px-5 grid gap-3">
          <div className={campo}>
            <p className={labelCls}>Nombre o apodo *</p>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} autoFocus
              placeholder="La Rusa, Pepito, Ramón…"
              className="w-full text-base font-bold text-white outline-none bg-transparent placeholder:text-zinc-600 placeholder:font-normal" />
          </div>
          <div className={campo}>
            <p className={labelCls}>Teléfono</p>
            <input type="tel" inputMode="numeric" value={telefono} onChange={e => setTelefono(e.target.value)}
              placeholder="11 1234-5678"
              className="w-full text-base font-bold text-zinc-200 outline-none bg-transparent placeholder:text-zinc-600 placeholder:font-normal" />
          </div>
          <div className={campo}>
            <p className={labelCls}>Límite de fiado</p>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 font-bold text-base">$</span>
              <input type="number" inputMode="decimal" value={limite} onChange={e => setLimite(e.target.value)}
                placeholder="Sin límite"
                className="w-full text-base font-bold text-zinc-200 outline-none bg-transparent placeholder:text-zinc-600 placeholder:font-normal" />
            </div>
          </div>
          <div className={campo}>
            <p className={labelCls}>Nota</p>
            <input type="text" value={nota} onChange={e => setNota(e.target.value)}
              placeholder="Vecina del 4to, viene los sábados…"
              className="w-full text-base text-zinc-300 outline-none bg-transparent placeholder:text-zinc-600" />
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>

        <div className="px-5 pt-4 pb-8 grid grid-cols-2 gap-3">
          <button onClick={onCerrar} className="py-4 rounded-2xl bg-zinc-800 text-zinc-400 font-bold active:scale-95 transition-all">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="py-4 rounded-2xl bg-emerald-500 text-white font-extrabold active:scale-95 transition-all disabled:opacity-50">
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar' : 'Agregar'}
          </button>
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

    if (esFiado && limite && (cliente.saldo_actual + num) > limite) {
      const ok = window.confirm(`⚠️ Este fiado supera el límite de ${formatPesos(limite)}.\n¿Querés fiarlo igual?`)
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
    <div onClick={onCerrar} className="fixed inset-0 bg-black/70 z-[70] flex items-end justify-center">
      <div onClick={e => e.stopPropagation()}
        className="bg-zinc-900 border-t border-zinc-800 w-full max-w-[500px] rounded-t-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto">

        <div className="pt-3 pb-1 flex justify-center"><div className="w-10 h-1.5 bg-zinc-700 rounded-full" /></div>

        <div className="px-6 pt-2 pb-4 text-center relative">
          <p className="text-[0.65rem] text-zinc-500 font-bold uppercase tracking-widest">Registrar movimiento</p>
          <h2 className="font-extrabold text-white truncate text-lg">{cliente.nombre}</h2>
          <button onClick={onCerrar}
            className="absolute right-5 top-1 text-zinc-500 text-2xl w-9 h-9 flex items-center justify-center rounded-full hover:bg-zinc-800">×</button>
        </div>
        <div className="px-5 pb-8 grid gap-4">

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTipo('fiado')}
              className={`py-4 rounded-2xl font-extrabold text-base transition-all active:scale-95 ${
                tipo === 'fiado' ? 'bg-zinc-700 text-white ring-1 ring-zinc-600' : 'bg-zinc-800 text-zinc-500'
              }`}>
              📝 Le fío
            </button>
            <button onClick={() => setTipo('pago')}
              className={`py-4 rounded-2xl font-extrabold text-base transition-all active:scale-95 ${
                tipo === 'pago' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/40' : 'bg-zinc-800 text-zinc-500'
              }`}>
              💵 Pagó
            </button>
          </div>

          {/* Monto */}
          <div className={`rounded-2xl px-4 py-4 text-center transition-colors ${esFiado ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
            <p className={`text-xs font-semibold uppercase tracking-widest mb-2 ${esFiado ? 'text-red-400' : 'text-emerald-400'}`}>
              {esFiado ? '¿Cuánto le fiás?' : '¿Cuánto pagó?'}
            </p>
            <div className="flex items-center justify-center gap-2">
              <span className={`text-2xl font-black ${esFiado ? 'text-red-500/50' : 'text-emerald-500/50'}`}>$</span>
              <input type="number" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)}
                autoFocus placeholder="0"
                className={`text-5xl font-black outline-none bg-transparent w-40 text-center placeholder:opacity-20 ${esFiado ? 'text-red-400' : 'text-emerald-400'}`} />
            </div>
            {limite && esFiado && (
              <p className="text-xs text-zinc-500 mt-2">
                Saldo actual: <strong className="text-red-400">{formatPesos(cliente.saldo_actual)}</strong>
                {' '}· Límite: <strong className="text-zinc-300">{formatPesos(limite)}</strong>
              </p>
            )}
          </div>

          {/* Descripción */}
          <input type="text" value={descripcion} onChange={e => setDesc(e.target.value)}
            placeholder={esFiado ? '¿Qué llevó? (opcional)' : 'Nota del pago (opcional)'}
            className="w-full px-4 py-3 rounded-2xl bg-zinc-800 outline-none text-zinc-200 placeholder:text-zinc-600" />

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <div className="grid grid-cols-2 gap-3 pb-2">
            <button onClick={onCerrar} className="py-4 rounded-3xl bg-zinc-800 text-zinc-400 font-bold active:scale-95 transition-all">
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              className={`py-4 rounded-3xl text-white font-extrabold active:scale-95 transition-all disabled:opacity-50 shadow-lg ${
                esFiado ? 'bg-zinc-700' : 'bg-emerald-500 shadow-emerald-900/40'
              }`}>
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
  const [modalMov,   setModalMov]   = useState(null)
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
    debe:   'bg-zinc-800 border border-zinc-700',
    alerta: 'bg-orange-500',
    limite: 'bg-red-700',
  }[estado]

  function handleMovGuardado() {
    setModalMov(null)
    cargar()
    onActualizado()
  }

  if (modalEdit) return (
    <ModalCliente cliente={cliente} empresaId={empresaId} esPractica={esPractica}
      onGuardado={() => { setModalEdit(false); cargar(); onActualizado() }}
      onCerrar={() => setModalEdit(false)} />
  )

  if (modalMov) return (
    <ModalMovimiento cliente={cliente} tipo={modalMov} empresaId={empresaId} esPractica={esPractica} userId={userId}
      onGuardado={handleMovGuardado} onCerrar={() => setModalMov(null)} />
  )

  return (
    <div className="grid gap-4 pt-1">

      {/* Header del cliente */}
      <div className={`${headerBg} text-white rounded-3xl p-5 shadow-lg`}>
        <button onClick={onVolver} className="text-xs font-bold bg-white/15 px-3 py-1.5 rounded-full mb-4">
          ← Volver
        </button>

        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-xl font-extrabold shrink-0">
            {iniciales(cliente.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-extrabold leading-tight truncate">{cliente.nombre}</h2>
            {cliente.telefono && (
              <a href={`tel:${cliente.telefono}`} className="text-white/70 text-sm font-medium">📱 {cliente.telefono}</a>
            )}
          </div>
          <button onClick={() => setModalEdit(true)}
            className="text-xs font-bold bg-white/15 px-3 py-1.5 rounded-full shrink-0">Editar</button>
        </div>

        <div className="text-center mb-3">
          <p className="text-xs text-white/60 font-semibold uppercase tracking-widest mb-1">
            {cliente.saldo_actual > 0 ? 'Saldo pendiente' : 'Estado'}
          </p>
          <p className="font-black leading-none" style={{ fontSize: 'clamp(2.5rem, 12vw, 3.5rem)' }}>
            {cliente.saldo_actual > 0
              ? formatPesos(cliente.saldo_actual)
              : cliente.saldo_actual < 0
              ? `A favor ${formatPesos(Math.abs(cliente.saldo_actual))}`
              : '✓ Al día'}
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${est.badge}`}>{est.texto}</span>
          {cliente.limite_fiado && (
            <span className="text-xs text-white/60">Límite: {formatPesos(cliente.limite_fiado)}</span>
          )}
        </div>

        {cliente.nota && (
          <p className="text-white/60 text-xs text-center mt-2 italic">"{cliente.nota}"</p>
        )}
      </div>

      {/* Botones acción */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setModalMov('fiado')}
          className="py-5 rounded-3xl bg-zinc-800 border border-zinc-700 text-white font-extrabold text-base active:scale-95 transition-all">
          📝 Le fío algo
        </button>
        <button onClick={() => setModalMov('pago')}
          className="py-5 rounded-3xl bg-emerald-500 text-white font-extrabold text-base active:scale-95 transition-all shadow-lg shadow-emerald-900/40">
          💵 Pagó
        </button>
      </div>

      {/* Historial */}
      <div>
        <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3">Historial</p>
        {cargando && <p className="text-zinc-500 text-sm text-center py-6">Cargando…</p>}
        {!cargando && movimientos.length === 0 && (
          <p className="text-zinc-500 text-sm text-center py-6">Sin movimientos todavía</p>
        )}
        <div className="grid gap-2">
          {movimientos.map(m => {
            const esFiado = m.tipo === 'fiado'
            return (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${esFiado ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
                <span className="text-xl">{esFiado ? '🛒' : '💵'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${esFiado ? 'text-red-400' : 'text-emerald-400'}`}>
                    {m.descripcion || (esFiado ? 'Fiado' : 'Pago')}
                  </p>
                  <p className="text-xs text-zinc-500">{formatFecha(m.created_at?.slice(0,10))}</p>
                </div>
                <p className={`text-base font-extrabold ${esFiado ? 'text-red-400' : 'text-emerald-400'}`}>
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
  const enLimite = clientes.filter(c => c.limite_fiado && c.saldo_actual >= c.limite_fiado).length

  if (seleccionado) {
    return (
      <DetalleCliente cliente={seleccionado} empresaId={empresaActivaId} esPractica={esPractica} userId={user?.id}
        onVolver={() => setSeleccionado(null)} onActualizado={cargar} />
    )
  }

  return (
    <div className="grid gap-4 pt-1">

      {/* Header métricas */}
      <div className="bg-zinc-900 border border-zinc-800 text-white rounded-3xl p-5">
        <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest mb-1">Total pendiente</p>
        <p className="font-black mb-4 text-emerald-400" style={{ fontSize: 'clamp(2.5rem, 12vw, 3.5rem)' }}>
          {formatPesos(totalPendiente)}
        </p>
        <div className="flex gap-4">
          <div>
            <p className="text-2xl font-extrabold">{conDeuda}</p>
            <p className="text-xs text-zinc-500">con deuda</p>
          </div>
          <div className="w-px bg-zinc-700" />
          <div>
            <p className="text-2xl font-extrabold">{clientes.length}</p>
            <p className="text-xs text-zinc-500">clientes</p>
          </div>
          {enLimite > 0 && (
            <>
              <div className="w-px bg-zinc-700" />
              <div>
                <p className="text-2xl font-extrabold text-orange-400">{enLimite}</p>
                <p className="text-xs text-orange-400">en límite</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Buscador */}
      <input type="text" placeholder="Buscar por nombre o teléfono…" value={busqueda} onChange={e => setBusqueda(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 outline-none text-zinc-200 placeholder:text-zinc-600" />

      {cargando && <p className="text-center text-zinc-500 py-8 text-sm">Cargando…</p>}

      <div className="grid gap-2">
        {clientesFiltrados.map(c => {
          const estado = estadoSaldo(c.saldo_actual, c.limite_fiado)
          const est    = ESTADO[estado]
          return (
            <button key={c.id} onClick={() => setSeleccionado(c)}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 text-left w-full active:scale-[0.98] transition-all">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm text-white shrink-0 ${est.bg}`}>
                  {iniciales(c.nombre)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{c.nombre}</p>
                  <p className="text-xs text-zinc-500">
                    {c.telefono || 'Sin teléfono'}
                    {c.limite_fiado && ` · Límite ${formatPesos(c.limite_fiado)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {c.saldo_actual > 0 ? (
                    <>
                      <p className="text-base font-extrabold text-red-400">{formatPesos(c.saldo_actual)}</p>
                      <p className="text-xs text-red-400/70">debe</p>
                    </>
                  ) : c.saldo_actual < 0 ? (
                    <>
                      <p className="text-base font-extrabold text-emerald-400">{formatPesos(Math.abs(c.saldo_actual))}</p>
                      <p className="text-xs text-emerald-400/70">a favor</p>
                    </>
                  ) : (
                    <span className="text-emerald-400 font-bold text-sm">✓ Al día</span>
                  )}
                </div>
              </div>
              {estado === 'limite' && (
                <div className="mt-2 text-xs font-bold text-red-400 bg-red-500/10 rounded-xl px-3 py-1.5 text-center">
                  ⚠️ Límite de fiado alcanzado
                </div>
              )}
              {estado === 'alerta' && (
                <div className="mt-2 text-xs font-bold text-orange-400 bg-orange-500/10 rounded-xl px-3 py-1.5 text-center">
                  Cerca del límite
                </div>
              )}
            </button>
          )
        })}
      </div>

      {!cargando && clientesFiltrados.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-5xl mb-3">📒</p>
          <p className="font-medium text-zinc-300">
            {busqueda ? 'No encontramos ese cliente' : 'Todavía no hay clientes de fiado'}
          </p>
          {!busqueda && <p className="text-sm mt-1 text-zinc-600">Agregá al primero con el botón de abajo</p>}
        </div>
      )}

      {/* Botón nuevo cliente */}
      <button onClick={() => setModalNuevo(true)}
        className="w-full py-5 rounded-full bg-emerald-500 text-white font-extrabold text-base active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/40">
        + Nuevo cliente
      </button>

      {modalNuevo && (
        <ModalCliente empresaId={empresaActivaId} esPractica={esPractica}
          onGuardado={() => { setModalNuevo(false); cargar() }}
          onCerrar={() => setModalNuevo(false)} />
      )}

    </div>
  )
}
