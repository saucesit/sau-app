import { useState, useEffect } from 'react'

const STORAGE_KEY = 'kiosco_carlitos_data'
const USER_KEY = 'kiosco_carlitos_user'

const USUARIOS = [
  { id: 'carlos',   nombre: 'Carlos',   emoji: '👴', color: '#002F6C' },
  { id: 'joaquin',  nombre: 'Joaquín',  emoji: '👦', color: '#1a6b3a' },
  { id: 'luciana',  nombre: 'Luciana',  emoji: '👩', color: '#8b2fc9' },
]

function cargarDatos() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
  catch { return [] }
}
function guardarDatos(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) }
function formatPesos(n) { return '$' + Math.abs(n).toLocaleString('es-AR') }
function formatFecha(f) { return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
function getSaldo(c) { return c.movimientos.reduce((s, m) => s + m.monto, 0) }
function getUsuario(id) { return USUARIOS.find(u => u.id === id) }

// ──────────────────────────────────────────────
//  PANTALLA SELECCIÓN DE USUARIO
// ──────────────────────────────────────────────
function SeleccionUsuario({ onSeleccionar }) {
  return (
    <div style={{
      maxWidth: 500, margin: '0 auto', minHeight: '100vh',
      background: 'var(--primary)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px'
    }}>
      <p style={{ fontSize: '3rem', marginBottom: 8 }}>⚽</p>
      <h1 style={{ color: 'var(--accent)', fontSize: '1.8rem', fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
        Kiosco de Carlitos
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem', marginBottom: 40 }}>
        ¿Quién está atendiendo?
      </p>

      <div style={{ width: '100%', display: 'grid', gap: 14 }}>
        {USUARIOS.map(u => (
          <button
            key={u.id}
            onClick={() => onSeleccionar(u.id)}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '2px solid rgba(245,197,24,0.3)',
              borderRadius: 18, padding: '18px 24px',
              display: 'flex', alignItems: 'center', gap: 16,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.2s', width: '100%'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(245,197,24,0.15)'
              e.currentTarget.style.borderColor = 'var(--accent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.borderColor = 'rgba(245,197,24,0.3)'
            }}
          >
            <div style={{
              width: 54, height: 54, borderRadius: '50%',
              background: u.color,
              border: '3px solid var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.6rem', flexShrink: 0
            }}>{u.emoji}</div>
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem' }}>{u.nombre}</p>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>Tocar para entrar</p>
            </div>
            <span style={{ color: 'var(--accent)', marginLeft: 'auto', fontSize: '1.3rem' }}>→</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  PANTALLA PRINCIPAL
// ──────────────────────────────────────────────
function Inicio({ clientes, onVer, onNuevo, usuario, onCambiarUsuario }) {
  const u = getUsuario(usuario)
  const [q, setQ] = useState('')
  const total = clientes.reduce((s, c) => { const x = getSaldo(c); return s + (x > 0 ? x : 0) }, 0)
  const lista = clientes
    .filter(c => c.nombre.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => getSaldo(b) - getSaldo(a))

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{
        background: 'var(--primary)',
        color: 'white',
        padding: '20px 20px 28px',
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        boxShadow: 'var(--shadow)',
        position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: '0.8rem', color: '#F5C518', fontWeight: 600 }}>⚽ ¡Dale Dale Boca! 💙💛</p>
          <button onClick={onCambiarUsuario} style={{
            background: 'rgba(245,197,24,0.15)', border: '1px solid rgba(245,197,24,0.4)',
            borderRadius: 20, padding: '5px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit'
          }}>
            <span style={{ fontSize: '1rem' }}>{u.emoji}</span>
            <span style={{ color: 'white', fontSize: '0.8rem', fontWeight: 600 }}>{u.nombre}</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>cambiar</span>
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: 0.5 }}>Kiosco de Carlitos</h1>
            <p style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 2 }}>Cuentas corrientes</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>Total pendiente</p>
            <p style={{ fontSize: '1.4rem', fontWeight: 800, color: '#F5C518' }}>{formatPesos(total)}</p>
          </div>
        </div>
      </div>

      {/* Buscador */}
      <div style={{ padding: '16px 20px 8px' }}>
        <div style={{
          background: 'white',
          display: 'flex', alignItems: 'center',
          padding: '12px 18px',
          borderRadius: 30,
          boxShadow: 'var(--shadow)',
          gap: 10
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>🔍</span>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar cliente..."
            style={{
              border: 'none', outline: 'none', flex: 1,
              fontSize: '1rem', fontFamily: 'inherit', color: 'var(--text)'
            }}
          />
          {q && (
            <button onClick={() => setQ('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Clientes */}
      <div style={{ padding: '8px 20px 100px', display: 'grid', gap: 10 }}>
        {lista.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '3rem', marginBottom: 8 }}>🛒</p>
            <p>{q ? 'No encontré ese cliente' : 'Todavía no hay clientes'}</p>
          </div>
        )}
        {lista.map(c => {
          const saldo = getSaldo(c)
          return (
            <button key={c.id} onClick={() => onVer(c.id)} style={{
              background: 'white', border: 'none', cursor: 'pointer',
              padding: 15, borderRadius: 15,
              display: 'flex', alignItems: 'center', gap: 14,
              boxShadow: 'var(--shadow)', transition: 'transform 0.15s',
              textAlign: 'left', width: '100%'
            }}
              onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              {/* Avatar */}
              <div style={{
                width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                background: saldo > 0 ? '#dc3545' : saldo < 0 ? 'var(--accent)' : '#aaa',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 800, fontSize: '1.2rem'
              }}>
                {c.nombre[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>{c.nombre}</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {c.movimientos.length} movimiento{c.movimientos.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                {saldo > 0
                  ? <span style={{ color: '#dc3545', fontWeight: 700, fontSize: '0.95rem' }}>{formatPesos(saldo)}<br /><span style={{ fontSize: '0.7rem', fontWeight: 500 }}>debe</span></span>
                  : saldo < 0
                  ? <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.95rem' }}>a favor</span>
                  : <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>✓ al día</span>
                }
              </div>
            </button>
          )
        })}
      </div>

      {/* FAB */}
      <button onClick={onNuevo} style={{
        position: 'fixed', bottom: 24, right: 24,
        width: 60, height: 60, borderRadius: '50%',
        background: 'var(--accent)', color: 'var(--primary)', border: 'none',
        fontSize: '2rem', fontWeight: 900, cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(245,197,24,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>+</button>
    </div>
  )
}

// ──────────────────────────────────────────────
//  DETALLE CLIENTE
// ──────────────────────────────────────────────
function Detalle({ cliente, onVolver, onActualizar, usuario }) {
  const [modo, setModo] = useState(null)
  const [monto, setMonto] = useState('')
  const [desc, setDesc] = useState('')
  const saldo = getSaldo(cliente)
  const u = getUsuario(usuario)

  function guardar() {
    const n = parseFloat(monto.replace(',', '.'))
    if (!n || n <= 0) return alert('Ingresá un monto válido')
    const mov = {
      id: Date.now(), fecha: new Date().toISOString(),
      monto: modo === 'fiado' ? n : -n,
      descripcion: desc.trim() || (modo === 'fiado' ? 'Fiado' : 'Pago'),
      usuario: usuario,
    }
    onActualizar({ ...cliente, movimientos: [mov, ...cliente.movimientos] })
    setMonto(''); setDesc(''); setModo(null)
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{
        background: saldo > 0 ? '#c0392b' : saldo < 0 ? '#1e7e34' : 'var(--primary)',
        color: 'white', padding: '20px 20px 28px',
        borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
        boxShadow: 'var(--shadow)'
      }}>
        <button onClick={onVolver} style={{
          background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
          padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
          fontSize: '0.85rem', marginBottom: 16, fontFamily: 'inherit'
        }}>← Volver</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 54, height: 54, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', fontWeight: 800, color: 'white'
          }}>
            {cliente.nombre[0].toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>{cliente.nombre}</h2>
            {saldo > 0
              ? <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>Debe <strong>{formatPesos(saldo)}</strong></p>
              : saldo < 0
              ? <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>A favor <strong>{formatPesos(Math.abs(saldo))}</strong></p>
              : <p style={{ opacity: 0.85, fontSize: '0.9rem' }}>✓ Sin deuda</p>
            }
          </div>
        </div>
      </div>

      {/* Info del cliente */}
      {(cliente.telefono || cliente.nota || cliente.limite) && (
        <div style={{ margin: '14px 20px 0', background: 'white', borderRadius: 15, padding: '14px 16px', boxShadow: 'var(--shadow)', display: 'grid', gap: 8 }}>
          {cliente.telefono && (
            <a href={`tel:${cliente.telefono}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
              <span style={{ fontSize: '1.1rem' }}>📱</span>
              <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '0.95rem' }}>{cliente.telefono}</span>
            </a>
          )}
          {cliente.limite && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.1rem' }}>💰</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Límite: <strong style={{ color: saldo >= cliente.limite ? '#dc3545' : 'var(--accent)' }}>{formatPesos(cliente.limite)}</strong>
                {saldo >= cliente.limite && <span style={{ color: '#dc3545', fontWeight: 700, marginLeft: 6 }}>⚠️ Límite alcanzado</span>}
              </span>
            </div>
          )}
          {cliente.nota && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: '1.1rem' }}>📝</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{cliente.nota}</span>
            </div>
          )}
        </div>
      )}

      {/* Botones */}
      <div style={{ padding: '14px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button onClick={() => setModo('fiado')} style={{
          background: 'var(--primary)', color: 'var(--accent)', border: '2px solid var(--accent)',
          padding: '16px', borderRadius: 15, fontSize: '1rem',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
        }}>📝 Le fío algo</button>
        <button onClick={() => setModo('pago')} style={{
          background: 'var(--accent)', color: 'var(--primary)', border: 'none',
          padding: '16px', borderRadius: 15, fontSize: '1rem',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
        }}>💵 Pagó</button>
      </div>

      {/* Formulario */}
      {modo && (
        <div style={{
          margin: '14px 20px 0', background: 'white',
          borderRadius: 15, padding: 18, boxShadow: 'var(--shadow)'
        }}>
          <p style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: 12 }}>
            {modo === 'fiado' ? '📝 ¿Cuánto le fiás?' : '💵 ¿Cuánto pagó?'}
          </p>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700 }}>$</span>
            <input
              type="number" inputMode="decimal"
              placeholder="0"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              autoFocus
              style={{
                width: '100%', paddingLeft: 30, paddingRight: 14, paddingTop: 14, paddingBottom: 14,
                border: '1px solid #ddd', borderRadius: 10,
                fontSize: '1.5rem', fontWeight: 700, fontFamily: 'inherit',
                outline: 'none', color: 'var(--text)'
              }}
            />
          </div>
          <input
            type="text"
            placeholder="¿Qué llevó? (opcional)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            style={{
              width: '100%', padding: '12px 14px',
              border: '1px solid #ddd', borderRadius: 10,
              fontSize: '0.95rem', fontFamily: 'inherit',
              outline: 'none', marginBottom: 12, color: 'var(--text)'
            }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setModo(null)} style={{
              flex: 1, padding: '13px', background: '#e0e0e0', border: 'none',
              borderRadius: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
            }}>Cancelar</button>
            <button onClick={guardar} style={{
              flex: 2, padding: '13px', border: 'none',
              background: modo === 'fiado' ? '#dc3545' : 'var(--accent)',
              color: 'white', borderRadius: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: '1rem'
            }}>Guardar ✓</button>
          </div>
        </div>
      )}

      {/* Historial */}
      <div style={{ padding: '16px 20px 40px' }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Historial
        </p>
        {cliente.movimientos.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>Nada por acá todavía 👀</p>
        )}
        {cliente.movimientos.map(m => (
          <div key={m.id} style={{
            background: 'white', borderRadius: 15, padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: 'var(--shadow)', marginBottom: 8
          }}>
            <span style={{ fontSize: '1.3rem' }}>{m.monto > 0 ? '🛒' : '💵'}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>{m.descripcion}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {formatFecha(m.fecha)}
                {m.usuario && (() => { const mu = getUsuario(m.usuario); return mu ? <span style={{ marginLeft: 6 }}>{mu.emoji} {mu.nombre}</span> : null })()}
              </p>
            </div>
            <p style={{ fontWeight: 800, fontSize: '1rem', color: m.monto > 0 ? '#dc3545' : 'var(--accent)' }}>
              {m.monto > 0 ? '+' : '-'}{formatPesos(m.monto)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  MODAL NUEVO CLIENTE
// ──────────────────────────────────────────────
function ModalNuevo({ onGuardar, onCancelar }) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [nota, setNota] = useState('')
  const [limite, setLimite] = useState('')

  const inputStyle = {
    width: '100%', padding: '13px 16px',
    border: '1px solid #ddd', borderRadius: 12,
    fontSize: '0.95rem', fontFamily: 'inherit',
    outline: 'none', color: 'var(--text)',
    marginBottom: 10
  }

  function guardar() {
    if (!nombre.trim()) return alert('El nombre es obligatorio')
    onGuardar({
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      nota: nota.trim(),
      limite: limite ? parseFloat(limite) : null,
    })
  }

  return (
    <div onClick={onCancelar} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center', zIndex: 1000,
      overflowY: 'auto'
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', width: '100%', maxWidth: 500,
        borderTopLeftRadius: 30, borderTopRightRadius: 30,
        padding: '24px 24px 36px'
      }}>
        <div style={{ width: 40, height: 4, background: '#ddd', borderRadius: 2, margin: '0 auto 20px' }} />
        <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', marginBottom: 4 }}>⚽ Nuevo cliente</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>Completá los datos del cliente</p>

        {/* Nombre */}
        <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
          📛 Nombre o apodo <span style={{ color: '#dc3545' }}>*</span>
        </label>
        <input
          type="text"
          placeholder="Ej: La Rusa, Ramón, Pepito..."
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          autoFocus
          style={inputStyle}
        />

        {/* Teléfono */}
        <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
          📱 Teléfono
        </label>
        <input
          type="tel"
          inputMode="numeric"
          placeholder="Ej: 387 154-123456"
          value={telefono}
          onChange={e => setTelefono(e.target.value)}
          style={inputStyle}
        />

        {/* Límite */}
        <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
          💰 Límite de fiado
        </label>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 700 }}>$</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Sin límite"
            value={limite}
            onChange={e => setLimite(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 28, marginBottom: 0 }}
          />
        </div>

        {/* Nota */}
        <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 }}>
          📝 Nota
        </label>
        <textarea
          placeholder="Ej: Vecino de enfrente, viene los sábados..."
          value={nota}
          onChange={e => setNota(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
        />

        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          <button onClick={onCancelar} style={{
            flex: 1, padding: 15, background: '#e0e0e0', border: 'none',
            borderRadius: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: '1rem'
          }}>Cancelar</button>
          <button onClick={guardar} style={{
            flex: 2, padding: 15, background: 'var(--accent)', color: 'var(--primary)', border: 'none',
            borderRadius: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: '1rem'
          }}>Agregar ✓</button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
//  APP ROOT
// ──────────────────────────────────────────────
export default function App() {
  const [clientes, setClientes] = useState(cargarDatos)
  const [seleccionado, setSeleccionado] = useState(null)
  const [modal, setModal] = useState(false)
  const [usuario, setUsuario] = useState(() => localStorage.getItem(USER_KEY) || null)

  useEffect(() => { guardarDatos(clientes) }, [clientes])
  useEffect(() => {
    if (usuario) localStorage.setItem(USER_KEY, usuario)
    else localStorage.removeItem(USER_KEY)
  }, [usuario])

  function agregarCliente(datos) {
    setClientes(p => [...p, {
      id: Date.now(),
      nombre: datos.nombre,
      telefono: datos.telefono || '',
      nota: datos.nota || '',
      limite: datos.limite || null,
      movimientos: []
    }])
    setModal(false)
  }
  function actualizarCliente(c) {
    setClientes(p => p.map(x => x.id === c.id ? c : x))
    setSeleccionado(c.id)
  }

  const clienteActual = clientes.find(c => c.id === seleccionado)

  // Sin usuario → pantalla de selección
  if (!usuario) return <SeleccionUsuario onSeleccionar={setUsuario} />

  return (
    <>
      {clienteActual
        ? <Detalle
            cliente={clienteActual}
            onVolver={() => setSeleccionado(null)}
            onActualizar={actualizarCliente}
            usuario={usuario}
          />
        : <Inicio
            clientes={clientes}
            onVer={setSeleccionado}
            onNuevo={() => setModal(true)}
            usuario={usuario}
            onCambiarUsuario={() => setUsuario(null)}
          />
      }
      {modal && <ModalNuevo onGuardar={agregarCliente} onCancelar={() => setModal(false)} />}
    </>
  )
}
