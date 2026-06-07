import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TODOS_PERMISOS, PERMISOS_EMPLEADO_BASE } from '../lib/constants'

export default function Unirse() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const codigoUrl = params.get('codigo') || ''

  const [codigo, setCodigo] = useState(codigoUrl)
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [paso, setPaso] = useState(codigoUrl ? 2 : 1)   // 1: código, 2: datos
  const [empresa, setEmpresa] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  async function verificarCodigo() {
    if (!codigo.trim()) return setError('Ingresá el código')
    setError(null); setCargando(true)
    const { data } = await supabase
      .from('empresa')
      .select('id, razon_social, nombre_fantasia')
      .eq('codigo_invitacion', codigo.trim().toLowerCase())
      .single()
    setCargando(false)
    if (!data) return setError('Código inválido. Pedíselo al dueño.')
    setEmpresa(data)
    setPaso(2)
  }

  async function registrarse(e) {
    e.preventDefault()
    if (!nombre.trim()) return setError('Ingresá tu nombre')
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres')
    setError(null); setCargando(true)

    // 1. Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    if (authError) {
      setCargando(false)
      return setError(authError.message)
    }

    const userId = authData.user?.id
    if (!userId) {
      setCargando(false)
      return setError('No se pudo crear el usuario.')
    }

    // 2. Crear perfil
    await supabase.from('profile').insert({
      id: userId,
      nombre: nombre.trim(),
      apellido: apellido.trim() || null,
    })

    // 3. Ver si la empresa ya tiene un admin (puede haber sido creada por la contadora)
    const { data: adminsExistentes } = await supabase
      .from('membresia')
      .select('id')
      .eq('empresa_id', empresa.id)
      .eq('rol', 'admin')
      .eq('activa', true)
      .limit(1)

    const esElPrimero = !adminsExistentes || adminsExistentes.length === 0

    // Si es el primero en unirse → admin con todos los permisos
    // Si ya hay un admin → empleado con permisos base
    await supabase.from('membresia').insert({
      usuario_id: userId,
      empresa_id: empresa.id,
      rol:        esElPrimero ? 'admin'   : 'empleado',
      permisos:   esElPrimero ? TODOS_PERMISOS : PERMISOS_EMPLEADO_BASE,
    })

    setCargando(false)
    navigate('/')
  }

  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-indigo-600 flex flex-col items-center justify-center px-6">
      <p className="text-5xl mb-3">👋</p>
      <h1 className="text-2xl font-extrabold text-white mb-1">Unirse a SAU</h1>
      <p className="text-indigo-200 text-sm mb-8 text-center">
        {paso === 1 ? 'Ingresá el código que te dio el dueño' : `Entrás a: ${empresa?.nombre_fantasia || empresa?.razon_social}`}
      </p>

      {paso === 1 ? (
        <div className="w-full grid gap-3">
          <input
            type="text"
            placeholder="Código de empresa"
            value={codigo}
            onChange={e => setCodigo(e.target.value)}
            autoFocus
            className="w-full px-4 py-3.5 rounded-2xl outline-none text-slate-800 bg-white text-center text-xl font-bold tracking-widest uppercase"
          />
          {error && <p className="text-amber-300 text-sm text-center">{error}</p>}
          <button
            onClick={verificarCodigo}
            disabled={cargando}
            className="w-full py-4 rounded-2xl bg-amber-400 text-indigo-900 font-bold text-lg disabled:opacity-60"
          >
            {cargando ? 'Verificando…' : 'Continuar →'}
          </button>
        </div>
      ) : (
        <form onSubmit={registrarse} className="w-full grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Nombre *" value={nombre}
              onChange={e => setNombre(e.target.value)}
              className="px-4 py-3.5 rounded-2xl outline-none text-slate-800 bg-white"
            />
            <input type="text" placeholder="Apellido" value={apellido}
              onChange={e => setApellido(e.target.value)}
              className="px-4 py-3.5 rounded-2xl outline-none text-slate-800 bg-white"
            />
          </div>
          <input type="email" placeholder="Email *" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl outline-none text-slate-800 bg-white"
            required
          />
          <input type="password" placeholder="Contraseña (mín. 6 caracteres)" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl outline-none text-slate-800 bg-white"
          />
          {error && <p className="text-amber-300 text-sm text-center">{error}</p>}
          <button type="submit" disabled={cargando}
            className="w-full py-4 rounded-2xl bg-amber-400 text-indigo-900 font-bold text-lg disabled:opacity-60"
          >
            {cargando ? 'Creando cuenta…' : 'Crear mi cuenta ✓'}
          </button>
          <button type="button" onClick={() => setPaso(1)}
            className="text-indigo-200 text-sm text-center"
          >
            ← Cambiar código
          </button>
        </form>
      )}
    </div>
  )
}
