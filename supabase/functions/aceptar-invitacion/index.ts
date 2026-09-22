import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const fallo = (msg: string) => new Response(
  JSON.stringify({ ok: false, error: msg }),
  { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
)

/**
 * Acepta una invitación y crea la membresía.
 *
 * Es la única puerta de entrada a una empresa: el rol, los permisos y las
 * etapas salen de la fila de invitación, no del cuerpo del pedido. Si el token
 * está usado o vencido, no pasa nada.
 *
 * Se llama sin sesión, porque quien acepta todavía no tiene cuenta.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // modo 'ver' devuelve de qué invitación se trata sin consumirla, para que la
    // pantalla pueda decir "te invitaron a X" antes de pedir la contraseña.
    const { token, password, modo } = await req.json()
    if (!token) return fallo('Falta el token de la invitación')

    const { data: inv } = await admin
      .from('invitacion')
      .select('*, empresa:empresa_id(nombre_fantasia, razon_social)')
      .eq('token', token)
      .maybeSingle()

    if (!inv)                               return fallo('Esta invitación no existe')
    if (inv.usada_en)                       return fallo('Esta invitación ya fue usada')
    if (new Date(inv.expira_en) < new Date()) return fallo('Esta invitación venció. Pedile al encargado que te mande una nueva')

    // ¿La persona ya tiene cuenta en SAU? Entonces se vincula, no se crea otra.
    const { data: usuarios } = await admin.auth.admin.listUsers()
    const existente = usuarios?.users?.find(u => u.email?.toLowerCase() === inv.email)

    if (modo === 'ver') {
      return new Response(
        JSON.stringify({
          ok: true,
          nombre:  inv.nombre,
          email:   inv.email,
          empresa: inv.empresa?.nombre_fantasia || inv.empresa?.razon_social,
          ya_tiene_cuenta: Boolean(existente),
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    let uid: string
    if (existente) {
      uid = existente.id
    } else {
      if (!password || password.length < 6) {
        return fallo('Elegí una contraseña de al menos 6 caracteres')
      }
      const { data: nuevo, error } = await admin.auth.admin.createUser({
        email: inv.email, password, email_confirm: true,
      })
      if (error) return fallo(error.message)
      uid = nuevo.user.id
    }

    await admin.from('profile')
      .upsert({ id: uid, nombre: inv.nombre }, { onConflict: 'id' })

    // Si ya había una membresía desactivada, se reactiva con los permisos nuevos.
    const { data: previa } = await admin
      .from('membresia')
      .select('id')
      .eq('empresa_id', inv.empresa_id)
      .eq('usuario_id', uid)
      .maybeSingle()

    const datos = {
      rol:           inv.rol,
      permisos:      inv.permisos,
      taller_etapas: inv.taller_etapas,
      activa:        true,
    }

    if (previa) {
      await admin.from('membresia').update(datos).eq('id', previa.id)
    } else {
      await admin.from('membresia').insert({
        usuario_id: uid, empresa_id: inv.empresa_id, ...datos,
      })
    }

    await admin.from('invitacion')
      .update({ usada_en: new Date().toISOString(), usada_por: uid })
      .eq('id', inv.id)

    return new Response(
      JSON.stringify({
        ok: true,
        email: inv.email,
        empresa: inv.empresa?.nombre_fantasia || inv.empresa?.razon_social,
        ya_tenia_cuenta: Boolean(existente),
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    return fallo(err.message)
  }
})
