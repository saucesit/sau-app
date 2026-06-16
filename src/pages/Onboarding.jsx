import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MODULOS } from '../lib/modulos'

const MODULO_RUTA = {
  ventas:   '/vender',
  caja:     '/caja',
  stock:    '/stock',
  fiado:    '/fiado',
  compras:  '/compras',
  equipo:   '/equipo',
}

export default function Onboarding() {
  const { empresaActiva, empresaActivaId, recargarEmpresa } = useAuth()
  const navigate   = useNavigate()
  const [paso,     setPaso]     = useState(0)
  const [cargando, setCargando] = useState(false)

  const ob = empresaActiva?.onboarding
  if (!ob || ob.completado) { navigate('/'); return null }

  const nombre   = ob.nombre_cliente || empresaActiva?.nombre_fantasia || 'Bienvenido'
  const primerNombre = nombre.split(' ')[0]
  const problema = ob.problema
  const modIDs   = ob.modulos?.length > 0 ? ob.modulos : ['ventas']
  const modPrincipal = MODULOS.find(m => m.id === modIDs[0]) || MODULOS[0]
  const rutaPrincipal = MODULO_RUTA[modIDs[0]] || '/'

  async function empezar() {
    setCargando(true)
    await supabase.from('empresa').update({
      onboarding: { ...ob, completado: true }
    }).eq('id', empresaActivaId)
    if (recargarEmpresa) await recargarEmpresa()
    navigate(rutaPrincipal)
  }

  const PASOS = [
    // Paso 0 — Saludo
    {
      titulo: 'Bienvenida',
      content: (
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-2xl shadow-indigo-200">
            <span className="text-5xl">👋</span>
          </div>
          <div className="grid gap-2">
            <h1 className="text-3xl font-extrabold text-slate-800">Hola, {primerNombre}!</h1>
            <p className="text-slate-500 text-lg leading-snug">
              Facundo configuró SAU<br />para tu negocio específicamente.
            </p>
          </div>
          {problema && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-3xl px-5 py-4 w-full text-left">
              <p className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-1">Lo que entendimos</p>
              <p className="text-indigo-700 font-semibold text-sm leading-relaxed">"{problema}"</p>
            </div>
          )}
          <button onClick={() => setPaso(1)}
            className="w-full py-5 rounded-3xl bg-indigo-600 text-white font-extrabold text-lg shadow-xl shadow-indigo-200 active:scale-95 transition-all">
            Ver cómo lo resolvemos →
          </button>
        </div>
      )
    },

    // Paso 1 — Cargá tu negocio
    {
      titulo: 'Cargá tu negocio',
      content: (
        <div className="flex flex-col gap-5">
          <div className="text-center">
            <span className="text-4xl">📋</span>
            <h2 className="text-2xl font-extrabold text-slate-800 mt-3">Primero: tu negocio</h2>
            <p className="text-slate-400 text-sm mt-1">
              Antes de probar, necesitamos cargar tus datos reales.<br />
              Lo puede hacer vos o tu contador.
            </p>
          </div>

          <div className="grid gap-3">
            {[
              { icon: '📦', titulo: 'Tus productos',     sub: 'Con precios y costos actuales',       key: 'productos' },
              { icon: '👥', titulo: 'Tus clientes',      sub: 'Los que te compran seguido o te deben', key: 'clientes'  },
              { icon: '📊', titulo: 'Ventas históricas', sub: 'Para ver cómo venías hasta hoy',        key: 'ventas'    },
            ].map(item => (
              <div key={item.key} className="flex items-center gap-4 bg-white border border-slate-100 rounded-2xl px-4 py-4 shadow-sm">
                <span className="text-2xl">{item.icon}</span>
                <div className="flex-1">
                  <p className="font-bold text-slate-700">{item.titulo}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{item.sub}</p>
                </div>
                <span className="text-slate-300 text-lg">→</span>
              </div>
            ))}
          </div>

          <div className="bg-slate-100 rounded-3xl px-4 py-3 flex items-start gap-3">
            <span className="text-xl shrink-0">💡</span>
            <p className="text-slate-500 text-sm leading-snug">
              No importa si usabas Excel, Tango u otro sistema — podés importar todo en minutos con un archivo CSV.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setPaso(2)}
              className="py-4 rounded-3xl bg-slate-200 text-slate-600 font-bold active:scale-95">
              Después →
            </button>
            <a href="/importar"
              className="py-4 rounded-3xl bg-indigo-600 text-white font-extrabold text-center shadow-xl shadow-indigo-200 active:scale-95 transition-all">
              Cargar ahora →
            </a>
          </div>
        </div>
      )
    },

    // Paso 2 — La solución (prueba OFF)
    {
      titulo: 'Tu solución',
      content: (
        <div className="flex flex-col gap-5">
          <div className="text-center">
            <span className="text-4xl">🚀</span>
            <h2 className="text-2xl font-extrabold text-slate-800 mt-3">Empezamos por acá</h2>
            <p className="text-slate-400 text-sm mt-1">SAU tiene exactamente lo que necesitás</p>
          </div>

          {/* Módulo principal */}
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-3xl p-6 text-white shadow-xl shadow-indigo-200">
            <span className="text-4xl">{modPrincipal.icon}</span>
            <h3 className="text-xl font-extrabold mt-3">{modPrincipal.titulo}</h3>
            <p className="text-indigo-200 text-sm mt-1 leading-snug">
              {modPrincipal.descripcion || 'Gestión simple y poderosa para tu negocio'}
            </p>
            <div className="mt-4 bg-white/10 rounded-2xl px-3 py-1.5 inline-block">
              <p className="text-xs font-bold text-indigo-200">Activado para vos ✓</p>
            </div>
          </div>

          {/* Otros módulos */}
          {modIDs.length > 1 && (
            <div className="grid gap-2">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">También activados</p>
              {modIDs.slice(1).map(id => {
                const mod = MODULOS.find(m => m.id === id)
                if (!mod) return null
                return (
                  <div key={id} className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
                    <span className="text-xl">{mod.icon}</span>
                    <p className="font-bold text-slate-700 text-sm flex-1">{mod.titulo}</p>
                    <span className="text-emerald-500 text-xs font-bold">✓</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* OFF/ON explicación */}
          <div className="grid gap-2">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-lg">🟡</span>
              <div>
                <p className="text-amber-700 text-sm font-bold">Ahora: Modo Práctica (OFF)</p>
                <p className="text-amber-600 text-xs">Probás todo sin afectar nada real</p>
              </div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-lg">🟢</span>
              <div>
                <p className="text-emerald-700 text-sm font-bold">Después: Modo Real (ON)</p>
                <p className="text-emerald-600 text-xs">Cuando estés convencido, Facundo lo activa</p>
              </div>
            </div>
          </div>

          <button onClick={empezar} disabled={cargando}
            className="w-full py-5 rounded-3xl bg-indigo-600 text-white font-extrabold text-lg shadow-xl shadow-indigo-200 active:scale-95 transition-all disabled:opacity-60">
            {cargando ? 'Preparando...' : `Empezar prueba →`}
          </button>
        </div>
      )
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Logo */}
      <div className="flex items-center justify-center pt-10 pb-4">
        <img src="/logo.png" alt="SAU" className="w-10 h-10 rounded-2xl shadow-md" />
      </div>

      {/* Puntos de progreso */}
      <div className="flex justify-center gap-2 mb-8">
        {PASOS.map((_, i) => (
          <div key={i} className={`rounded-full transition-all ${
            i === paso ? 'w-6 h-2 bg-indigo-600' : 'w-2 h-2 bg-slate-300'
          }`} />
        ))}
      </div>

      {/* Contenido */}
      <div className="flex-1 px-6 max-w-sm mx-auto w-full">
        {PASOS[paso]?.content}
      </div>

      <div className="h-10" />
    </div>
  )
}
