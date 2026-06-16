import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generarPassword() {
  const nums = Math.floor(100000 + Math.random() * 900000).toString()
  return `SAU-${nums}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { email } = await req.json()
    if (!email) throw new Error('Falta email')

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Buscar usuario por email
    const { data: { users }, error: listErr } = await db.auth.admin.listUsers()
    if (listErr) throw listErr

    const user = users.find(u => u.email === email)
    if (!user) throw new Error(`No se encontró usuario con email: ${email}`)

    // Generar y setear nueva contraseña
    const password = generarPassword()
    const { error: updateErr } = await db.auth.admin.updateUserById(user.id, { password })
    if (updateErr) throw updateErr

    return new Response(JSON.stringify({ ok: true, password, email }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (e) {
    console.error('resetear-acceso error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
