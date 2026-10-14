import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { MODULOS_DEFAULT } from '../lib/modulos'
import { rutaDeInicio } from '../lib/inicio'

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
        .select('id, rol, permisos, taller_etapas, empresa_id, empresa:empresa_id(*)')
        .eq('usuario_id', session.user.id)
        .eq('activa', true)
      if (cancelado) return
      setProfile(prof || null)
      // Orden estable: sin esto "la primera empresa" dependía del orden en que
      // Postgres devolviera las filas, que puede cambiar solo. Se ordena por
      // antigüedad de la empresa y se desempata por id.
      //
      // Hoy no hay ningún usuario en más de una empresa, así que esto no elige
      // nada por nadie: solo deja de ser azaroso. Cuando aparezca el primero,
      // la respuesta de verdad es un selector de empresa, no un criterio mejor.
      const ordenadas = [...(mems || [])].sort((a, b) => {
        const fa = a.empresa?.creado_en || '', fb = b.empresa?.creado_en || ''
        return fa !== fb ? (fa < fb ? -1 : 1) : (a.empresa_id < b.empresa_id ? -1 : 1)
      })
      setMembresias(ordenadas)
      setEmpresaActivaId((prev) => prev || ordenadas[0]?.empresa_id || null)
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

  // Etapas del taller donde esta persona puede marcar trabajo realizado.
  // Vacío = ninguna: así lo hace cumplir taller_marcar_trabajo_hecho() en la
  // base. Lo leemos acá para no ofrecer un botón que siempre va a fallar.
  const tallerEtapas = membresiaActiva?.taller_etapas || []

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

  // A dónde entra este usuario después del login, y a dónde vuelve si abre una
  // ruta de un módulo que su empresa no tiene. Es navegación: no concede nada.
  const rutaInicio = rutaDeInicio(empresaActiva, tienePermiso)

  // Recarga los datos de la empresa activa (usado después del onboarding)
  const recargarEmpresa = useCallback(async () => {
    if (!session?.user) return
    const { data: mems } = await supabase
      .from('membresia')
      .select('id, rol, permisos, taller_etapas, empresa_id, empresa:empresa_id(*)')
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
    tallerEtapas,
    tienePermiso,
    modulosActivos,
    tieneModulo,
    rutaInicio,
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
