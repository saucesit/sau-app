import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * Aceptar una invitación.
 *
 * La persona elige su propia contraseña: nadie se la inventa ni se la manda por
 * WhatsApp. El rol, los permisos y las etapas ya vienen decididos por quien
 * invitó y viven en la invitación, así que nada de lo que se mande desde acá
 * puede cambiarlos.
 */
export default function Invitacion() {
  const { token } = useParams()
  const navigate  = useNavigate()

  const [inv,      setInv]      = useState(null)
  const [cargando, setCargando] = useState(true)
  const [password, setPassword] = useState('')
  const [repetir,  setRepetir]  = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data, error: err } = await supabase.functions.invoke('aceptar-invitacion', {
        body: { token, modo: 'ver' },
      })
      if (err || !data?.ok) setError(data?.error || 'No pudimos leer esta invitación')
      else setInv(data)
      setCargando(false)
    })()
  }, [token])

  async function aceptar(e) {
    e.preventDefault()
    if (!inv.ya_tiene_cuenta) {
      if (password.length < 6) return setError('La contraseña necesita al menos 6 caracteres')
      if (password !== repetir) return setError('Las contraseñas no coinciden')
    }
    setError(null)
    setEnviando(true)

    const { data, error: err } = await supabase.functions.invoke('aceptar-invitacion', {
      body: { token, password },
    })

    if (err || !data?.ok) {
      setError(data?.error || 'No se pudo aceptar la invitación')
      setEnviando(false)
      return
    }

    // Con cuenta nueva entramos directo; si ya tenía, que use su contraseña.
    if (!data.ya_tenia_cuenta) {
      await supabase.auth.signInWithPassword({ email: data.email, password })
      navigate('/', { replace: true })
    } else {
      navigate('/login', { replace: true })
    }
  }

  const caja = 'w-full max-w-[420px] mx-auto px-6'

  if (cargando) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Buscando la invitación…</p>
      </div>
    )
  }

  if (!inv) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-3">
        <div className={caja}>
          <p className="text-red-400 text-sm font-semibold bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 text-center">
            {error}
          </p>
          <button onClick={() => navigate('/login')}
                  className="w-full mt-4 text-zinc-400 text-sm font-semibold py-3">
            Ir al inicio de sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center py-10">
      <div className={caja}>
        <p className="text-[0.65rem] uppercase tracking-widest text-emerald-400 font-bold text-center">
          Te sumaron a un equipo
        </p>
        <h1 className="text-2xl font-extrabold text-white text-center mt-1.5 leading-tight">
          {inv.empresa}
        </h1>
        <p className="text-zinc-400 text-sm text-center mt-2">
          Hola {inv.nombre}. Vas a entrar con <span className="text-zinc-200">{inv.email}</span>.
        </p>

        <form onSubmit={aceptar} className="mt-7 grid gap-3">
          {inv.ya_tiene_cuenta ? (
            <p className="text-zinc-400 text-sm bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 leading-relaxed">
              Ya tenés una cuenta de SAU con ese correo, así que seguís usando la
              contraseña de siempre. Solo falta que confirmes.
            </p>
          ) : (
            <>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Elegí tu contraseña" autoFocus
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-2xl px-4 py-3.5 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <input
                type="password" value={repetir} onChange={e => setRepetir(e.target.value)}
                placeholder="Repetila"
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-2xl px-4 py-3.5 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
            </>
          )}

          {error && (
            <p className="text-red-400 text-xs font-semibold bg-red-500/10 border border-red-500/30 rounded-2xl px-3 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={enviando}
            className="w-full bg-emerald-500 text-black font-extrabold py-4 rounded-2xl active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {enviando ? 'Entrando…' : 'Entrar al equipo'}
          </button>
        </form>
      </div>
    </div>
  )
}
