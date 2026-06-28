// Chat genérico con el agente de una empresa, usando su "cerebro" (agente_config.config).
// Pensado para simular conversaciones ANTES de tener WhatsApp real conectado —
// misma lógica que después va a correr en el webhook, distinto canal.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function construirSystemPrompt(cfg: any): string {
  const c = cfg.config || {}
  const asistente = c.asistente || {}
  const partes = [
    `Sos ${asistente.nombre || cfg.nombre}, el asistente de WhatsApp de ${asistente.empresa || ''}.`,
    asistente.rubro ? `Rubro: ${asistente.rubro}.` : '',
    asistente.tono ? `Tono: ${asistente.tono}` : '',
  ]

  if (c.catalogo) {
    partes.push('Catálogo y precios que podés usar en la charla:')
    for (const [, valor] of Object.entries(c.catalogo)) {
      partes.push(`- ${valor}`)
    }
  }

  if (Array.isArray(c.preguntas_clave) && c.preguntas_clave.length) {
    partes.push('Cosas que necesitás averiguar a lo largo de la charla (de a una por vez, no todas juntas):')
    c.preguntas_clave.forEach((p: string) => partes.push(`- ${p}`))
  }

  if (c.accion?.cuando) partes.push(`Cuándo pasar el caso a un humano: ${c.accion.cuando}`)
  if (c.accion?.mensaje_cliente) partes.push(`Qué decirle al cliente en ese momento: ${c.accion.mensaje_cliente}`)

  partes.push('Respondé siempre en español de Argentina, como en un chat de WhatsApp: mensajes cortos, sin formato markdown.')

  return partes.filter(Boolean).join('\n')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { empresa_id, mensajes } = await req.json()
    if (!empresa_id) throw new Error('Falta empresa_id')
    if (!Array.isArray(mensajes) || mensajes.length === 0) throw new Error('Falta mensajes')

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SVC  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!ANTHROPIC_KEY) throw new Error('Falta ANTHROPIC_API_KEY')

    const db = createClient(SUPABASE_URL!, SUPABASE_SVC!)

    const { data: cfg, error: dbErr } = await db
      .from('agente_config')
      .select('nombre, modelo, config')
      .eq('empresa_id', empresa_id)
      .single()

    if (dbErr || !cfg) throw new Error('No hay agente configurado para esta empresa')

    const systemPrompt = construirSystemPrompt(cfg)

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      cfg.modelo || 'claude-haiku-4-5',
        max_tokens: 400,
        system:     systemPrompt,
        messages:   mensajes.map((m: any) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!claudeResp.ok) {
      const err = await claudeResp.text()
      throw new Error(`Claude error ${claudeResp.status}: ${err}`)
    }

    const claudeData = await claudeResp.json()
    const respuesta   = claudeData.content[0].text

    return new Response(JSON.stringify({ ok: true, respuesta, agente: cfg.nombre }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
