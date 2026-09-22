import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Crea una invitación de un solo uso para sumar a alguien a una empresa.
 *
 * Quien invita decide acá el rol, los permisos y las etapas del taller, y eso
 * queda guardado en la fila. El navegador de quien acepta no tiene forma de
 * cambiarlos: la función que acepta los lee de la invitación, no del pedido.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No autorizado')

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user } } = await caller.auth.getUser()
    if (!user) throw new Error('Usuario no autenticado')

    const { empresa_id, nombre, email, rol, permisos, taller_etapas } = await req.json()
    if (!empresa_id) throw new Error('Falta la empresa')
    if (!nombre?.trim()) throw new Error('Falta el nombre')
    if (!email?.trim()) throw new Error('Falta el email')

    // El permiso se verifica contra la membresía real de quien llama, no contra
    // lo que diga el pedido.
    const { data: mem } = await admin
      .from('membresia')
      .select('rol, permisos')
      .eq('empresa_id', empresa_id)
      .eq('usuario_id', user.id)
      .eq('activa', true)
      .maybeSingle()

    const puedeInvitar = mem && (
      ['admin', 'contadora'].includes(mem.rol) || mem.permisos?.includes('empresa.admin')
    )
    if (!puedeInvitar) throw new Error('No tenés permiso para invitar gente a esta empresa')

    const correo = email.trim().toLowerCase()

    // Si ya es del equipo, no tiene sentido invitarlo de nuevo.
    const { data: usuarios } = await admin.auth.admin.listUsers()
    const existente = usuarios?.users?.find(u => u.email?.toLowerCase() === correo)
    if (existente) {
      const { data: yaEsta } = await admin
        .from('membresia')
        .select('id, activa')
        .eq('empresa_id', empresa_id)
        .eq('usuario_id', existente.id)
        .maybeSingle()
      if (yaEsta?.activa) throw new Error('Esa persona ya forma parte del equipo')
    }

    // Una invitación pendiente por persona y empresa: la nueva reemplaza a la vieja.
    await admin.from('invitacion').delete()
      .eq('empresa_id', empresa_id).eq('email', correo).is('usada_en', null)

    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

    const { data: inv, error } = await admin.from('invitacion').insert({
      empresa_id,
      nombre:        nombre.trim(),
      email:         correo,
      rol:           rol || 'empleado',
      permisos:      permisos || [],
      taller_etapas: taller_etapas || [],
      token,
      creada_por:    user.id,
    }).select('id, expira_en').single()

    if (error) throw new Error(error.message)

    return new Response(
      JSON.stringify({
        ok: true,
        token,
        expira_en: inv.expira_en,
        ya_tiene_cuenta: Boolean(existente),
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }
})
