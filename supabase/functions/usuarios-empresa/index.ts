import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(obj: unknown) {
  return new Response(JSON.stringify(obj), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status: 200,
  })
}

const PERMISOS_DUENO = [
  'ventas.ver', 'ventas.crear',
  'caja.ver',   'caja.operar',
  'compras.ver','compras.crear',
  'stock.ver',
  'fiado.ver',  'fiado.crear',
  'equipo.ver',
  'empresa.admin',
]

// Empleado: puede operar (crear ventas/presupuestos/fiado) pero NO administrar
// ni aprobar (no tiene empresa.admin).
const PERMISOS_EMPLEADO = [
  'ventas.ver', 'ventas.crear',
  'caja.ver',   'caja.operar',
  'fiado.ver',  'fiado.crear',
]

function permisosPorRol(rol: string) {
  return rol === 'empleado' ? PERMISOS_EMPLEADO : PERMISOS_DUENO
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { action } = body

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // ── Listar usuarios de una empresa ──────────────────────────
    if (action === 'listar') {
      const { empresa_id } = body
      if (!empresa_id) throw new Error('Falta empresa_id')

      const { data: mems } = await db
        .from('membresia')
        .select('id, usuario_id, rol, activa')
        .eq('empresa_id', empresa_id)
        .eq('activa', true)

      const ids = (mems || []).map(m => m.usuario_id)
      const { data: profiles } = ids.length
        ? await db.from('profile').select('id, nombre').in('id', ids)
        : { data: [] }

      const { data: { users } } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })

      const usuarios = (mems || []).map(m => {
        const u = users.find(x => x.id === m.usuario_id)
        const p = (profiles || []).find(x => x.id === m.usuario_id)
        return {
          membresia_id: m.id,
          usuario_id:   m.usuario_id,
          rol:          m.rol,
          email:        u?.email || null,
          nombre:       p?.nombre || null,
        }
      })

      return json({ ok: true, usuarios })
    }

    // ── Crear nuevo usuario para la empresa ─────────────────────
    if (action === 'crear') {
      const { empresa_id, nombre, email, password, rol } = body
      if (!empresa_id) throw new Error('Falta empresa_id')
      if (!email?.trim() || !password?.trim()) throw new Error('Falta email o contraseña')

      const { data: authData, error: authErr } = await db.auth.admin.createUser({
        email:         email.trim(),
        password:      password.trim(),
        email_confirm: true,
        user_metadata: { nombre: nombre || email },
      })
      if (authErr) {
        if (authErr.message?.includes('already')) throw new Error('Ya existe un usuario con ese email')
        throw authErr
      }

      const userId = authData.user.id
      const rolFinal = rol === 'empleado' ? 'empleado' : 'dueno'
      await db.from('profile').upsert({ id: userId, nombre: nombre?.trim() || email.trim() })
      const { error: memErr } = await db.from('membresia').insert({
        usuario_id: userId,
        empresa_id,
        rol:        rolFinal,
        activa:     true,
        permisos:   permisosPorRol(rolFinal),
      })
      if (memErr) throw memErr

      return json({ ok: true, usuario_id: userId, email: email.trim(), password: password.trim() })
    }

    // ── Actualizar email / contraseña / nombre ──────────────────
    if (action === 'actualizar') {
      const { usuario_id, email, password, nombre } = body
      if (!usuario_id) throw new Error('Falta usuario_id')

      const updates: Record<string, string> = {}
      if (email?.trim())    updates.email    = email.trim()
      if (password?.trim()) updates.password = password.trim()

      if (Object.keys(updates).length) {
        const { error } = await db.auth.admin.updateUserById(usuario_id, updates)
        if (error) {
          if (error.message?.includes('already')) throw new Error('Ese email ya está en uso')
          throw error
        }
      }
      if (nombre?.trim()) {
        await db.from('profile').update({ nombre: nombre.trim() }).eq('id', usuario_id)
      }

      return json({ ok: true })
    }

    throw new Error('Acción no reconocida')

  } catch (e) {
    console.error('usuarios-empresa error:', e)
    return json({ ok: false, error: String((e as Error).message || e) })
  }
})
