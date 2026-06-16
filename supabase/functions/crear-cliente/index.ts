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
    const {
      nombre_empresa,
      email: emailInput,
      password: passwordInput,
      telefono,
      modulos,
      notas_admin,
      onboarding,
      consulta_id,
    } = await req.json()

    if (!nombre_empresa) throw new Error('Falta nombre_empresa')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(SUPABASE_URL, SUPABASE_SVC, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── 1. Crear empresa ───────────────────────────────────────
    // Generar email antes de crear empresa para guardarlo junto
    const slugPrev = nombre_empresa
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30)

    const { data: empresa, error: empErr } = await db.from('empresa').insert({
      nombre_fantasia:    nombre_empresa,
      razon_social:       nombre_empresa,
      modulos_activos:    modulos || ['ventas', 'caja'],
      estado_suscripcion: 'gratuito',
      modo_simulacion:    true,
      notas_admin:        notas_admin || null,
      onboarding:         onboarding  || null,
    }).select('id').single()

    if (empErr || !empresa) throw new Error(`No se pudo crear la empresa: ${empErr?.message}`)

    // ── 2. Crear usuario en Supabase Auth ──────────────────────
    const password = passwordInput?.trim() || generarPassword()
    const email    = emailInput?.trim() || `${slugPrev}-${empresa.id.slice(0, 6)}@sau.app`

    // Guardar email en empresa para que el admin lo vea siempre
    await db.from('empresa').update({ email_contacto: email }).eq('id', empresa.id)

    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre: nombre_empresa },
    })

    if (authErr) {
      // Rollback: eliminar empresa creada
      await db.from('empresa').delete().eq('id', empresa.id)
      if (authErr.message?.includes('already registered')) {
        throw new Error('Ya existe un usuario con ese email')
      }
      throw authErr
    }

    const userId = authData.user.id

    // ── 3. Crear perfil ────────────────────────────────────────
    await db.from('profile').upsert({
      id:     userId,
      nombre: nombre_empresa,
    })

    // ── 4. Crear membresía como dueño ──────────────────────────
    const { error: memErr } = await db.from('membresia').insert({
      usuario_id: userId,
      empresa_id: empresa.id,
      rol:        'dueno',
      activa:     true,
      permisos:   [
        'ventas.ver', 'ventas.crear',
        'caja.ver',   'caja.operar',
        'compras.ver','compras.crear',
        'stock.ver',
        'fiado.ver',  'fiado.crear',
        'equipo.ver',
        'empresa.admin',
      ],
    })
    if (memErr) throw memErr

    // ── 5. Marcar lead como resuelto (si viene de un audio) ────
    if (consulta_id) {
      await db.from('consulta_sau').update({
        estado: 'resuelta',
        empresa_id_vinculada: empresa.id,
      }).eq('id', consulta_id)
    }

    // ── 6. Crear tareas de documentación para la contadora ─────
    const tareas = [
      {
        titulo:      `Documentación — ${nombre_empresa}`,
        descripcion: 'CUIT, DNI del titular, constancia de inscripción AFIP',
        tipo:        'documentacion',
      },
      {
        titulo:      `Situación fiscal — ${nombre_empresa}`,
        descripcion: 'Condición frente al IVA: Monotributo (categoría) o Responsable Inscripto',
        tipo:        'fiscal',
      },
      {
        titulo:      `Datos bancarios — ${nombre_empresa}`,
        descripcion: 'CBU o alias del negocio para vinculación de cobros y pagos',
        tipo:        'fiscal',
      },
      {
        titulo:      `Contrato SAU — ${nombre_empresa}`,
        descripcion: 'Firma del contrato de servicio y términos con SAU',
        tipo:        'contrato',
      },
    ]
    const { error: tareasErr } = await db
      .from('tarea_contadora')
      .insert(tareas.map(t => ({ ...t, empresa_id: empresa.id })))
    if (tareasErr) {
      // No frena la creación del cliente, solo loguea
      console.warn('No se pudieron crear tareas contadora:', tareasErr.message)
    }

    return new Response(JSON.stringify({
      ok:         true,
      empresa_id: empresa.id,
      user_id:    userId,
      email,
      password,
      nombre:     nombre_empresa,
      telefono,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('Error crear-cliente:', e)
    // Siempre 200 para que el cliente pueda leer el body del error
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status:  200,
    })
  }
})
