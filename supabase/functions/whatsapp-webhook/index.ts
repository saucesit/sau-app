import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERIFY_TOKEN = Deno.env.get('WA_VERIFY_TOKEN') ?? 'sau_wa_verify_2024'

// Claude a veces responde con markdown aunque el prompt le pida que no.
// WhatsApp usa *negrita* (un asterisco), no **negrita** — sin esto al cliente
// le llegan los asteriscos literales.
function aFormatoWhatsApp(texto: string): string {
  return texto
    .replace(/\*\*\*(.+?)\*\*\*/gs, '*_$1_*')   // ***x*** → *_x_*
    .replace(/\*\*(.+?)\*\*/gs,     '*$1*')     // **x**   → *x*
    .replace(/^#{1,6}\s+(.+)$/gm,   '*$1*')     // # Título → *Título*
    .replace(/^\s*[-*]\s+/gm,       '• ')       // - item   → • item
    .trim()
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // ── Verificación del webhook (GET) ──────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = url.searchParams.get('hub.mode')
    const token     = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // ── Mensajes entrantes (POST) ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json()

    const entry         = body?.entry?.[0]
    const change        = entry?.changes?.[0]
    const value         = change?.value
    const message       = value?.messages?.[0]

    // Ignorar actualizaciones de estado (delivered, read, etc.)
    if (!message || message.type !== 'text') {
      return new Response('OK', { status: 200 })
    }

    const from          = message.from          // número del que escribe
    const text          = message.text.body
    const phoneNumberId = value.metadata.phone_number_id

    console.log(`[wa] entrante de ${from} via phone_id ${phoneNumberId}: "${text}"`)

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Buscar empresa por whatsapp_phone_id en agente_config
    const { data: cfg } = await db
      .from('agente_config')
      .select('empresa_id')
      .eq('whatsapp_phone_id', phoneNumberId)
      .single()

    if (!cfg) {
      console.error('No hay empresa para phone_id:', phoneNumberId)
      return new Response('OK', { status: 200 })
    }

    const empresa_id = cfg.empresa_id

    // Obtener access_token de agente_credenciales
    const { data: cred } = await db
      .from('agente_credenciales')
      .select('access_token')
      .eq('empresa_id', empresa_id)
      .single()

    if (!cred?.access_token) {
      console.error('No hay access_token para empresa:', empresa_id)
      return new Response('OK', { status: 200 })
    }

    const access_token = cred.access_token

    // Buscar caso abierto de este contacto
    const { data: casoExistente } = await db
      .from('caso')
      .select('id')
      .eq('empresa_id', empresa_id)
      .eq('canal', 'whatsapp')
      .filter('datos->>contacto_tel', 'eq', from)
      .neq('estado', 'cerrado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let caso_id: string

    if (casoExistente) {
      caso_id = casoExistente.id
    } else {
      const { data: nuevoCaso, error } = await db
        .from('caso')
        .insert({ empresa_id, canal: 'whatsapp', datos: { contacto_tel: from } })
        .select('id')
        .single()

      if (error || !nuevoCaso) {
        console.error('Error creando caso:', error)
        return new Response('OK', { status: 200 })
      }
      caso_id = nuevoCaso.id
    }

    console.log(`[wa] caso ${caso_id} (${casoExistente ? 'existente' : 'nuevo'}) para empresa ${empresa_id}`)

    // Cargar historial del caso
    const { data: historialRaw } = await db
      .from('caso_mensaje')
      .select('role, content')
      .eq('caso_id', caso_id)
      .order('created_at', { ascending: true })

    const historial = (historialRaw ?? []).map((m) => ({ role: m.role, content: m.content }))
    const mensajes  = [...historial, { role: 'user', content: text }]

    // Llamar a chat-agente
    const agentRes = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/chat-agente`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'apikey':        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        },
        body: JSON.stringify({ empresa_id, mensajes, caso_id }),
      }
    )

    const agentData = await agentRes.json()

    if (!agentData.ok) {
      console.error('[wa] chat-agente falló:', JSON.stringify(agentData))
    }

    const respuesta = aFormatoWhatsApp(
      agentData.respuesta ?? 'Hubo un error, intentá de nuevo en un momento.'
    )
    console.log(`[wa] respuesta de ${agentData.agente ?? 'agente'}: "${respuesta}"`)

    // Enviar respuesta por WhatsApp (Meta Cloud API)
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   from,
          type: 'text',
          text: { body: respuesta },
        }),
      }
    )

    if (metaRes.ok) {
      console.log('[wa] enviado OK')
    } else {
      const err = await metaRes.text()
      console.error(`[wa] error enviando (${metaRes.status}):`, err)
    }

    return new Response('OK', { status: 200 })
  }

  return new Response('Method not allowed', { status: 405 })
})
