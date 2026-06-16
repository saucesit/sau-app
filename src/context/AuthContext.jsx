import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { MODULOS_DEFAULT } from '../lib/modulos'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [membresias, setMembresias] = useState([])     // empresas a las que pertenece + su rol
  const [empresaActivaId, setEmpresaActivaId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [perfilCargado, setPerfilCargado] = useState(false)

  // 1) Escuchar la sesión de Supabase.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSession(nuevaSesion)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // 2) Cuando hay sesión, traer el perfil y las membresías (con su empresa).
  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      setMembresias([])
      setPerfilCargado(false)
      return
    }
    let cancelado = false
    setPerfilCargado(false)
    ;(async () => {
      const { data: prof } = await supabase
        .from('profile').select('*').eq('id', session.user.id).single()
      const { data: mems } = await supabase
        .from('membresia')
        .select('id, rol, permisos, empresa_id, empresa:empresa_id(*)')
        .eq('usuario_id', session.user.id)
        .eq('activa', true)
      if (cancelado) return
      setProfile(prof || null)
      setMembresias(mems || [])
      setEmpresaActivaId((prev) => prev || mems?.[0]?.empresa_id || null)
      setPerfilCargado(true)
    })()
    return () => { cancelado = true }
  }, [session])

  const signIn = useCallback(
    async (email, password) => {
      const result = await supabase.auth.signInWithPassword({ email, password })
      console.log('signIn result:', result)
      return result
    },
    [],
  )
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setEmpresaActivaId(null)
  }, [])

  const membresiaActiva = membresias.find((m) => m.empresa_id === empresaActivaId) || null
  const empresaActiva = membresiaActiva?.empresa || null
  const rol = membresiaActiva?.rol || null
  const permisos = membresiaActiva?.permisos || []

  // Contadora y admin tienen acceso a todo sin necesidad de permiso explícito.
  const tienePermiso = useCallback(
    (permiso) => {
      if (!membresiaActiva) return false
      if (['contadora', 'admin'].includes(rol)) return true
      return permisos.includes(permiso)
    },
    [membresiaActiva, rol, permisos],
  )

  // Módulos activos de la empresa (el "chaleco" a nivel negocio).
  // Si el campo no existe en DB aún (pre-migration), defaultea a todos activos.
  const modulosActivos = empresaActiva?.modulos_activos ?? MODULOS_DEFAULT
  const tieneModulo = useCallback(
    (moduloId) => modulosActivos.includes(moduloId),
    [modulosActivos],
  )

  // Recarga los datos de la empresa activa (usado después del onboarding)
  const recargarEmpresa = useCallback(async () => {
    if (!session?.user) return
    const { data: mems } = await supabase
      .from('membresia')
      .select('id, rol, permisos, empresa_id, empresa:empresa_id(*)')
      .eq('usuario_id', session.user.id)
      .eq('activa', true)
    if (mems) setMembresias(mems)
  }, [session])

  const value = {
    isSupabaseConfigured,
    session,
    user: session?.user || null,
    profile,
    membresias,
    empresaActiva,
    empresaActivaId,
    setEmpresaActivaId,
    rol,
    permisos,
    tienePermiso,
    modulosActivos,
    tieneModulo,
    loading,
    perfilCargado,
    signIn,
    signOut,
    recargarEmpresa,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
