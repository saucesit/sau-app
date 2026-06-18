import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const BASE_URL = 'https://sau-app.vercel.app'

const ESTADO_CFG = {
  pendiente: { label: 'Pendiente', bg: 'bg-amber-500/15',   text: 'text-amber-400'   },
  aceptado:  { label: 'Aceptado',  bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  rechazado: { label: 'Rechazado', bg: 'bg-red-500/15',     text: 'text-red-400'     },
}

function formatFecha(iso) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}
function formatMonto(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}
function diasDesde(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d === 0) return 'hoy'
  if (d === 1) return 'hace 1 día'
  return `hace ${d} días`
}

// Título de sección — grande y claro
function Seccion({ children }) {
  return <h2 className="text-white font-extrabold text-lg px-1">{children}</h2>
}

export default function Presupuestos() {
  const { empresaActivaId, tienePermiso, profile, empresaActiva } = useAuth()
  const navigate = useNavigate()
  const [presupuestos, setPresupuestos] = useState([])
  const [pedidos,      setPedidos]      = useState([])
  const [cargando,     setCargando]     = useState(true)
  const [linkCopiado,  setLinkCopiado]  = useState(false)

  const puedeAprobar = tienePermiso('empresa.admin')
  const miLink = `${BASE_URL}/pedir/${empresaActivaId}`

  useEffect(() => { cargar() }, [empresaActivaId])

  async function cargar() {
    if (!empresaActivaId) return
    setCargando(true)
    const [{ data: pres }, { data: peds }] = await Promise.all([
      supabase.from('presupuesto')
        .select('id, numero, cliente_nombre, titulo, total, estado, aprobado, enviado, created_at')
        .eq('empresa_id', empresaActivaId)
        .order('created_at', { ascending: false }),
      supabase.from('pedido')
        .select('id, nombre_cliente, telefono, descripcion, created_at')
        .eq('empresa_id', empresaActivaId)
        .eq('estado', 'nuevo')
        .order('created_at', { ascending: false }),
    ])
    setPresupuestos(pres || [])
    setPedidos(peds || [])
    setCargando(false)
  }

  const porAprobar = presupuestos.filter(p => !p.aprobado)
  const aprobados  = presupuestos.filter(p => p.aprobado)

  function compartirLink() {
    const msg = `Pedime tu presupuesto completando acá 👇\n${miLink}`
    if (navigator.share) {
      navigator.share({ text: msg }).catch(() => {})
    } else {
      navigator.clipboard.writeText(miLink)
      setLinkCopiado(true)
      setTimeout(() => setLinkCopiado(false), 2000)
    }
  }

  const pendientes = aprobados.filter(p => p.estado === 'pendiente').length

  // ── Vista del EMPLEADO (Gonzalo): simple, sin precios ni configuración ──
  if (!puedeAprobar) {
    const nombre = profile?.nombre?.split(' ')[0] || ''
    const prioridad = p => (p.aprobado && !p.enviado) ? 0 : !p.aprobado ? 1 : 2
    const lista = [...presupuestos].sort((a, b) => prioridad(a) - prioridad(b))

    const estadoEmpleado = p => {
      if (p.aprobado && !p.enviado) return { txt: '✅ Aprobado — tocá para enviar', cls: 'bg-emerald-500 text-white' }
      if (!p.aprobado)              return { txt: '⏳ Esperando que Fede apruebe',   cls: 'bg-orange-500/15 text-orange-400' }
      return { txt: '📤 Enviado al cliente', cls: 'bg-zinc-800 text-zinc-500' }
    }

    return (
      <div className="grid gap-4 pb-4 pt-1">
        <div>
          <h1 className="text-white font-extrabold text-2xl">{nombre ? `Hola, ${nombre} 👋` : 'Hola 👋'}</h1>
          <p className="text-emerald-400 text-sm font-semibold mt-0.5">
            {empresaActiva?.nombre_fantasia || 'JDFAR'} · Presupuestos
          </p>
        </div>

        <button onClick={() => navigate('/presupuestos/nuevo')}
          className="w-full bg-emerald-500 text-white rounded-3xl py-5 font-extrabold text-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xl shadow-emerald-900/40">
          <span className="text-2xl leading-none">＋</span> Nuevo presupuesto
        </button>

        {cargando ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : presupuestos.length === 0 ? (
          <div className="text-center py-12 grid gap-2">
            <p className="text-6xl">📄</p>
            <p className="text-zinc-300 font-bold text-lg">Todavía no hay presupuestos</p>
            <p className="text-zinc-500 text-sm">Creá uno con el botón verde de arriba</p>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest px-1">Tus presupuestos</p>
            {lista.map(p => {
              const e = estadoEmpleado(p)
              return (
                <button key={p.id} onClick={() => navigate(`/presupuestos/${p.id}`)}
                  className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 grid gap-3 text-left w-full active:scale-[0.99] transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-white font-bold text-base truncate">{p.cliente_nombre}</p>
                      {p.titulo && <p className="text-zinc-500 text-sm truncate mt-0.5">{p.titulo}</p>}
                    </div>
                    <span className="text-zinc-600 text-xs shrink-0 mt-0.5">{formatFecha(p.created_at)}</span>
                  </div>
                  <div className={`text-sm font-bold py-2.5 rounded-xl text-center ${e.cls}`}>{e.txt}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-5 pb-4 pt-1">

      {/* ── Acceso plantillas ──────────────────────────────────── */}
      <button onClick={() => navigate('/presupuestos/plantillas')}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl py-3 px-4 flex items-center gap-3 active:scale-95 transition-all w-full text-left">
        <span className="text-2xl">📋</span>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">Mis plantillas de presupuesto</p>
          <p className="text-zinc-500 text-xs">Editá precios y modelos de trabajo</p>
        </div>
        <span className="text-zinc-600 text-lg">›</span>
      </button>

      {/* ── Mi link de pedidos ─────────────────────────────────── */}
      <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-3xl p-5 text-center shadow-xl shadow-emerald-900/40">
        <p className="text-4xl mb-2">📥</p>
        <p className="text-white font-extrabold text-lg">Tu link de pedidos</p>
        <p className="text-emerald-50/90 text-sm leading-snug mt-1 mb-4">
          Compartilo con tus clientes. Lo que pidan entra acá abajo solo.
        </p>
        <button onClick={compartirLink}
          className="w-full py-3.5 rounded-2xl bg-white text-emerald-700 font-extrabold active:scale-95 transition-all">
          {linkCopiado ? '✓ Link copiado' : '🔗 Compartir mi link'}
        </button>
      </div>

      {/* ── Pedidos entrantes ──────────────────────────────────── */}
      {pedidos.length > 0 && (
        <div className="grid gap-3">
          <Seccion>Pedidos sin responder ({pedidos.length})</Seccion>
          {pedidos.map(p => (
            <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 border-l-4 border-l-orange-400 grid gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-bold truncate">{p.nombre_cliente}</p>
                  <p className="text-orange-400 text-xs font-semibold mt-0.5">⏱ {diasDesde(p.created_at)}</p>
                </div>
                {p.telefono && (
                  <a href={`tel:${p.telefono}`} className="text-emerald-400 text-xs font-bold shrink-0 bg-emerald-500/10 px-3 py-1.5 rounded-full">
                    📞 {p.telefono}
                  </a>
                )}
              </div>
              <p className="text-zinc-400 text-sm leading-snug">{p.descripcion}</p>
              <button
                onClick={() => navigate(`/presupuestos/nuevo?pedido=${p.id}`)}
                className="w-full py-3 rounded-2xl bg-emerald-500 text-white font-bold active:scale-95 transition-all">
                Armar presupuesto →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Para aprobar ───────────────────────────────────────── */}
      {porAprobar.length > 0 && (
        <div className="grid gap-2">
          <Seccion>{puedeAprobar ? `Para aprobar (${porAprobar.length})` : `En revisión (${porAprobar.length})`}</Seccion>
          {porAprobar.map(p => (
            <button key={p.id} onClick={() => navigate(`/presupuestos/${p.id}`)}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 flex items-center gap-3 border-l-4 border-l-orange-400 active:scale-[0.99] transition-all text-left w-full">
              <div className="w-11 h-11 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
                <span className="text-orange-400 font-extrabold text-sm">#{p.numero}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold truncate">{p.cliente_nombre}</p>
                <p className="text-orange-400 text-xs font-semibold mt-0.5">⏳ {puedeAprobar ? 'Esperando tu OK' : 'Esperando aprobación'}</p>
              </div>
              <p className="text-white font-extrabold text-sm shrink-0">{formatMonto(p.total)}</p>
            </button>
          ))}
        </div>
      )}

      {/* ── Resumen ────────────────────────────────────────────── */}
      {aprobados.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total',      val: aprobados.length,                                       color: 'text-white' },
            { label: 'Pendientes', val: pendientes,                                             color: 'text-amber-400' },
            { label: 'Aceptados',  val: aprobados.filter(p => p.estado === 'aceptado').length, color: 'text-emerald-400' },
          ].map(s => (
            <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 text-center">
              <p className={`text-2xl font-extrabold ${s.color}`}>{s.val}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Lista presupuestos ─────────────────────────────────── */}
      {cargando ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      ) : presupuestos.length === 0 ? (
        <div className="text-center py-12 grid gap-2">
          <p className="text-6xl">📄</p>
          <p className="text-zinc-300 font-bold text-lg">Todavía no hay presupuestos</p>
          <p className="text-zinc-500 text-sm">Compartí tu link o creá uno con el botón +</p>
        </div>
      ) : aprobados.length > 0 && (
        <div className="grid gap-3">
          <Seccion>Presupuestos</Seccion>
          <div className="grid gap-2">
            {aprobados.map(p => {
              const cfg = ESTADO_CFG[p.estado] || ESTADO_CFG.pendiente
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/presupuestos/${p.id}`)}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 flex items-center gap-3 active:scale-[0.99] transition-all text-left w-full"
                >
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <span className="text-emerald-400 font-extrabold text-sm">#{p.numero}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{p.cliente_nombre}</p>
                    <p className="text-emerald-500 text-xs font-semibold mt-0.5">✓ Autorizado</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white font-extrabold text-sm">{formatMonto(p.total)}</p>
                    <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${cfg.bg} ${cfg.text}`}>
                      {p.enviado ? '📤 Enviado' : cfg.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => navigate('/presupuestos/nuevo')}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-emerald-500 text-white text-3xl shadow-xl shadow-emerald-500/30 flex items-center justify-center active:scale-95 transition-all z-30"
      >
        +
      </button>

    </div>
  )
}
