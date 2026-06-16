import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { foto_url, empresa_id } = await req.json()
    if (!foto_url) throw new Error('Falta foto_url')

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SVC  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!ANTHROPIC_KEY) throw new Error('Falta ANTHROPIC_API_KEY')

    const db = createClient(SUPABASE_URL!, SUPABASE_SVC!)

    // ── 1. Descargar imagen ────────────────────────────────────
    const imgResp = await fetch(foto_url)
    if (!imgResp.ok) throw new Error(`No se pudo descargar la imagen (${imgResp.status})`)

    const imgBuffer = await imgResp.arrayBuffer()
    const bytes     = new Uint8Array(imgBuffer)
    let base64 = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      base64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    base64 = btoa(base64)

    const contentType = imgResp.headers.get('content-type') || 'image/jpeg'
    const mediaType   = contentType.includes('png') ? 'image/png'
                      : contentType.includes('webp') ? 'image/webp'
                      : 'image/jpeg'

    // ── 2. Leer factura con Claude Vision ──────────────────────
    const prompt = `Analizá esta imagen de una factura o ticket de compra de un proveedor argentino.

Extraé TODA la información posible y respondé SOLO con JSON válido, sin markdown:
{
  "proveedor": "nombre del proveedor o empresa emisora",
  "fecha": "fecha en formato YYYY-MM-DD, si no está clara usá null",
  "nro_factura": "número de factura si aparece, sino null",
  "tipo_factura": "A, B o C según el tipo, sino null",
  "items": [
    {
      "nombre": "descripción del producto tal como aparece en la factura",
      "cantidad": número,
      "precio_unitario": número sin símbolos,
      "subtotal": número sin símbolos
    }
  ],
  "neto": total sin IVA como número,
  "iva_porcentaje": porcentaje de IVA (21, 10.5, 27, o 0),
  "iva_monto": monto de IVA como número,
  "total": total con IVA como número,
  "moneda": "ARS",
  "observaciones": "cualquier dato relevante que no encaje en los campos anteriores"
}

Si no podés leer algún campo con claridad, usá null. Si hay múltiples items, incluílos todos.
Si es un ticket simple sin items detallados, ponés un solo item con el concepto general.`

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-3-haiku-20240307',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    if (!claudeResp.ok) {
      const err = await claudeResp.text()
      throw new Error(`Claude error ${claudeResp.status}: ${err}`)
    }

    const claudeData = await claudeResp.json()
    const rawText    = claudeData.content[0].text
    const clean      = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const factura    = JSON.parse(clean)

    console.log('Factura extraída:', JSON.stringify(factura))

    // ── 3. Comparar precios con compras anteriores ─────────────
    const alertas = []

    if (empresa_id && factura.items?.length > 0) {
      for (const item of factura.items) {
        // Buscar producto similar por nombre
        const { data: productos } = await db
          .from('producto')
          .select('id, nombre, precio_costo')
          .eq('empresa_id', empresa_id)
          .ilike('nombre', `%${item.nombre.split(' ')[0]}%`)
          .limit(3)

        if (productos?.length > 0) {
          const prod = productos[0]
          if (prod.precio_costo && prod.precio_costo > 0 && item.precio_unitario > 0) {
            const variacion = Math.round(((item.precio_unitario - prod.precio_costo) / prod.precio_costo) * 100)
            if (Math.abs(variacion) > 3) {
              alertas.push({
                producto_id:    prod.id,
                nombre:         prod.nombre,
                precio_anterior: prod.precio_costo,
                precio_nuevo:   item.precio_unitario,
                variacion,
                subio:          variacion > 0,
              })
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, factura, alertas }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('Error en leer-factura:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
