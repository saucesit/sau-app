import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Capa de lectura para integraciones externas del Taller.
 *
 * Corre sin verificación de JWT porque NO atiende usuarios de SAU: atiende
 * integraciones, con su propia credencial. Toda la autorización se resuelve
 * acá adentro, y la clave no abre ninguna sesión.
 *
 * El aislamiento por empresa es el punto central: el empresa_id sale SIEMPRE
 * de la fila de la credencial. No se lee del query, ni del header, ni del
 * body. No hay forma de expresarlo desde afuera porque el código no lo mira.
 *
 * Solo lectura. No hay una sola rama que escriba datos del taller: lo único
 * que esta función escribe es su propio registro de accesos.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

/** Los cinco recursos aprobados. Lo que no está acá, no existe. */
const RECURSOS = ['resumen', 'vehiculos', 'movimientos', 'facturacion', 'adjuntos'] as const
type Recurso = typeof RECURSOS[number]

const TOPE_FILAS = 200
const TOPE_DIAS  = 90

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })

/**
 * Los errores no cuentan de más. "No autorizado" para una clave inventada,
 * vencida o revocada es la misma respuesta a propósito: distinguirlas le diría
 * a quien prueba claves cuál de ellas existe.
 */
const noAutorizado = () => json({ error: 'No autorizado' }, 401)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Solo lectura, también en el método. Un POST no tiene a dónde ir.
  if (req.method !== 'GET') {
    return json({ error: 'Esta integración es de solo lectura' }, 405)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  // ── 1. La credencial ────────────────────────────────────────────
  const auth = req.headers.get('Authorization') ?? ''
  const clave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!clave) return noAutorizado()

  const { data: k } = await admin.rpc('integracion_validar_clave', {
    p_clave: clave, p_ip: ip,
  })
  if (!k) return noAutorizado()

  // Desde acá, TODO se resuelve con este empresa_id. Es el de la credencial.
  const empresa: string = k.empresa_id

  const url = new URL(req.url)
  const recurso = (url.searchParams.get('recurso') ?? '') as Recurso

  const registrar = (filas: number, status: number) =>
    admin.rpc('integracion_registrar_acceso', {
      p_api_key_id: k.id, p_prefijo: k.prefijo, p_recurso: recurso || '(ninguno)',
      p_filas: filas, p_status: status, p_ip: ip,
    }).then(() => {}, () => {})   // el log nunca rompe la respuesta

  if (!RECURSOS.includes(recurso)) {
    await registrar(0, 400)
    return json({ error: 'Recurso no disponible', disponibles: RECURSOS }, 400)
  }

  // Una credencial puede tener menos alcances que los cinco.
  if (Array.isArray(k.alcances) && !k.alcances.includes(recurso)) {
    await registrar(0, 403)
    return json({ error: 'Esta integración no tiene acceso a ese recurso' }, 403)
  }

  // ── 2. Parámetros, siempre acotados ─────────────────────────────
  const entero = (nombre: string, porDefecto: number, tope: number) => {
    const n = Number(url.searchParams.get(nombre))
    if (!Number.isFinite(n) || n < 0) return porDefecto
    return Math.min(Math.floor(n), tope)
  }
  const limite = entero('limite', TOPE_FILAS, TOPE_FILAS)
  const salto  = entero('salto', 0, 100_000)

  const estadoPedido = url.searchParams.get('estado') ?? 'activos'
  const estado = ['activos', 'entregados', 'todos'].includes(estadoPedido)
    ? estadoPedido : 'activos'

  try {
    let datos: unknown
    let filas = 0

    switch (recurso) {
      case 'resumen': {
        const { data, error } = await admin.rpc('integracion_resumen', { p_empresa: empresa })
        if (error) throw error
        datos = data; filas = 1
        break
      }
      case 'vehiculos': {
        const { data, error } = await admin.rpc('integracion_vehiculos', {
          p_empresa: empresa, p_estado: estado, p_limite: limite, p_desde: salto })
        if (error) throw error
        datos = data; filas = (data as unknown[])?.length ?? 0
        break
      }
      case 'movimientos': {
        // El rango se recorta a 90 días en la base. Acá se avisa si lo pedido
        // era más ancho, para que el consumidor no crea que tiene todo.
        const desde = url.searchParams.get('desde')
        const hasta = url.searchParams.get('hasta')
        const { data, error } = await admin.rpc('integracion_movimientos', {
          p_empresa: empresa, p_desde: desde, p_hasta: hasta,
          p_limite: limite, p_salto: salto })
        if (error) throw error
        datos = data; filas = (data as unknown[])?.length ?? 0
        break
      }
      case 'facturacion': {
        const { data, error } = await admin.rpc('integracion_facturacion', {
          p_empresa: empresa, p_estado: estado, p_limite: limite, p_salto: salto })
        if (error) throw error
        datos = data; filas = (data as unknown[])?.length ?? 0
        break
      }
      case 'adjuntos': {
        const { data, error } = await admin.rpc('integracion_adjuntos', {
          p_empresa: empresa, p_patente: url.searchParams.get('patente'),
          p_limite: limite, p_salto: salto })
        if (error) throw error
        datos = data; filas = (data as unknown[])?.length ?? 0
        break
      }
    }

    await registrar(filas, 200)

    const cuerpo: Record<string, unknown> = {
      integracion: k.nombre,
      generado: new Date().toISOString(),
      recurso,
      datos,
    }
    if (recurso !== 'resumen') {
      cuerpo.pagina = { limite, salto, devueltos: filas, hay_mas: filas === limite }
    }
    if (recurso === 'movimientos') {
      cuerpo.ventana_maxima_dias = TOPE_DIAS
    }
    return json(cuerpo)

  } catch (_err) {
    // Sin detalles del error hacia afuera: un mensaje de Postgres cuenta
    // nombres de tablas y columnas que el consumidor no tiene por qué saber.
    await registrar(0, 500)
    return json({ error: 'No se pudo generar el reporte' }, 500)
  }
})
