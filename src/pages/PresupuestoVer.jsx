import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { generarPdfPresupuesto } from '../lib/pdfPresupuesto'

const ESTADOS = [
  { id: 'pendiente', label: 'Pendiente', emoji: '⏳', bg: 'bg-orange-500/15',  text: 'text-orange-400',  btn: 'bg-orange-500'  },
  { id: 'aceptado',  label: 'Aceptado',  emoji: '✅', bg: 'bg-emerald-500/15', text: 'text-emerald-400', btn: 'bg-emerald-500' },
  { id: 'rechazado', label: 'Rechazado', emoji: '❌', bg: 'bg-red-500/15',     text: 'text-red-400',     btn: 'bg-red-500'     },
]

function formatFecha(iso) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function formatMonto(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
}

export default function PresupuestoVer() {
  const { id } = useParams()
  const { empresaActiva, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const [pres,     setPres]     = useState(null)
  const [items,    setItems]    = useState([])
  const [cargando, setCargando] = useState(true)
  const [cambiando, setCambiando] = useState(false)
  const [aprobando, setAprobando] = useState(false)
  const puedeAprobar = tienePermiso('empresa.admin')

  async function aprobar() {
    setAprobando(true)
    await supabase.from('presupuesto').update({ aprobado: true }).eq('id', id)
    setPres(p => ({ ...p, aprobado: true }))
    setAprobando(false)
  }

  // Marca el presupuesto como enviado (cierra el flujo de Gonzalo)
  async function marcarEnviado() {
    if (pres?.enviado) return
    await supabase.from('presupuesto').update({ enviado: true }).eq('id', id)
    setPres(p => ({ ...p, enviado: true }))
  }

  useEffect(() => {
    cargar()
  }, [id])

  // Cuando Gonzalo abre un presupuesto con cambios, resetea el flag
  useEffect(() => {
    if (!puedeAprobar && pres?.tiene_cambios) {
      supabase.from('presupuesto').update({ tiene_cambios: false }).eq('id', id)
    }
  }, [pres?.tiene_cambios, puedeAprobar])

  async function cargar() {
    setCargando(true)
    const [{ data: p }, { data: its }] = await Promise.all([
      supabase.from('presupuesto').select('*').eq('id', id).single(),
      supabase.from('presupuesto_item').select('*').eq('presupuesto_id', id).order('orden'),
    ])
    setPres(p); setItems(its || [])
    setCargando(false)
  }

  async function cambiarEstado(nuevoEstado) {
    if (pres.estado === nuevoEstado) return
    setCambiando(true)
    await supabase.from('presupuesto').update({ estado: nuevoEstado }).eq('id', id)
    setPres(p => ({ ...p, estado: nuevoEstado }))
    setCambiando(false)
  }

  function compartirWA() {
    const empresa = empresaActiva?.razon_social || empresaActiva?.nombre_fantasia || 'SAU'
    const fecha   = formatFecha(pres.created_at)
    let msg

    if (pres.titulo) {
      // Formato plantilla (estilo Fede): título + descripción + incluye + extras + condiciones
      const extrasTxt = items.length
        ? '\n*Adicionales:*\n' + items.map(it => `• ${it.descripcion}: ${formatMonto(it.cantidad * it.precio_unitario)}`).join('\n')
        : ''
      msg = [
        `*${pres.titulo}*`,
        `${empresa} — ${fecha}`,
        pres.descripcion ? `\n${pres.descripcion}` : '',
        pres.incluye ? `\n*Incluye:*\n${pres.incluye}` : '',
        extrasTxt,
        `\n💰 *PRECIO TOTAL: ${formatMonto(pres.total)}*`,
        pres.condiciones ? `\n━━━━━━━━━━━━\n${pres.condiciones}` : '',
      ].filter(Boolean).join('\n')
    } else {
      // Formato ítems
      const lineas = items.map(it =>
        `• ${it.descripcion} — ${it.cantidad} ${it.unidad} × ${formatMonto(it.precio_unitario)} = *${formatMonto(it.cantidad * it.precio_unitario)}*`
      ).join('\n')
      msg = [
        `*Presupuesto #${pres.numero} — ${empresa}*`,
        `📅 ${fecha}`,
        pres.descripcion ? `\n📌 ${pres.descripcion}` : '',
        `\n📋 *Detalle:*`,
        lineas,
        `\n━━━━━━━━━━━━`,
        pres.descuento > 0 ? `Descuento: ${pres.descuento}%` : '',
        `💰 *TOTAL: ${formatMonto(pres.total)}*`,
        pres.notas ? `\n_${pres.notas}_` : '',
        `\n_Presupuesto válido por 7 días_`,
      ].filter(Boolean).join('\n')
    }

    const tel = pres.cliente_tel?.replace(/\D/g, '')
    const url = tel
      ? `https://wa.me/549${tel}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
    marcarEnviado()
  }

  async function compartirPDF() {
    const { doc, filename } = generarPdfPresupuesto(pres, items, empresaActiva)
    const blob = doc.output('blob')
    const file = new File([blob], filename, { type: 'application/pdf' })
    const titulo = pres.titulo || `Presupuesto #${pres.numero}`

    // En celular: menú de compartir nativo con el PDF adjunto (se elige WhatsApp)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: titulo })
        marcarEnviado()
        return
      } catch { /* el usuario canceló — no hacemos nada */ return }
    }
    // En PC u otros: descarga el PDF
    doc.save(filename)
    marcarEnviado()
  }

  if (cargando) return (
    <div className="flex justify-center py-20">
      <div className="w-7 h-7 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  )
  if (!pres) return (
    <div className="text-center py-20 text-zinc-500">Presupuesto no encontrado</div>
  )

  const estadoCfg = ESTADOS.find(e => e.id === pres.estado) || ESTADOS[0]
  const subtotal  = items.reduce((a, i) => a + i.cantidad * i.precio_unitario, 0)
  const esPlantilla = !!pres.titulo

  return (
    <div className="grid gap-4 pb-8 pt-1">

      {/* Cabecera */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Presupuesto</p>
            <p className="text-white font-extrabold text-2xl">#{pres.numero}</p>
            <p className="text-zinc-200 font-bold text-lg mt-0.5">{pres.cliente_nombre}</p>
            {pres.cliente_tel && (
              <p className="text-zinc-500 text-sm mt-0.5">📱 {pres.cliente_tel}</p>
            )}
          </div>
          <div className="text-right">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${estadoCfg.bg} ${estadoCfg.text}`}>
              {estadoCfg.emoji} {estadoCfg.label}
            </span>
            <p className="text-zinc-600 text-xs mt-2">{formatFecha(pres.created_at)}</p>
          </div>
        </div>
        {esPlantilla && pres.titulo && (
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <p className="text-white font-bold">{pres.titulo}</p>
          </div>
        )}
      </div>

      {esPlantilla ? (
        /* ── Vista PLANTILLA (estilo Fede) ── */
        <>
          {pres.descripcion && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
              <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">{pres.descripcion}</p>
            </div>
          )}

          {pres.incluye && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
              <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Incluye</p>
              <div className="grid gap-1">
                {pres.incluye.split('\n').filter(Boolean).map((l, i) => (
                  <p key={i} className="text-zinc-200 text-sm flex gap-2"><span className="text-emerald-400">✓</span>{l}</p>
                ))}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
              <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Adicionales</p>
              {items.map(it => (
                <div key={it.id} className="flex items-center justify-between gap-3">
                  <p className="text-zinc-200 text-sm">{it.descripcion}</p>
                  <p className="text-zinc-200 font-extrabold text-sm shrink-0">{formatMonto(it.cantidad * it.precio_unitario)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 flex justify-between items-center">
            <span className="text-white font-extrabold text-lg">PRECIO TOTAL</span>
            <span className="text-emerald-400 font-extrabold text-2xl">{formatMonto(pres.total)}</span>
          </div>

          {pres.condiciones && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-1">
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-1">Condiciones de venta</p>
              <p className="text-zinc-400 text-sm leading-relaxed whitespace-pre-line">{pres.condiciones}</p>
            </div>
          )}
        </>
      ) : (
        /* ── Vista ÍTEMS ── */
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Detalle</p>
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-3 py-2 border-b border-zinc-800 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">{it.descripcion}</p>
                <p className="text-zinc-500 text-xs mt-0.5">{it.cantidad} {it.unidad} × {formatMonto(it.precio_unitario)}</p>
              </div>
              <p className="text-zinc-200 font-extrabold text-sm shrink-0">{formatMonto(it.cantidad * it.precio_unitario)}</p>
            </div>
          ))}
          <div className="border-t-2 border-zinc-700 pt-3 grid gap-1.5">
            {pres.descuento > 0 && (
              <>
                <div className="flex justify-between text-zinc-400 text-sm"><span>Subtotal</span><span>{formatMonto(subtotal)}</span></div>
                <div className="flex justify-between text-orange-400 text-sm"><span>Descuento {pres.descuento}%</span><span>- {formatMonto(subtotal * pres.descuento / 100)}</span></div>
              </>
            )}
            <div className="flex justify-between items-center">
              <span className="text-white font-extrabold text-lg">TOTAL</span>
              <span className="text-emerald-400 font-extrabold text-2xl">{formatMonto(pres.total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Notas */}
      {pres.notas && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl px-4 py-3">
          <p className="text-orange-300 text-sm italic">📝 {pres.notas}</p>
        </div>
      )}

      {/* ── Alerta de cambios (solo Gonzalo) ──────────────── */}
      {!puedeAprobar && pres.tiene_cambios && (
        <div className="bg-amber-500/15 border border-amber-500/30 rounded-2xl px-4 py-3 flex items-center gap-3">
          <span className="text-2xl shrink-0">✏️</span>
          <p className="text-amber-300 font-bold text-sm">Fede modificó este presupuesto. Revisá los cambios antes de enviarlo.</p>
        </div>
      )}

      {/* ── Botón editar (solo Fede) ───────────────────────── */}
      {puedeAprobar && (
        <button onClick={() => navigate(`/presupuestos/${id}/editar`)}
          className="w-full py-3.5 rounded-2xl border border-zinc-700 text-zinc-300 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
          ✏️ Editar presupuesto
        </button>
      )}

      {/* ── Candado de aprobación ──────────────────────────── */}
      {!pres.aprobado && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-3xl p-4 grid gap-3 text-center">
          <p className="text-orange-400 font-extrabold">⏳ Pendiente de aprobación</p>
          {puedeAprobar ? (
            <>
              <p className="text-zinc-400 text-sm">Revisá el presupuesto. Si está OK, aprobalo para poder enviarlo.</p>
              <button onClick={aprobar} disabled={aprobando}
                className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-extrabold active:scale-95 transition-all disabled:opacity-50">
                {aprobando ? 'Aprobando…' : '✓ Aprobar presupuesto'}
              </button>
            </>
          ) : (
            <p className="text-zinc-400 text-sm">Esperando que el dueño lo revise y apruebe antes de enviarlo al cliente.</p>
          )}
        </div>
      )}

      {/* ── Cambiar estado del cliente (solo admin) ──────────── */}
      {pres.aprobado && puedeAprobar && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
          <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Respuesta del cliente</p>
          <div className="grid grid-cols-3 gap-2">
            {ESTADOS.map(e => (
              <button key={e.id} onClick={() => cambiarEstado(e.id)} disabled={cambiando}
                className={`py-3 rounded-xl text-xs font-extrabold transition-all active:scale-95 ${
                  pres.estado === e.id ? `${e.btn} text-white shadow-md` : 'bg-zinc-800 text-zinc-500'
                }`}>
                {e.emoji}<br />{e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Enviar (empleado y admin cuando está aprobado) ────── */}
      {pres.aprobado && (
        <>
          <button onClick={compartirPDF}
            className="w-full py-4 rounded-2xl bg-[#25D366] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-lg shadow-green-900/40 active:scale-95 transition-all">
            📄 Enviar PDF por WhatsApp
          </button>
          <button onClick={compartirWA}
            className="w-full py-2.5 rounded-2xl bg-zinc-800 text-zinc-400 font-bold text-sm active:scale-95 transition-all">
            Enviar solo texto
          </button>
        </>
      )}

      <button onClick={() => navigate('/presupuestos')}
        className="w-full py-3 rounded-2xl bg-zinc-800 text-zinc-300 font-bold active:scale-95 transition-all">
        ← Ver todos los presupuestos
      </button>

    </div>
  )
}
