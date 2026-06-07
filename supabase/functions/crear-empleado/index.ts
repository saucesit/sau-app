import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No autorizado')

    // Cliente con permisos de admin (service_role, solo en el servidor)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Cliente con permisos del usuario que está llamando
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verificar que el usuario que llama está autenticado
    const { data: { user } } = await caller.auth.getUser()
    if (!user) throw new Error('Usuario no autenticado')

    const { nombre, apellido, email, password, empresa_id, permisos, rol } = await req.json()

    // Verificar que tiene permiso para gestionar esta empresa
    const { data: mem } = await caller
      .from('membresia')
      .select('rol, permisos')
      .eq('empresa_id', empresa_id)
      .eq('usuario_id', user.id)
      .eq('activa', true)
      .single()

    if (!mem) throw new Error('Sin acceso a esta empresa')

    const puedeGestionar =
      ['admin', 'contadora'].includes(mem.rol) ||
      mem.permisos?.includes('empresa.admin') ||
      mem.permisos?.includes('empresa.rrhh')

    if (!puedeGestionar) throw new Error('Sin permisos para crear empleados')

    // Crear el usuario en Supabase Auth (sin tocar la sesión actual)
    const { data: nuevo, error: errAuth } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (errAuth) throw new Error(errAuth.message)

    const uid = nuevo.user.id

    // Crear perfil
    await admin.from('profile').insert({ id: uid, nombre, apellido: apellido || null })

    // Crear membresía con los permisos asignados
    await admin.from('membresia').insert({
      usuario_id: uid,
      empresa_id,
      rol: rol || 'empleado',
      permisos: permisos || ['ventas.crear', 'ventas.ver', 'caja.ver', 'reportes.ver'],
    })

    return new Response(
      JSON.stringify({ ok: true, userId: uid }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  }
})
