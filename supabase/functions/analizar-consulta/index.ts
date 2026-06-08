import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SAU_MODULOS = `
- ventas: registrar ventas desde el celular, historial, totales
- caja: control de efectivo, apertura y cierre
- compras: registrar gastos y proveedores
- stock: inventario, alertas de stock bajo
- fiado: crédito por cliente, saldos, alertas de límite
- equipo: empleados, turnos, tareas
SAU NO hace todavía: facturación electrónica AFIP, liquidación de sueldos.
`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { consulta_id } = await req.json()
    if (!consulta_id) throw new Error('Falta consulta_id')

    const GROQ_KEY      = Deno.env.get('GROQ_API_KEY')
    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SVC  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!GROQ_KEY)      throw new Error('Falta GROQ_API_KEY')
    if (!ANTHROPIC_KEY) throw new Error('Falta ANTHROPIC_API_KEY')

    const db = createClient(SUPABASE_URL!, SUPABASE_SVC!)

    // ── 1. Obtener consulta ────────────────────────────────────
    const { data: consulta, error: dbErr } = await db
      .from('consulta_sau')
      .select('id, audio_url, nombre')
      .eq('id', consulta_id)
      .single()

    if (dbErr || !consulta) throw new Error('Consulta no encontrada')

    // ── 2. Descargar audio ─────────────────────────────────────
    const audioResp = await fetch(consulta.audio_url)
    if (!audioResp.ok) throw new Error(`No se pudo descargar el audio (${audioResp.status})`)

    const audioBuffer = await audioResp.arrayBuffer()
    const audioBlob   = new Blob([audioBuffer], { type: 'audio/webm' })

    // ── 3. Transcribir con Groq Whisper (gratis) ───────────────
    const form = new FormData()
    form.append('file', audioBlob, 'audio.webm')
    form.append('model', 'whisper-large-v3')
    form.append('language', 'es')
    form.append('response_format', 'json')

    const groqResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
      body: form,
    })

    if (!groqResp.ok) {
      const err = await groqResp.text()
      throw new Error(`Groq error ${groqResp.status}: ${err}`)
    }

    const { text: transcripcion } = await groqResp.json()
    console.log('Transcripción:', transcripcion)

    // ── 4. Analizar con Claude Haiku (Anthropic) ───────────────
    const prompt = `Sos el asistente de Facundo, dueño de SAU (Sistema de Administración Unificado), una app de gestión para pymes argentinas.

Los módulos de SAU son:${SAU_MODULOS}

${consulta.nombre ? `El cliente se llama ${consulta.nombre}.` : 'Un potencial cliente'} grabó este audio:
"${transcripcion}"

Analizá el problema y ayudá a Facundo a preparar su respuesta de audio.

Respondé SOLO con JSON válido, sin markdown:
{
  "problema_principal": "una oración que resume el dolor central del cliente",
  "puntos_de_dolor": ["dolor concreto 1", "dolor concreto 2"],
  "modulos_que_resuelven": ["nombre_modulo1", "nombre_modulo2"],
  "puede_resolver": true,
  "lo_que_no_cubrimos": null,
  "script_para_facundo": "Mensaje en primera persona como si fuera Facundo hablando. Tono argentino, cálido y directo. Empezá con empatía genuina. Mencioná el módulo específico que resuelve su problema. Terminá invitándolo a probarlo gratis sin compromiso. Máximo 5 oraciones cortas."
}`

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!claudeResp.ok) {
      const err = await claudeResp.text()
      throw new Error(`Claude error ${claudeResp.status}: ${err}`)
    }

    const claudeData = await claudeResp.json()
    const rawText    = claudeData.content[0].text
    const clean      = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const analisis   = JSON.parse(clean)

    console.log('Análisis:', analisis)

    // ── 5. Guardar en DB ───────────────────────────────────────
    await db
      .from('consulta_sau')
      .update({ transcripcion, analisis })
      .eq('id', consulta_id)

    return new Response(JSON.stringify({ ok: true, transcripcion, analisis }), {
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
