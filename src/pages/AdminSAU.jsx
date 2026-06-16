import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MODULOS } from '../lib/modulos'

const BASE_URL = 'https://kiosco-carlitos.vercel.app'

// ── Audio helpers ─────────────────────────────────────────────────
function getMimeType() {
  if (typeof MediaRecorder === 'undefined') return 'audio/mp4'
  for (const t of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'])
    if (MediaRecorder.isTypeSupported(t)) return t
  return 'audio/mp4'
}
function getExt(mime) {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('ogg'))  return 'ogg'
  return 'mp4'
}
function formatTiempo(s) {
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`
}
function iniciales(nombre) {
  return (nombre||'?').trim().split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase()
}
function saludo() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

// ── Config de colores por estado ──────────────────────────────────
function burbujaConfig(estado) {
  if (estado === 'resuelta')   return { grad: 'from-emerald-400 to-emerald-600', ring: 'ring-emerald-400', glow: 'shadow-emerald-500/40', label: '✓' }
  if (estado === 'descartada') return { grad: 'from-red-500 to-red-700',         ring: 'ring-red-500',     glow: 'shadow-red-500/40',     label: '✗' }
  if (estado === 'en_proceso') return { grad: 'from-amber-400 to-amber-600',     ring: 'ring-amber-400',   glow: 'shadow-amber-500/40',   label: '…' }
  if (estado === 'confirmado') return { grad: 'from-emerald-400 to-teal-500',    ring: 'ring-teal-400',    glow: 'shadow-teal-500/40',    label: '★' }
  return { grad: 'from-amber-400 to-orange-500', ring: 'ring-amber-400', glow: 'shadow-amber-500/40', label: '!' }
}

// ── Modal: detalle del lead ───────────────────────────────────────
// Se abre al tocar una burbuja. Auto-analiza el audio al abrir.
function ModalLead({ lead, onCerrar, onActualizado, onAutorizar, onVerCliente }) {
  const [analizando, setAnalizando] = useState(false)
  const [analisis,   setAnalisis]   = useState(lead.analisis || null)
  const [copScript,  setCopScript]  = useState(false)
  const [fase,   setFase]  = useState('idle')
  const [segs,   setSegs]  = useState(0)
  const [blobR,  setBlobR] = useState(null)
  const [urlR,   setUrlR]  = useState(null)
  const mrRef  = useRef(null)
  const chunks = useRef([])
  const timerR = useRef(null)
  const mime   = getMimeType()
  const ext    = getExt(mime)

  // ── Auto-analizar al abrir si no hay análisis guardado ──
  useEffect(() => {
    if (!lead.analisis && lead.audio_url) analizar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (fase === 'grabando') timerR.current = setInterval(() => setSegs(s => s + 1), 1000)
    else { clearInterval(timerR.current); if (fase !== 'grabado') setSegs(0) }
    return () => clearInterval(timerR.current)
  }, [fase])

  async function analizar() {
    setAnalizando(true)
    try {
      const { data } = await supabase.functions.invoke('analizar-consulta', { body: { consulta_id: lead.id } })
      if (data?.analisis) { setAnalisis(data.analisis); onActualizado() }
    } catch { alert('Error al analizar') }
    finally { setAnalizando(false) }
  }

  async function grabar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
      mrRef.current = mr; chunks.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: mime || 'audio/mp4' })
        setBlobR(blob); setUrlR(URL.createObjectURL(blob))
        setFase('grabado'); stream.getTracks().forEach(t => t.stop())
      }
      mr.start(); setFase('grabando')
    } catch { alert('Sin acceso al micrófono') }
  }

  async function guardarResp() {
    if (!blobR) return
    setFase('guardando')
    const fn = `respuestas/resp-${lead.id}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('consultas').upload(fn, blobR, { contentType: mime || 'audio/mp4' })
    if (error) { alert('Error al subir'); setFase('grabado'); return }
    const { data: { publicUrl } } = supabase.storage.from('consultas').getPublicUrl(fn)
    await supabase.from('consulta_sau').update({ audio_respuesta_url: publicUrl, estado: 'en_proceso' }).eq('id', lead.id)
    setFase('idle'); setBlobR(null); setUrlR(null); onActualizado()
  }

  async function descartar() {
    await supabase.from('consulta_sau').update({ estado: 'descartada' }).eq('id', lead.id)
    onActualizado(); onCerrar()
  }

  const tel      = lead.telefono?.replace(/\D/g, '')
  const waMsg    = encodeURIComponent(`Hola${lead.nombre ? ` ${lead.nombre.split(' ')[0]}` : ''}! 👋 Soy Facundo de SAU.\nTe grabé una respuesta 👇\n${BASE_URL}/r/${lead.id}`)
  const cfg      = burbujaConfig(lead.estado)
  const esCliente = lead.estado === 'resuelta' && lead.empresa_id_vinculada

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-end justify-center">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-t-[2rem] max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 px-5 pt-5 pb-4 border-b border-zinc-800 flex items-center gap-3 rounded-t-[2rem]">
          <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${cfg.grad} flex items-center justify-center text-white font-extrabold shrink-0 shadow-lg ${cfg.glow}`}>
            {iniciales(lead.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-extrabold text-base">{lead.nombre || 'Anónimo'}</p>
            <p className="text-zinc-500 text-xs">{lead.telefono || 'Sin teléfono'} · {new Date(lead.created_at).toLocaleDateString('es-AR')}</p>
          </div>
          <button onClick={onCerrar} className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-400 text-xl flex items-center justify-center shrink-0">×</button>
        </div>

        <div className="px-5 py-4 grid gap-4">

          {/* Acceso rápido si ya es cliente */}
          {esCliente && (
            <button onClick={() => { onCerrar(); onVerCliente(lead.empresa_id_vinculada, lead) }}
              className="flex items-center justify-between px-4 py-4 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30 active:scale-95 transition-transform">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚀</span>
                <div className="text-left">
                  <p className="text-emerald-400 font-extrabold text-sm">Cliente activo en SAU</p>
                  <p className="text-zinc-500 text-xs">Ver perfil y configuración →</p>
                </div>
              </div>
              <span className="text-emerald-400 text-lg">→</span>
            </button>
          )}

          {/* Audio del cliente */}
          <div>
            <p className="text-zinc-600 text-[0.6rem] font-bold uppercase tracking-widest mb-2">🎤 Audio del cliente</p>
            <audio src={lead.audio_url} controls className="w-full h-10 rounded-xl" style={{ colorScheme: 'dark' }} />
          </div>

          {/* Análisis IA — auto-carga al abrir */}
          {analizando && !analisis ? (
            <div className="flex items-center gap-3 py-4 px-4 bg-zinc-800/60 rounded-2xl">
              <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin shrink-0" />
              <div>
                <p className="text-zinc-200 text-sm font-semibold">Analizando el audio con IA...</p>
                <p className="text-zinc-600 text-xs mt-0.5">Entendiendo el problema para vos</p>
              </div>
            </div>
          ) : analisis ? (
            <div className="bg-zinc-800/60 rounded-2xl p-4 grid gap-3">
              <div className="flex justify-between items-center">
                <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">🤖 Análisis IA</p>
                <button onClick={analizar} disabled={analizando} className="text-[0.6rem] text-zinc-600 hover:text-zinc-400">
                  {analizando ? '...' : 'Re-analizar'}
                </button>
              </div>

              {/* El problema */}
              <div className="bg-zinc-900 rounded-xl px-3 py-3">
                <p className="text-zinc-600 text-[0.6rem] uppercase tracking-widest mb-1.5">Su problema real</p>
                <p className="text-white font-semibold text-sm leading-snug">{analisis.problema_principal}</p>
              </div>

              {/* Puntos de dolor */}
              {analisis.puntos_de_dolor?.length > 0 && (
                <div className="grid gap-1">
                  {analisis.puntos_de_dolor.map((d, i) => (
                    <p key={i} className="text-zinc-400 text-xs flex gap-2">
                      <span className="text-red-500 shrink-0 mt-0.5">•</span>{d}
                    </p>
                  ))}
                </div>
              )}

              {/* Cómo SAU lo resuelve */}
              {analisis.modulos_que_resuelven?.length > 0 && (
                <div>
                  <p className="text-zinc-600 text-[0.6rem] uppercase tracking-widest mb-2">SAU lo resuelve con</p>
                  <div className="flex flex-wrap gap-1.5">
                    {analisis.modulos_que_resuelven.map(id => {
                      const m = MODULOS.find(x => x.id === id)
                      return m ? (
                        <span key={id} className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full ring-1 ring-emerald-500/20">
                          {m.icon} {m.titulo.split(' ')[0]}
                        </span>
                      ) : null
                    })}
                  </div>
                </div>
              )}

              {/* Tu argumento para el audio de respuesta */}
              {analisis.script_para_facundo && (
                <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <p className="text-emerald-500 text-[0.6rem] font-bold uppercase tracking-widest">Tu argumento de venta</p>
                    <button
                      onClick={async () => { await navigator.clipboard.writeText(analisis.script_para_facundo); setCopScript(true); setTimeout(() => setCopScript(false), 2000) }}
                      className={`text-[0.6rem] font-bold transition-colors ${copScript ? 'text-emerald-400' : 'text-zinc-600'}`}>
                      {copScript ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p className="text-emerald-300 text-xs italic leading-relaxed">"{analisis.script_para_facundo}"</p>
                </div>
              )}
            </div>
          ) : (
            <button onClick={analizar}
              className="py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-sm font-bold flex items-center justify-center gap-2 active:scale-95">
              <span>🤖</span><span className="text-zinc-300">Analizar con IA</span>
            </button>
          )}

          {/* Grabar respuesta — solo si no es cliente todavía */}
          {!esCliente && (
            lead.audio_respuesta_url ? (
              <div className="grid gap-2">
                <p className="text-zinc-600 text-[0.6rem] font-bold uppercase tracking-widest">🎙️ Tu respuesta grabada</p>
                <audio src={lead.audio_respuesta_url} controls className="w-full h-10 rounded-xl" style={{ colorScheme: 'dark' }} />
                {tel && (
                  <a href={`https://wa.me/${tel}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
                    className="py-2.5 rounded-xl bg-[#25D366]/10 text-[#25D366] text-sm font-bold text-center">
                    📲 Enviar respuesta por WhatsApp
                  </a>
                )}
              </div>
            ) : fase === 'idle' ? (
              <button onClick={() => setFase('listo')} className="py-3 rounded-2xl bg-zinc-800 text-zinc-500 text-sm font-bold flex items-center justify-center gap-2">
                🎙️ Grabar tu respuesta en audio
              </button>
            ) : fase === 'listo' ? (
              <div className="grid gap-2">
                <button onClick={grabar} className="py-3 rounded-2xl bg-emerald-500/10 text-emerald-400 font-bold ring-1 ring-emerald-500/30">🟢 Empezar a grabar</button>
                <button onClick={() => setFase('idle')} className="text-zinc-700 text-xs text-center py-1">Cancelar</button>
              </div>
            ) : fase === 'grabando' ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-center gap-3 py-1">
                  <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400 font-extrabold text-2xl font-mono">{formatTiempo(segs)}</span>
                </div>
                <button onClick={() => mrRef.current?.stop()} className="py-3 rounded-2xl bg-red-500/10 text-red-400 font-bold ring-1 ring-red-500/30">⬛ Detener</button>
              </div>
            ) : fase === 'grabado' && urlR ? (
              <div className="grid gap-2">
                <audio src={urlR} controls className="w-full h-10 rounded-xl" style={{ colorScheme: 'dark' }} />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setBlobR(null); setUrlR(null); setFase('idle') }} className="py-3 rounded-xl bg-zinc-800 text-zinc-500 font-bold text-sm">Regrabar</button>
                  <button onClick={guardarResp} className="py-3 rounded-xl bg-white text-zinc-900 font-bold text-sm">Guardar ✓</button>
                </div>
              </div>
            ) : fase === 'guardando' ? (
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                <span className="text-zinc-500 text-sm">Subiendo...</span>
              </div>
            ) : null
          )}

          {/* Acciones principales */}
          {!esCliente && lead.estado !== 'descartada' && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button onClick={descartar}
                className="py-4 rounded-2xl bg-red-500/10 text-red-400 font-bold ring-1 ring-red-500/20 active:scale-95">
                ✗ Descartar
              </button>
              <button onClick={() => { onCerrar(); onAutorizar(lead) }}
                className="py-4 rounded-2xl bg-emerald-500 text-white font-extrabold shadow-lg shadow-emerald-500/20 active:scale-95">
                ✅ Crear cliente
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Generador de clave sugerida ───────────────────────────────────
function generarClave() {
  return `SAU-${Math.floor(100000 + Math.random() * 900000)}`
}

// ── Modal: crear cliente ──────────────────────────────────────────
function ModalCrearCliente({ lead, onCerrar, onCreado, onConfigurar }) {
  const [nombre,    setNombre]    = useState(lead.nombre || '')
  const [telefono,  setTelefono]  = useState(lead.telefono || '')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState(() => generarClave())
  const [modulos,   setModulos]   = useState(['ventas', 'caja'])
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)
  const [creado,    setCreado]    = useState(null)

  const OPTS = [
    { id: 'ventas',       icon: '🛒', label: 'Ventas'       },
    { id: 'caja',         icon: '💵', label: 'Caja'         },
    { id: 'presupuestos', icon: '📄', label: 'Presupuestos' },
    { id: 'stock',        icon: '📦', label: 'Stock'        },
    { id: 'fiado',        icon: '📒', label: 'Fiado'        },
    { id: 'compras',      icon: '🛍️', label: 'Compras'     },
    { id: 'equipo',       icon: '👥', label: 'Equipo'       },
  ]

  function toggleMod(id) {
    setModulos(p => p.includes(id) ? p.filter(m => m !== id) : [...p, id])
  }

  async function crear() {
    if (!nombre.trim())   return setError('Ingresá el nombre del negocio')
    if (!telefono.trim()) return setError('Ingresá el WhatsApp')
    setGuardando(true); setError(null)

    if (!email.trim()) return setError('Ingresá el email del cliente')
    if (!password.trim()) return setError('Ingresá la contraseña')

    const { data: fnData, error: fnErr } = await supabase.functions.invoke('crear-cliente', {
      body: {
        nombre_empresa: nombre.trim(),
        email:          email.trim(),
        password:       password.trim(),
        telefono,
        modulos,
        notas_admin:    `Lead audio. Tel: ${telefono}${lead.analisis?.problema_principal ? '\n' + lead.analisis.problema_principal : ''}`,
        onboarding: lead.analisis ? {
          completado:      false,
          nombre_cliente:  lead.nombre || null,
          problema:        lead.analisis.problema_principal || null,
          puntos_de_dolor: lead.analisis.puntos_de_dolor || [],
          modulos:         lead.analisis.modulos_que_resuelven || [],
        } : null,
        consulta_id: lead.id,
      }
    })

    if (fnErr || !fnData?.ok) {
      const msg = fnData?.error || fnErr?.message || 'Error desconocido'
      console.error('crear-cliente error:', msg, fnErr)
      setError(msg)
      setGuardando(false)
      return
    }

    setGuardando(false)
    setCreado(fnData)
  }

  // ── Pantalla de éxito ──────────────────────────────────────────
  if (creado) {
    const tel = telefono.replace(/\D/g, '')
    const msg = encodeURIComponent(
      `Hola ${creado.nombre.split(' ')[0]}! 👋 Soy Facundo de SAU.\n\n` +
      `Tu acceso está listo 🚀\n` +
      `🔗 ${BASE_URL}/login\n` +
      `📧 ${creado.email}\n` +
      `🔑 ${creado.password}\n\n` +
      `Te espera una bienvenida personalizada.\n— SAU`
    )
    return (
      <div className="fixed inset-0 bg-black/95 z-50 flex items-end justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-3xl p-6 grid gap-4">
          <div className="text-center">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-white font-extrabold text-xl">{creado.nombre}</h2>
            <p className="text-emerald-400 text-sm mt-1 font-semibold">¡Cliente creado en SAU!</p>
          </div>
          <div className="bg-zinc-800 rounded-2xl p-4 grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">Email</p>
                <p className="text-white text-sm font-mono mt-0.5 truncate">{creado.email}</p>
              </div>
              <button onClick={() => navigator.clipboard.writeText(creado.email)}
                className="text-zinc-500 text-xs bg-zinc-700 px-2 py-1 rounded-lg shrink-0">Copiar</button>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-zinc-700 pt-3">
              <div>
                <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">Contraseña</p>
                <p className="text-emerald-400 text-xl font-extrabold font-mono mt-0.5 tracking-widest">{creado.password}</p>
              </div>
              <button onClick={() => navigator.clipboard.writeText(creado.password)}
                className="text-zinc-500 text-xs bg-zinc-700 px-2 py-1 rounded-lg shrink-0">Copiar</button>
            </div>
          </div>

          {/* Primario: armar el perfil */}
          <button onClick={() => onConfigurar(creado.empresa_id, lead)}
            className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95">
            🚀 Armar el perfil en SAU
          </button>

          {/* Secundario: WhatsApp */}
          <a href={tel ? `https://wa.me/${tel}?text=${msg}` : `https://wa.me/?text=${msg}`}
            target="_blank" rel="noopener noreferrer"
            className="w-full py-3 rounded-2xl bg-[#25D366]/10 text-[#25D366] font-bold text-sm text-center block active:scale-95">
            📲 Mandar acceso por WhatsApp
          </a>

          <button onClick={() => onCreado()} className="text-zinc-700 text-xs text-center py-1">
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-end justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-3xl p-6 grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-extrabold text-lg">Nuevo cliente</h2>
          <button onClick={onCerrar} className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-400 text-xl flex items-center justify-center">×</button>
        </div>

        {lead.analisis?.problema_principal && (
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl px-4 py-3">
            <p className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-1">Problema detectado</p>
            <p className="text-zinc-300 text-sm leading-snug">{lead.analisis.problema_principal}</p>
          </div>
        )}

        <div className="grid gap-3">
          <input type="text" placeholder="Nombre del negocio *"
            value={nombre} onChange={e => setNombre(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors" />
          <input type="tel" placeholder="WhatsApp *"
            value={telefono} onChange={e => setTelefono(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors" />
        </div>

        {/* ── Credenciales de acceso ─────────────────────────── */}
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-2xl p-3 grid gap-2">
          <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">🔐 Credenciales de acceso</p>
          <input type="email" placeholder="Email *  (ej: fede@sau.app)"
            value={email} onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-indigo-500 transition-colors text-sm" />
          <div className="flex gap-2">
            <input type="text" placeholder="Contraseña *"
              value={password} onChange={e => setPassword(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-indigo-500 transition-colors text-sm font-mono" />
            <button type="button" onClick={() => setPassword(generarClave())}
              className="px-3 py-3 rounded-xl bg-zinc-700 text-zinc-400 text-xs font-bold shrink-0 active:scale-95" title="Generar nueva">
              🎲
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-600 font-semibold uppercase tracking-widest mb-2">Módulos — tildá solo lo que necesita</p>
          <div className="grid grid-cols-3 gap-2">
            {OPTS.map(m => (
              <button key={m.id} onClick={() => toggleMod(m.id)}
                className={`py-2.5 rounded-2xl text-xs font-bold transition-all flex flex-col items-center gap-1 ${
                  modulos.includes(m.id) ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-600'
                }`}>
                <span className="text-lg">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-amber-950/30 border border-amber-500/20 rounded-2xl px-4 py-3 flex items-center gap-3">
          <span>🟡</span>
          <p className="text-amber-500 text-xs font-semibold">Arranca en Modo Práctica — puede probar todo sin riesgo</p>
        </div>

        {error && <p className="text-red-400 text-sm font-semibold text-center">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={onCerrar} className="py-4 rounded-2xl bg-zinc-800 text-zinc-500 font-bold">Cancelar</button>
          <button onClick={crear} disabled={guardando}
            className="py-4 rounded-2xl bg-emerald-500 text-white font-extrabold disabled:opacity-50 active:scale-95 shadow-lg shadow-emerald-500/20">
            {guardando ? 'Creando…' : '✓ Autorizar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Módulos disponibles (para ClientePanel) ───────────────────────
const MODS_ALL = [
  { id: 'ventas',       icon: '🛒', label: 'Ventas'       },
  { id: 'caja',         icon: '💵', label: 'Caja'         },
  { id: 'presupuestos', icon: '📄', label: 'Presupuestos' },
  { id: 'stock',        icon: '📦', label: 'Stock'        },
  { id: 'fiado',        icon: '📒', label: 'Fiado'        },
  { id: 'compras',      icon: '🛍️', label: 'Compras'     },
  { id: 'equipo',       icon: '👥', label: 'Equipo'       },
]

// ── Card de un usuario (editar email + clave) ────────────────────
function UsuarioCard({ usuario, tel, nombreLead, onActualizar }) {
  const [abierto,  setAbierto]  = useState(false)
  const [email,    setEmail]    = useState(usuario.email || '')
  const [clave,    setClave]    = useState('')
  const [guardando,setGuardando]= useState(false)
  const [okMsg,    setOkMsg]    = useState(false)

  async function guardar() {
    const cambios = {}
    if (email.trim() && email.trim() !== usuario.email) cambios.email = email.trim()
    if (clave.trim()) cambios.password = clave.trim()
    if (!Object.keys(cambios).length) { setAbierto(false); return }

    setGuardando(true)
    const ok = await onActualizar(usuario.usuario_id, cambios)
    setGuardando(false)
    if (ok) {
      setOkMsg(true)
      setTimeout(() => { setOkMsg(false); setAbierto(false); setClave('') }, 1500)
    }
  }

  const waMsg = encodeURIComponent(
    `Hola ${usuario.nombre || nombreLead?.split(' ')[0] || ''}! 👋\n\n` +
    `Tu acceso a SAU:\n🔗 ${BASE_URL}/login\n` +
    `📧 ${email || usuario.email || ''}\n` +
    (clave ? `🔑 Contraseña: ${clave}\n` : '') +
    `\n— Facundo`
  )

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Cabecera */}
      <button onClick={() => setAbierto(a => !a)} className="w-full px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99]">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white font-extrabold text-xs shrink-0">
          {iniciales(usuario.nombre || usuario.email || '?')}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-bold truncate">{usuario.nombre || 'Usuario'}</p>
          <p className="text-zinc-500 text-xs font-mono truncate">{usuario.email || 'sin email'}</p>
        </div>
        <span className="text-[0.55rem] font-bold text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full shrink-0">{usuario.rol}</span>
        <span className="text-zinc-700 text-sm shrink-0">{abierto ? '▲' : '▼'}</span>
      </button>

      {/* Editor */}
      {abierto && (
        <div className="px-4 pb-4 grid gap-2 border-t border-zinc-800 pt-3">
          <div>
            <p className="text-zinc-600 text-[0.6rem] uppercase tracking-widest mb-1">Email (usuario)</p>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white outline-none font-mono focus:border-indigo-500" />
          </div>
          <div>
            <p className="text-zinc-600 text-[0.6rem] uppercase tracking-widest mb-1">Contraseña nueva (dejar vacío = no cambiar)</p>
            <div className="flex gap-1.5">
              <input type="text" value={clave} onChange={e => setClave(e.target.value)} placeholder="••••••"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white outline-none font-mono focus:border-indigo-500" />
              <button type="button" onClick={() => setClave(generarClave())}
                className="px-2.5 bg-zinc-700 text-zinc-400 rounded-lg text-xs shrink-0" title="Generar">🎲</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            <button onClick={guardar} disabled={guardando}
              className={`py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${okMsg ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'} disabled:opacity-50`}>
              {guardando ? '...' : okMsg ? '✓ Guardado' : 'Guardar cambios'}
            </button>
            {tel ? (
              <a href={`https://wa.me/${tel}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
                className="py-2.5 rounded-xl text-xs font-bold text-[#25D366] bg-[#25D366]/10 text-center">
                📲 Enviar acceso
              </a>
            ) : (
              <button onClick={() => navigator.clipboard.writeText(`${BASE_URL}/login\n${email}${clave ? '\n' + clave : ''}`)}
                className="py-2.5 rounded-xl text-xs font-bold text-zinc-400 bg-zinc-800">📋 Copiar acceso</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Modal: agregar usuario a la empresa ──────────────────────────
function ModalAgregarUsuario({ onCrear, onCerrar }) {
  const [nombre,   setNombre]   = useState('')
  const [email,    setEmail]    = useState('')
  const [clave,    setClave]    = useState(() => generarClave())
  const [rol,      setRol]      = useState('dueno')
  const [guardando,setGuardando]= useState(false)
  const [error,    setError]    = useState(null)

  async function crear() {
    if (!nombre.trim()) return setError('Ingresá el nombre')
    if (!email.trim())  return setError('Ingresá el email')
    if (!clave.trim())  return setError('Ingresá la contraseña')
    setError(null); setGuardando(true)
    const ok = await onCrear({ nombre: nombre.trim(), email: email.trim(), password: clave.trim(), rol })
    setGuardando(false)
    if (ok) onCerrar()
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[70] flex items-end justify-center p-4" onClick={onCerrar}>
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-3xl p-6 grid gap-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-extrabold text-lg">Nuevo usuario</h3>
          <button onClick={onCerrar} className="text-zinc-500 text-2xl">×</button>
        </div>
        <p className="text-zinc-500 text-xs -mt-2">Cada usuario entra con su propio login y sus movimientos quedan registrados aparte.</p>

        {/* Rol */}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setRol('dueno')}
            className={`py-3 rounded-2xl text-sm font-bold transition-all ${rol === 'dueno' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
            👑 Dueño<br /><span className="text-[0.6rem] font-normal opacity-70">Ve todo y aprueba</span>
          </button>
          <button type="button" onClick={() => setRol('empleado')}
            className={`py-3 rounded-2xl text-sm font-bold transition-all ${rol === 'empleado' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
            🧑‍🔧 Empleado<br /><span className="text-[0.6rem] font-normal opacity-70">Crea, no aprueba</span>
          </button>
        </div>

        <input type="text" placeholder="Nombre (ej: Gonzalo)" value={nombre} onChange={e => setNombre(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-indigo-500 text-sm" />
        <input type="email" placeholder="Email (ej: joaco@sau.app)" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-indigo-500 text-sm" />
        <div className="flex gap-2">
          <input type="text" placeholder="Contraseña" value={clave} onChange={e => setClave(e.target.value)}
            className="flex-1 px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-indigo-500 text-sm font-mono" />
          <button type="button" onClick={() => setClave(generarClave())}
            className="px-3 rounded-2xl bg-zinc-700 text-zinc-400 text-xs shrink-0">🎲</button>
        </div>

        {error && <p className="text-red-400 text-sm text-center font-semibold">{error}</p>}

        <button onClick={crear} disabled={guardando}
          className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-extrabold disabled:opacity-50 active:scale-95">
          {guardando ? 'Creando…' : '✓ Crear usuario'}
        </button>
      </div>
    </div>
  )
}

// ── Actividad de Fiado (vista admin) ─────────────────────────────
function fmtMonto(n) {
  return '$' + Math.abs(Number(n) || 0).toLocaleString('es-AR')
}
function fmtFecha(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function ActividadFiado({ data, cargando }) {
  const [verMovs, setVerMovs] = useState(false)

  if (cargando) return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl py-6 flex justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  )
  if (!data) return null

  const { resumen, clientes, movimientos } = data
  const sinActividad = resumen.total_clientes === 0 && resumen.total_movimientos === 0

  return (
    <div className="grid gap-2">
      <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest px-1">📒 Actividad de Fiado</p>

      {sinActividad ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-5 text-center">
          <p className="text-2xl mb-1">🫥</p>
          <p className="text-zinc-400 text-sm font-semibold">Todavía no cargaron nada</p>
          <p className="text-zinc-600 text-xs mt-1">Sin clientes ni movimientos registrados</p>
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 text-center">
              <p className="text-white text-lg font-extrabold">{resumen.total_clientes}</p>
              <p className="text-zinc-600 text-[0.6rem]">clientes</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 text-center">
              <p className="text-white text-lg font-extrabold">{resumen.total_movimientos}</p>
              <p className="text-zinc-600 text-[0.6rem]">movimientos</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 text-center">
              <p className="text-red-400 text-lg font-extrabold">{fmtMonto(resumen.saldo_total)}</p>
              <p className="text-zinc-600 text-[0.6rem]">deuda total</p>
            </div>
          </div>

          {/* Clientes con saldo */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            {clientes.map(c => (
              <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-2 border-b border-zinc-800 last:border-0">
                <div className="min-w-0">
                  <p className="text-zinc-200 text-sm font-semibold truncate">{c.nombre}</p>
                  {c.telefono && <p className="text-zinc-600 text-[0.65rem]">{c.telefono}</p>}
                </div>
                <div className="text-right shrink-0">
                  {Number(c.saldo_actual) > 0 ? (
                    <p className="text-red-400 text-sm font-extrabold">{fmtMonto(c.saldo_actual)}</p>
                  ) : Number(c.saldo_actual) < 0 ? (
                    <p className="text-emerald-400 text-sm font-extrabold">a favor</p>
                  ) : (
                    <p className="text-emerald-500 text-xs font-bold">✓ al día</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Movimientos (colapsable) */}
          {movimientos.length > 0 && (
            <button onClick={() => setVerMovs(v => !v)}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-left w-full">
              <div className="flex items-center justify-between">
                <p className="text-zinc-400 text-xs font-bold">🧾 Ver últimos movimientos ({movimientos.length})</p>
                <span className="text-zinc-700 text-sm">{verMovs ? '▲' : '▼'}</span>
              </div>
              {verMovs && (
                <div className="mt-3 grid gap-2 pt-3 border-t border-zinc-800">
                  {movimientos.slice(0, 30).map(m => {
                    const esFiado = m.tipo === 'fiado'
                    const cli = clientes.find(c => c.id === m.cliente_fiado_id)
                    return (
                      <div key={m.id} className="flex items-center gap-2.5">
                        <span className="text-base shrink-0">{esFiado ? '🛒' : '💵'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-300 text-xs font-semibold truncate">
                            {cli?.nombre || 'Cliente'} {m.descripcion ? `· ${m.descripcion}` : ''}
                          </p>
                          <p className="text-zinc-600 text-[0.6rem]">
                            {fmtFecha(m.created_at)}
                            {m.registrado_nombre && ` · ${m.registrado_nombre}`}
                          </p>
                        </div>
                        <p className={`text-xs font-extrabold shrink-0 ${esFiado ? 'text-red-400' : 'text-emerald-400'}`}>
                          {esFiado ? '+' : '−'}{fmtMonto(m.monto)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── Configuración del Agente IA de WhatsApp ──────────────────────
const ACCIONES_AGENTE = [
  { id: 'responder_consultas',  label: '💬 Responder consultas' },
  { id: 'crear_presupuesto',    label: '📄 Crear presupuestos' },
  { id: 'registrar_pedido',     label: '🛒 Registrar pedidos' },
  { id: 'consultar_stock',      label: '📦 Consultar stock' },
  { id: 'registrar_venta',      label: '💵 Registrar ventas' },
]

function ConfigAgente({ empresaId }) {
  const [cfg,      setCfg]      = useState(null)
  const [cargando, setCargando] = useState(true)
  const [guardando,setGuardando]= useState(false)
  const [ok,       setOk]       = useState(false)

  useEffect(() => { cargar() }, [empresaId])

  async function cargar() {
    setCargando(true)
    const { data } = await supabase.from('agente_config').select('*').eq('empresa_id', empresaId).maybeSingle()
    setCfg(data || {
      empresa_id: empresaId, nombre: 'Asistente', activo: false,
      whatsapp_numero: '', acciones_permitidas: [], estado: 'pendiente',
    })
    setCargando(false)
  }

  function setCampo(k, v) { setCfg(c => ({ ...c, [k]: v })) }

  function toggleAccion(id) {
    setCfg(c => {
      const acc = c.acciones_permitidas || []
      return { ...c, acciones_permitidas: acc.includes(id) ? acc.filter(a => a !== id) : [...acc, id] }
    })
  }

  async function guardar() {
    setGuardando(true)
    const payload = {
      empresa_id:          empresaId,
      nombre:              (cfg.nombre || 'Asistente').trim(),
      activo:              !!cfg.activo,
      whatsapp_numero:     cfg.whatsapp_numero?.trim() || null,
      acciones_permitidas: cfg.acciones_permitidas || [],
    }
    const { error } = await supabase.from('agente_config').upsert(payload, { onConflict: 'empresa_id' })
    setGuardando(false)
    if (!error) { setOk(true); setTimeout(() => setOk(false), 2000) }
    else alert('No se pudo guardar la config del agente')
  }

  if (cargando) return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 text-zinc-600 text-sm">Cargando agente…</div>
  )

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">🤖 Agente de WhatsApp</p>
        <button onClick={() => setCampo('activo', !cfg.activo)}
          className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-[0.65rem] font-bold transition-all ${
            cfg.activo ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
          }`}>
          <span className={`w-7 h-4 rounded-full relative transition-all ${cfg.activo ? 'bg-emerald-500' : 'bg-zinc-600'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${cfg.activo ? 'left-3.5' : 'left-0.5'}`} />
          </span>
          {cfg.activo ? 'Activo' : 'Pausado'}
        </button>
      </div>

      <div className="grid gap-2">
        <div className="bg-zinc-800/60 rounded-2xl px-3 py-2">
          <p className="text-zinc-500 text-[0.55rem] font-bold uppercase tracking-widest mb-0.5">Nombre del agente</p>
          <input value={cfg.nombre || ''} onChange={e => setCampo('nombre', e.target.value)}
            placeholder="Ej: Antonella"
            className="w-full bg-transparent text-zinc-100 font-bold outline-none placeholder:text-zinc-600" />
        </div>
        <div className="bg-zinc-800/60 rounded-2xl px-3 py-2">
          <p className="text-zinc-500 text-[0.55rem] font-bold uppercase tracking-widest mb-0.5">Número de WhatsApp</p>
          <input value={cfg.whatsapp_numero || ''} onChange={e => setCampo('whatsapp_numero', e.target.value)}
            placeholder="+54 9 387 555 1234"
            className="w-full bg-transparent text-zinc-100 font-bold outline-none placeholder:text-zinc-600" />
        </div>
      </div>

      <div>
        <p className="text-zinc-500 text-[0.55rem] font-bold uppercase tracking-widest mb-2">Qué puede hacer</p>
        <div className="grid gap-1.5">
          {ACCIONES_AGENTE.map(a => {
            const on = (cfg.acciones_permitidas || []).includes(a.id)
            return (
              <button key={a.id} onClick={() => toggleAccion(a.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  on ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'
                }`}>
                {a.label}
                <span className={on ? 'text-emerald-400' : 'text-zinc-600'}>{on ? '✓' : '+'}</span>
              </button>
            )
          })}
        </div>
      </div>

      <button onClick={guardar} disabled={guardando}
        className="w-full py-3 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm active:scale-95 transition-all disabled:opacity-50">
        {guardando ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar agente'}
      </button>

      {cfg.estado && cfg.estado !== 'pendiente' && (
        <p className="text-center text-[0.6rem] text-zinc-600">Estado de conexión: {cfg.estado}</p>
      )}
    </div>
  )
}

// ── Panel del cliente — versión compacta ─────────────────────────
function ClientePanel({ empresaId, lead, onCerrar }) {
  const [empresa,      setEmpresa]      = useState(null)
  const [cargando,     setCargando]     = useState(true)
  const [nota,         setNota]         = useState('')
  const [guardNota,    setGuardNota]    = useState(false)
  const [notaOk,       setNotaOk]       = useState(false)
  const [verContexto,  setVerContexto]  = useState(false)
  const [verScript,    setVerScript]    = useState(false)
  const [usuarios,     setUsuarios]     = useState([])
  const [cargUsuarios, setCargUsuarios] = useState(true)
  const [agregando,    setAgregando]    = useState(false)
  const [actividad,    setActividad]    = useState(null)
  const [cargActiv,    setCargActiv]    = useState(true)
  const [modsOk,       setModsOk]       = useState(false)
  const [razon,        setRazon]        = useState('')
  const [guardRazon,   setGuardRazon]   = useState(false)
  const [razonOk,      setRazonOk]      = useState(false)

  useEffect(() => { cargarEmpresa(); cargarUsuarios(); cargarActividad() }, [empresaId])

  async function cargarEmpresa() {
    setCargando(true)
    const { data } = await supabase.from('empresa').select('*').eq('id', empresaId).single()
    if (data) { setEmpresa(data); setNota(data.notas_admin || ''); setRazon(data.razon_social || '') }
    setCargando(false)
  }

  async function guardarRazon() {
    setGuardRazon(true)
    await supabase.from('empresa').update({ razon_social: razon.trim() }).eq('id', empresa.id)
    setEmpresa(e => ({ ...e, razon_social: razon.trim() }))
    setGuardRazon(false); setRazonOk(true)
    setTimeout(() => setRazonOk(false), 2000)
  }

  async function cargarUsuarios() {
    setCargUsuarios(true)
    const { data } = await supabase.functions.invoke('usuarios-empresa', {
      body: { action: 'listar', empresa_id: empresaId }
    })
    setUsuarios(data?.usuarios || [])
    setCargUsuarios(false)
  }

  async function cargarActividad() {
    setCargActiv(true)
    const { data } = await supabase.functions.invoke('actividad-fiado', {
      body: { empresa_id: empresaId }
    })
    setActividad(data?.ok ? data : null)
    setCargActiv(false)
  }

  async function toggleModulo(modId) {
    const activos = empresa.modulos_activos || []
    const nuevo = activos.includes(modId) ? activos.filter(m => m !== modId) : [...activos, modId]
    // Optimista en pantalla
    setEmpresa(e => ({ ...e, modulos_activos: nuevo }))
    const { error } = await supabase.from('empresa').update({ modulos_activos: nuevo }).eq('id', empresa.id)
    if (error) {
      alert('No se pudo guardar el cambio de módulos')
      setEmpresa(e => ({ ...e, modulos_activos: activos })) // revertir
      return
    }
    setModsOk(true)
    setTimeout(() => setModsOk(false), 1800)
  }

  async function toggleMode() {
    const nuevo = !empresa.modo_simulacion
    await supabase.from('empresa').update({ modo_simulacion: nuevo }).eq('id', empresa.id)
    setEmpresa(e => ({ ...e, modo_simulacion: nuevo }))
  }

  async function cambiarModoPresupuesto(modo) {
    if (empresa.presupuesto_modo === modo) return
    await supabase.from('empresa').update({ presupuesto_modo: modo }).eq('id', empresa.id)
    setEmpresa(e => ({ ...e, presupuesto_modo: modo }))
  }

  async function cambiarModoStock(modo) {
    if ((empresa.modo_stock || 'completo') === modo) return
    await supabase.from('empresa').update({ modo_stock: modo }).eq('id', empresa.id)
    setEmpresa(e => ({ ...e, modo_stock: modo }))
  }

  async function guardarNota() {
    setGuardNota(true)
    await supabase.from('empresa').update({ notas_admin: nota }).eq('id', empresa.id)
    setGuardNota(false); setNotaOk(true)
    setTimeout(() => setNotaOk(false), 2000)
  }

  async function crearUsuario({ nombre, email, password, rol }) {
    const { data } = await supabase.functions.invoke('usuarios-empresa', {
      body: { action: 'crear', empresa_id: empresaId, nombre, email, password, rol: rol || 'dueno' }
    })
    if (!data?.ok) { alert(data?.error || 'No se pudo crear el usuario'); return false }
    await cargarUsuarios()
    return true
  }

  async function actualizarUsuario(usuario_id, cambios) {
    const { data } = await supabase.functions.invoke('usuarios-empresa', {
      body: { action: 'actualizar', usuario_id, ...cambios }
    })
    if (!data?.ok) { alert(data?.error || 'No se pudo actualizar'); return false }
    await cargarUsuarios()
    return true
  }

  if (cargando) return (
    <div className="fixed inset-0 bg-zinc-950 z-[60] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    </div>
  )

  const ob      = empresa?.onboarding
  const analisis = lead?.analisis
  const activos  = empresa?.modulos_activos || []
  const tel      = lead?.telefono?.replace(/\D/g, '')
  const problema = analisis?.problema_principal || ob?.problema

  return (
    <div className="fixed inset-0 bg-zinc-950 z-[60] overflow-y-auto">

      {/* Header */}
      <div className="sticky top-0 bg-zinc-950/98 backdrop-blur border-b border-zinc-800 px-5 py-4 flex items-center gap-3 z-10">
        <button onClick={onCerrar} className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center shrink-0 text-lg">←</button>
        <div className="flex-1 min-w-0">
          <p className="text-zinc-600 text-[0.6rem] font-bold uppercase tracking-widest">Cliente SAU</p>
          <p className="text-white font-extrabold truncate">{empresa?.nombre_fantasia}</p>
        </div>
        <button onClick={toggleMode}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ring-1 transition-all ${
            empresa?.modo_simulacion
              ? 'bg-amber-500/10 text-amber-400 ring-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
          }`}>
          {empresa?.modo_simulacion ? '🟡 Práctica' : '🟢 Real'}
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 grid gap-4">

        {/* ── Módulos ────────────────────────────────────────── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-3">
          <div className="flex items-center justify-between">
            <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">Módulos activos · tildá solo lo que necesita</p>
            {modsOk && <span className="text-emerald-400 text-[0.6rem] font-bold">✓ Guardado</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MODS_ALL.map(m => {
              const on = activos.includes(m.id)
              return (
                <button key={m.id} onClick={() => toggleModulo(m.id)}
                  className={`py-3 rounded-2xl flex flex-col items-center gap-1 text-xs font-bold transition-all active:scale-95 ${
                    on ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-600'
                  }`}>
                  <span className="text-xl">{m.icon}</span>
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Estado rápido ──────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          <div className={`px-4 py-3 rounded-2xl flex items-center gap-2 ${
            ob?.completado ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-amber-500/5 border border-amber-500/20'
          }`}>
            <span>{ob?.completado ? '✅' : '⏳'}</span>
            <p className={`text-xs font-bold ${ob?.completado ? 'text-emerald-400' : 'text-amber-400'}`}>
              {ob?.completado ? 'Bienvenida ok' : 'Bienvenida pendiente'}
            </p>
          </div>
          <div className="px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center gap-2">
            <span>📋</span>
            <p className="text-zinc-400 text-xs font-bold">Docs en proceso</p>
          </div>
        </div>

        {/* ── Razón social (nombre para documentos) ──────────── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
          <div className="flex items-center justify-between">
            <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">Razón social · sale en presupuestos/PDF</p>
            {razonOk && <span className="text-emerald-400 text-[0.6rem] font-bold">✓ Guardado</span>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={razon} onChange={e => setRazon(e.target.value)}
              placeholder="Ej: JDFAR SRL"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
            <button onClick={guardarRazon} disabled={guardRazon || !razon.trim()}
              className="px-4 rounded-xl bg-emerald-500 text-white text-sm font-bold disabled:opacity-40 active:scale-95">
              {guardRazon ? '...' : 'Guardar'}
            </button>
          </div>
        </div>

        {/* ── Modo de presupuesto (si el módulo está activo) ── */}
        {activos.includes('presupuestos') && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
            <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">Modo de presupuesto</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => cambiarModoPresupuesto('items')}
                className={`py-3 rounded-2xl text-xs font-bold transition-all ${(empresa?.presupuesto_modo || 'items') === 'items' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
                🧱 Por ítems<br /><span className="text-[0.55rem] font-normal opacity-70">material por material</span>
              </button>
              <button onClick={() => cambiarModoPresupuesto('plantillas')}
                className={`py-3 rounded-2xl text-xs font-bold transition-all ${empresa?.presupuesto_modo === 'plantillas' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
                📋 Plantillas<br /><span className="text-[0.55rem] font-normal opacity-70">paquetes con precio total</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Modo de stock (si el módulo está activo) ── */}
        {activos.includes('stock') && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4 grid gap-2">
            <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">Modo de stock</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => cambiarModoStock('completo')}
                className={`py-3 rounded-2xl text-xs font-bold transition-all ${(empresa?.modo_stock || 'completo') === 'completo' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
                🔢 Completo<br /><span className="text-[0.55rem] font-normal opacity-70">cuenta unidades y movimientos</span>
              </button>
              <button onClick={() => cambiarModoStock('simple')}
                className={`py-3 rounded-2xl text-xs font-bold transition-all ${empresa?.modo_stock === 'simple' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
                🟢 Simple<br /><span className="text-[0.55rem] font-normal opacity-70">disponible / sin stock</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Agente IA de WhatsApp (si el módulo está activo) ── */}
        {activos.includes('agente') && (
          <ConfigAgente empresaId={empresa.id} />
        )}

        {/* ── Actividad de Fiado ─────────────────────────────── */}
        {activos.includes('fiado') && (
          <ActividadFiado data={actividad} cargando={cargActiv} />
        )}

        {/* ── Problema (colapsable) ───────────────────────────── */}
        {problema && (
          <button onClick={() => setVerContexto(v => !v)}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-left w-full active:scale-[0.99]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-base shrink-0">🧠</span>
                <p className="text-zinc-300 text-sm font-semibold truncate">{problema}</p>
              </div>
              <span className="text-zinc-700 shrink-0 text-sm">{verContexto ? '▲' : '▼'}</span>
            </div>
            {verContexto && (
              <div className="mt-3 grid gap-2 pt-3 border-t border-zinc-800">
                {(analisis?.puntos_de_dolor || ob?.puntos_de_dolor || []).map((d, i) => (
                  <p key={i} className="text-zinc-500 text-xs flex gap-2">
                    <span className="text-red-500 shrink-0">•</span>{d}
                  </p>
                ))}
                {(analisis?.modulos_que_resuelven || ob?.modulos || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(analisis?.modulos_que_resuelven || ob?.modulos).map(id => {
                      const m = MODULOS.find(x => x.id === id)
                      return m ? <span key={id} className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-2 py-0.5 rounded-full">{m.icon} {m.titulo.split(' ')[0]}</span> : null
                    })}
                  </div>
                )}
              </div>
            )}
          </button>
        )}

        {/* ── Script (colapsable) ────────────────────────────── */}
        {analisis?.script_para_facundo && (
          <button onClick={() => setVerScript(v => !v)}
            className="bg-zinc-900 border border-emerald-500/20 rounded-2xl px-4 py-3 text-left w-full active:scale-[0.99]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-emerald-500 text-xs font-bold">💬 Ver argumento de venta</p>
              <span className="text-zinc-700 text-sm">{verScript ? '▲' : '▼'}</span>
            </div>
            {verScript && (
              <p className="text-emerald-300 text-xs italic leading-relaxed mt-2 pt-2 border-t border-zinc-800">
                "{analisis.script_para_facundo}"
              </p>
            )}
          </button>
        )}

        {/* ── Nota rápida ────────────────────────────────────── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 grid gap-2">
          <textarea
            value={nota}
            onChange={e => setNota(e.target.value)}
            placeholder="📝 Nota interna..."
            rows={2}
            className="w-full bg-transparent text-white text-sm placeholder:text-zinc-600 resize-none outline-none"
          />
          <button onClick={guardarNota} disabled={guardNota}
            className={`py-1.5 rounded-xl text-xs font-bold transition-all text-right ${notaOk ? 'text-emerald-400' : 'text-zinc-600'}`}>
            {guardNota ? 'Guardando...' : notaOk ? '✓ Guardado' : 'Guardar'}
          </button>
        </div>

        {/* ── URL de ingreso ─────────────────────────────────── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-zinc-600 text-[0.6rem] uppercase tracking-widest">URL de ingreso</p>
            <p className="text-zinc-300 text-xs font-mono mt-0.5">{BASE_URL}/login</p>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`${BASE_URL}/login`)}
            className="text-zinc-600 text-xs shrink-0 bg-zinc-800 px-2 py-1 rounded-lg">Copiar</button>
        </div>

        {/* ── Usuarios de la empresa ─────────────────────────── */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-zinc-500 text-[0.6rem] font-bold uppercase tracking-widest">
              👥 Usuarios ({usuarios.length})
            </p>
            <button onClick={() => setAgregando(true)}
              className="text-indigo-400 text-xs font-bold bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20 active:scale-95">
              ＋ Agregar
            </button>
          </div>

          {cargUsuarios ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            </div>
          ) : usuarios.length === 0 ? (
            <p className="text-zinc-700 text-xs text-center py-3">Sin usuarios — agregá el primero</p>
          ) : (
            usuarios.map(u => (
              <UsuarioCard
                key={u.usuario_id}
                usuario={u}
                tel={tel}
                nombreLead={lead?.nombre}
                onActualizar={actualizarUsuario}
              />
            ))
          )}
        </div>

        {agregando && (
          <ModalAgregarUsuario
            onCrear={crearUsuario}
            onCerrar={() => setAgregando(false)}
          />
        )}

        <div className="h-4" />
      </div>
    </div>
  )
}

// ── Animación de burbujas ─────────────────────────────────────────
const FLOAT_CSS = `
  @keyframes float {
    0%,100% { transform: translateY(0px); }
    50%      { transform: translateY(-8px); }
  }
  .burbuja-lead { animation: float 3s ease-in-out infinite; }
`

// ── Panel principal Jarvis ────────────────────────────────────────
export default function AdminSAU() {
  const { signOut } = useAuth()
  const [leads,       setLeads]       = useState([])
  const [clientes,    setClientes]    = useState([])
  const [leadAbierto, setLeadAbierto] = useState(null)
  const [modalCrear,  setModalCrear]  = useState(null)
  const [clientePanel, setClientePanel] = useState(null) // { empresaId, lead }
  const [cargando,    setCargando]    = useState(true)

  async function cargar() {
    setCargando(true)
    const [{ data: l }, { data: c }] = await Promise.all([
      supabase.from('consulta_sau').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('empresa').select('id, nombre_fantasia, modo_simulacion, modulos_activos, creado_en').order('creado_en', { ascending: false }).limit(30),
    ])
    setLeads(l || [])
    setClientes(c || [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  const nuevos = leads.filter(l => l.estado === 'nueva').length

  return (
    <div className="min-h-screen bg-zinc-950">
      <style>{FLOAT_CSS}</style>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/50 px-5 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
              <span className="text-white font-extrabold text-sm">S</span>
            </div>
            <div>
              <p className="text-emerald-400 text-[0.6rem] font-bold uppercase tracking-widest">SAU · Jarvis</p>
              <p className="text-white font-extrabold leading-none text-sm">{saludo()}, Facundo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {nuevos > 0 && (
              <span className="bg-red-500 text-white text-xs font-black px-2.5 py-1 rounded-full animate-pulse">
                {nuevos} nuevo{nuevos > 1 ? 's' : ''}
              </span>
            )}
            <button onClick={signOut} className="text-xs text-zinc-600 bg-zinc-800 px-3 py-1.5 rounded-full">Salir</button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 grid gap-8">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Burbujas ── */}
            <div>
              <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest mb-5">
                🎤 Solicitudes de audio
              </p>
              {leads.length === 0 ? (
                <p className="text-zinc-700 text-sm text-center py-8">Sin solicitudes todavía</p>
              ) : (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-8">
                  {leads.map((lead, i) => {
                    const cfg = burbujaConfig(lead.estado)
                    return (
                      <button key={lead.id}
                        onClick={() => setLeadAbierto(lead)}
                        className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
                        <div
                          className={`burbuja-lead w-20 h-20 rounded-full bg-gradient-to-br ${cfg.grad}
                            shadow-xl ${cfg.glow} ring-2 ${cfg.ring} ring-offset-2 ring-offset-zinc-950
                            flex items-center justify-center relative`}
                          style={{ animationDelay: `${i * 0.4}s` }}>
                          <span className="text-white font-black text-xl drop-shadow">{iniciales(lead.nombre)}</span>
                          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center text-xs font-black text-white">
                            {cfg.label}
                          </span>
                        </div>
                        <div className="text-center">
                          <p className="text-zinc-300 text-xs font-semibold max-w-[80px] truncate">{lead.nombre || 'Anónimo'}</p>
                          <p className="text-zinc-600 text-[0.6rem]">
                            {lead.estado === 'nueva'     ? 'Sin ver'    :
                             lead.estado === 'en_proceso' ? 'Respondido' :
                             lead.estado === 'confirmado' ? 'Confirmado' :
                             lead.estado === 'resuelta'   ? 'Cliente ✓'  : 'Descartado'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Clientes activos ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-widest">👥 Clientes activos</p>
                <button
                  onClick={() => setModalCrear({ nombre: '', telefono: '', analisis: null, id: null })}
                  className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-3 py-1.5 rounded-full border border-indigo-500/20 active:scale-95 transition-all">
                  ＋ Nuevo cliente
                </button>
              </div>
              {clientes.length === 0 ? (
                <p className="text-zinc-700 text-sm text-center py-6">Sin clientes todavía</p>
              ) : (
                <div className="grid gap-2">
                  {clientes.map(c => (
                    <button key={c.id}
                      onClick={() => setClientePanel({ empresaId: c.id, lead: null })}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3 w-full text-left active:scale-[0.99] transition-all">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white font-extrabold text-sm shrink-0">
                        {iniciales(c.nombre_fantasia)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-bold text-sm truncate">{c.nombre_fantasia}</p>
                        <p className="text-zinc-600 text-xs">{c.modulos_activos?.length || 0} módulos</p>
                      </div>
                      {c.modo_simulacion && (
                        <span className="text-amber-400 text-[0.6rem] font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">PRÁCTICA</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal: detalle del lead */}
      {leadAbierto && (
        <ModalLead
          lead={leadAbierto}
          onCerrar={() => setLeadAbierto(null)}
          onActualizado={() => {
            cargar()
            // Refrescar el lead abierto con datos frescos
            supabase.from('consulta_sau').select('*').eq('id', leadAbierto.id).single()
              .then(({ data }) => { if (data) setLeadAbierto(data) })
          }}
          onAutorizar={(lead) => setModalCrear(lead)}
          onVerCliente={(empresaId, lead) => setClientePanel({ empresaId, lead })}
        />
      )}

      {/* Modal: crear cliente */}
      {modalCrear && (
        <ModalCrearCliente
          lead={modalCrear}
          onCerrar={() => setModalCrear(null)}
          onCreado={() => { setModalCrear(null); cargar() }}
          onConfigurar={(empresaId, lead) => {
            setModalCrear(null)
            setLeadAbierto(null)
            setClientePanel({ empresaId, lead })
            cargar()
          }}
        />
      )}

      {/* Panel: perfil del cliente */}
      {clientePanel && (
        <ClientePanel
          empresaId={clientePanel.empresaId}
          lead={clientePanel.lead}
          onCerrar={() => { setClientePanel(null); cargar() }}
        />
      )}
    </div>
  )
}
