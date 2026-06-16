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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { empresa_id } = await req.json()
    if (!empresa_id) throw new Error('Falta empresa_id')

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Clientes de fiado de la empresa
    const { data: clientes } = await db
      .from('cliente_fiado')
      .select('id, nombre, telefono, nota, saldo_actual, limite_fiado, es_simulacion, created_at')
      .eq('empresa_id', empresa_id)
      .order('saldo_actual', { ascending: false })

    // Movimientos de la empresa
    const { data: movs } = await db
      .from('movimiento_fiado')
      .select('id, cliente_fiado_id, tipo, monto, descripcion, registrado_por, es_simulacion, created_at')
      .eq('empresa_id', empresa_id)
      .order('created_at', { ascending: false })

    // Nombres de quién registró cada movimiento
    const userIds = [...new Set((movs || []).map(m => m.registrado_por).filter(Boolean))]
    const { data: profiles } = userIds.length
      ? await db.from('profile').select('id, nombre').in('id', userIds)
      : { data: [] }
    const nombrePorId: Record<string, string> = {}
    ;(profiles || []).forEach(p => { nombrePorId[p.id] = p.nombre })

    const movimientos = (movs || []).map(m => ({
      ...m,
      registrado_nombre: m.registrado_por ? (nombrePorId[m.registrado_por] || 'Usuario') : null,
    }))

    // Resumen
    const totalFiado = (movs || []).filter(m => m.tipo === 'fiado').reduce((s, m) => s + Number(m.monto), 0)
    const totalPagos = (movs || []).filter(m => m.tipo === 'pago').reduce((s, m) => s + Number(m.monto), 0)
    const saldoTotal = (clientes || []).reduce((s, c) => s + (Number(c.saldo_actual) > 0 ? Number(c.saldo_actual) : 0), 0)

    return json({
      ok: true,
      clientes: clientes || [],
      movimientos,
      resumen: {
        total_clientes:    (clientes || []).length,
        total_movimientos: (movs || []).length,
        total_fiado:       totalFiado,
        total_pagos:       totalPagos,
        saldo_total:       saldoTotal,
      },
    })

  } catch (e) {
    console.error('actividad-fiado error:', e)
    return json({ ok: false, error: String((e as Error).message || e) })
  }
})
