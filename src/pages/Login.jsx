import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Cartel que aparece si todavía no cargaste las claves de Supabase en .env.local
function ConfigBanner() {
  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-slate-100 flex flex-col items-center justify-center px-6 text-center gap-4">
      <p className="text-5xl">🔌</p>
      <h1 className="text-xl font-extrabold text-slate-800">Falta conectar Supabase</h1>
      <p className="text-slate-500 text-sm leading-relaxed">
        Creá tu proyecto en supabase.com y pegá la <strong>Project URL</strong> y la{' '}
        <strong>anon public key</strong> en el archivo <code className="bg-slate-200 px-1 rounded">.env.local</code>.
        Después reiniciá <code className="bg-slate-200 px-1 rounded">npm run dev</code> y listo.
      </p>
    </div>
  )
}

export default function Login() {
  const { isSupabaseConfigured, signIn, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')

  // Cuando la sesión se activa (login exitoso), redirigir al inicio
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)

  if (!isSupabaseConfigured) return <ConfigBanner />

  async function entrar(e) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    const { data, error } = await signIn(email.trim(), password)
    setCargando(false)
    console.log('LOGIN resultado:', { data, error })
    if (error) {
      setError(`Error: ${error.message} (status: ${error.status})`)
    } else if (!data?.session) {
      setError('Login sin sesión — revisá la consola del navegador')
    }
  }

  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-black flex flex-col items-center justify-center px-8">

      {/* Logo con glow verde */}
      <div className="mb-10" style={{ filter: 'drop-shadow(0 0 32px rgba(0, 200, 120, 0.35))' }}>
        <img src="/logo.png" alt="SAU" className="w-36 rounded-3xl" />
      </div>

      {/* Tagline */}
      <p className="text-zinc-500 text-sm tracking-widest uppercase mb-10">
        Tu negocio al día
      </p>

      {/* Formulario */}
      <form onSubmit={entrar} className="w-full grid gap-3">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-5 py-4 rounded-2xl outline-none text-white bg-zinc-900 border border-zinc-800 placeholder:text-zinc-600 focus:border-emerald-600 transition-colors"
          required
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-5 py-4 rounded-2xl outline-none text-white bg-zinc-900 border border-zinc-800 placeholder:text-zinc-600 focus:border-emerald-600 transition-colors"
          required
        />
        {error && <p className="text-red-400 text-xs font-medium text-center mt-1">{error}</p>}

        {/* Botón verde redondo */}
        <div className="flex justify-center mt-4">
          <button
            type="submit"
            disabled={cargando}
            className="w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-50 transition-all shadow-lg flex items-center justify-center"
            style={{ boxShadow: '0 0 28px rgba(16, 185, 129, 0.5)' }}
          >
            {cargando
              ? <span className="text-white text-xs font-bold">...</span>
              : <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
            }
          </button>
        </div>
      </form>

      {/* Link unirse */}
      <p className="text-zinc-700 text-xs mt-10">
        ¿Código de invitación?{' '}
        <a href="/unirse" className="text-emerald-600 font-semibold hover:text-emerald-400">
          Unirse
        </a>
      </p>

    </div>
  )
}
