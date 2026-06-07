import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEFONO_SAU = '543874638747'  // +54 387 463 8747

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { nombre, telefono, audio_url } = await req.json()

    const apiKey = Deno.env.get('CALLMEBOT_API_KEY')
    if (!apiKey) {
      console.error('Falta CALLMEBOT_API_KEY')
      return new Response(JSON.stringify({ ok: false, error: 'Sin API key' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500,
      })
    }

    // Armar mensaje
    const lineas = [
      '🎤 *Nuevo audio en SAU*',
      '',
      nombre   ? `👤 ${nombre}`       : '👤 Anónimo',
      telefono ? `📱 ${telefono}`     : '',
      '',
      '👉 Entrá al admin para escucharlo:',
      'https://sau.com.ar/sau-admin',
    ].filter(l => l !== undefined)

    const mensaje = encodeURIComponent(lineas.join('\n'))
    const url     = `https://api.callmebot.com/whatsapp.php?phone=${TELEFONO_SAU}&text=${mensaje}&apikey=${apiKey}`

    const resp = await fetch(url)
    const body = await resp.text()

    console.log('CallMeBot response:', resp.status, body)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500,
    })
  }
})
