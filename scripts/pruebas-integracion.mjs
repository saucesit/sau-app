/**
 * Capa de lectura para integraciones (migración 0050 + edge function
 * reporte-taller).
 *
 * Crea sus propias credenciales de prueba sobre TALLER SAN MARTÍN, las usa, y
 * las borra al final. NUNCA crea una credencial de Forani ni toca sus datos.
 *
 * Lo que fija: que sin clave válida no se entre, que una clave quede atada a
 * una sola empresa aunque se intente forzar otra, que el contrato devuelva
 * exactamente los campos acordados y ni uno más, y que la clave no sirva para
 * absolutamente nada fuera de esta función.
 *
 *   node scripts/pruebas-integracion.mjs
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const PROYECTOS_AUTORIZADOS = ['cezrotffjvqmymtdjhdw']
const BR = String.fromCharCode(10)

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(BR)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const SUPA = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const ref  = (String(SUPA).match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1]
if (!PROYECTOS_AUTORIZADOS.includes(ref)) {
  console.error(`Destino no autorizado: ${SUPA}`); process.exit(1)
}
console.log(`Proyecto autorizado: ${ref}`)

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

// La clave de servicio se pide a la CLI y no se escribe en ningún archivo.
const salida = execSync(`supabase projects api-keys --project-ref ${ref}`,
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const fila = salida.split(BR).find(l => l.includes('service_role'))
const SERVICE = (fila.match(/(eyJ[A-Za-z0-9_\-.]+|sb_secret_[A-Za-z0-9_\-]+)/) || [])[1]
if (!SERVICE) { console.error('No pude leer la clave de servicio'); process.exit(1) }
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

const sql = async (fn, args) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: SH, body: JSON.stringify(args) })
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { ok: r.ok, status: r.status, body: b }
}

/** Llama a la función de reportes como lo haría n8n. */
const api = async (clave, query, metodo = 'GET') => {
  const r = await fetch(`${SUPA}/functions/v1/reporte-taller?${query}`, {
    method: metodo,
    headers: clave ? { Authorization: `Bearer ${clave}` } : {},
  })
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { status: r.status, body: b }
}

// ── Preparación ───────────────────────────────────────────────────
const emps = await fetch(`${SUPA}/rest/v1/empresa?select=id,nombre_fantasia`, { headers: SH })
const empresas = await emps.json()
const SANMARTIN = empresas.find(e => e.nombre_fantasia === 'TALLER SAN MARTÍN')
const FORANI    = empresas.find(e => e.nombre_fantasia === 'TALLER FORANI')
if (!SANMARTIN || !FORANI) { console.error('No ubiqué las empresas'); process.exit(1) }

const marca = Date.now() % 100000
const creadas = []
const crear = async (nombre, dias = 180, alcances = null) => {
  const r = await sql('integracion_crear_clave', {
    p_empresa: SANMARTIN.id, p_nombre: `${nombre}-${marca}`, p_dias: dias,
    ...(alcances ? { p_alcances: alcances } : {}) })
  if (!r.ok) { console.error('No pude crear la clave:', JSON.stringify(r.body)); process.exit(1) }
  creadas.push(r.body.id)
  return r.body
}

const viva     = await crear('PRUEBA-VIVA')
const vencida  = await crear('PRUEBA-VENCIDA', -1)
const revocada = await crear('PRUEBA-REVOCADA')
const acotada  = await crear('PRUEBA-SOLO-RESUMEN', 180, ['resumen'])
await fetch(`${SUPA}/rest/v1/integracion_api_key?id=eq.${revocada.id}`, {
  method: 'PATCH', headers: SH, body: JSON.stringify({ activa: false }) })

console.log(`${BR}Credenciales de prueba en TALLER SAN MARTÍN: ${creadas.length}${BR}`)

// ── 1. Autenticación ──────────────────────────────────────────────
console.log('1. SIN CREDENCIAL VÁLIDA NO SE ENTRA')
{
  check('sin clave → 401',        (await api(null, 'recurso=resumen')).status === 401)
  check('clave inventada → 401',  (await api('sauk_' + 'a'.repeat(64), 'recurso=resumen')).status === 401)
  check('clave vacía → 401',      (await api('', 'recurso=resumen')).status === 401)
  check('clave vencida → 401',    (await api(vencida.clave, 'recurso=resumen')).status === 401)
  check('clave revocada → 401',   (await api(revocada.clave, 'recurso=resumen')).status === 401)

  const r = await api(viva.clave, 'recurso=resumen')
  check('clave válida → 200', r.status === 200, JSON.stringify(r.body).slice(0, 80))

  // Los errores no distinguen entre inventada, vencida y revocada
  const msgs = new Set()
  for (const c of ['sauk_' + 'b'.repeat(64), vencida.clave, revocada.clave]) {
    msgs.add(JSON.stringify((await api(c, 'recurso=resumen')).body))
  }
  check('los tres rechazos dicen lo mismo', msgs.size === 1, JSON.stringify([...msgs]))
}

// ── 2. Aislamiento por empresa ────────────────────────────────────
console.log(`${BR}2. LA CLAVE ESTÁ ATADA A SU EMPRESA`)
{
  const base = await api(viva.clave, 'recurso=vehiculos&estado=todos&limite=200')
  const patentes = (base.body.datos || []).map(v => v.patente)
  check('devuelve vehículos de San Martín', patentes.length > 0, String(patentes.length))

  // Las patentes de Forani NO pueden aparecer
  const fr = await fetch(`${SUPA}/rest/v1/vehiculo?empresa_id=eq.${FORANI.id}&select=patente&limit=400`, { headers: SH })
  const deForani = new Set((await fr.json()).map(v => v.patente))
  const colados = patentes.filter(p => deForani.has(p))
  check('ninguna patente de Forani se coló', colados.length === 0, JSON.stringify(colados))

  // Intentar forzar la otra empresa por todos los caminos
  const intentos = [
    `recurso=vehiculos&empresa_id=${FORANI.id}`,
    `recurso=vehiculos&empresa=${FORANI.id}`,
    `recurso=vehiculos&p_empresa=${FORANI.id}`,
    `recurso=vehiculos&estado=todos&empresa_id=${FORANI.id}&limite=200`,
  ]
  let iguales = true
  for (const q of intentos) {
    const r = await api(viva.clave, q)
    const p = (r.body.datos || []).map(v => v.patente)
    if (p.some(x => deForani.has(x))) iguales = false
  }
  check('forzar empresa_id de Forani por query no cambia nada', iguales)

  // Y por header
  const conHeader = await fetch(`${SUPA}/functions/v1/reporte-taller?recurso=vehiculos&estado=todos&limite=200`, {
    headers: { Authorization: `Bearer ${viva.clave}`, 'x-empresa-id': FORANI.id, 'empresa_id': FORANI.id } })
  const ch = await conHeader.json()
  check('ni por header',
        !(ch.datos || []).some(v => deForani.has(v.patente)))
}

// ── 3. Lista blanca de recursos ───────────────────────────────────
console.log(`${BR}3. SOLO LOS CINCO RECURSOS`)
{
  for (const r of ['resumen', 'vehiculos', 'movimientos', 'facturacion', 'adjuntos']) {
    check(`${r} responde`, (await api(viva.clave, `recurso=${r}`)).status === 200)
  }
  for (const r of ['usuarios', 'membresias', 'empresa', 'permisos', 'profile', '', 'vehiculo', 'todo']) {
    const res = await api(viva.clave, `recurso=${r}`)
    check(`"${r || '(vacío)'}" rechazado`, res.status === 400, `status ${res.status}`)
  }
  const sin = await api(acotada.clave, 'recurso=facturacion')
  check('una clave acotada a resumen no accede a facturación', sin.status === 403, `status ${sin.status}`)
  check('pero sí a su recurso', (await api(acotada.clave, 'recurso=resumen')).status === 200)
}

// ── 4. Solo lectura ───────────────────────────────────────────────
console.log(`${BR}4. SOLO LECTURA`)
{
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await api(viva.clave, 'recurso=resumen', m)
    check(`${m} rechazado`, r.status === 405, `status ${r.status}`)
  }
}

// ── 5. Contrato: lista blanca exacta de campos ────────────────────
console.log(`${BR}5. EL CONTRATO NO FILTRA CAMPOS DE MÁS`)
{
  const esperado = {
    vehiculos: ['patente','vehiculo','cliente','compania','siniestro','etapa','en_etapa_desde',
                'ingreso','pactada','entrega','dias_en_taller','fuera_de_plazo','excepcion',
                'excepcion_desde','panos','trabajo_marcado'],
    movimientos: ['fecha','patente','tipo','etapa_anterior','etapa_nueva','etapa','usuario','detalle'],
    facturacion: ['patente','etapa','importes'],
    adjuntos: ['patente','tipo','nombre','fecha','autor','anulado','anulado_motivo'],
  }
  for (const [recurso, campos] of Object.entries(esperado)) {
    const r = await api(viva.clave, `recurso=${recurso}&estado=todos&limite=50`)
    const filas = r.body.datos || []
    if (!filas.length) { console.log(`  (sin filas para ${recurso})`); continue }
    const vistos = [...new Set(filas.flatMap(f => Object.keys(f)))].sort()
    check(`${recurso}: exactamente los campos acordados`,
          JSON.stringify(vistos) === JSON.stringify([...campos].sort()),
          `sobran/faltan: ${JSON.stringify(vistos)}`)
  }

  // Nada interno, en NINGÚN recurso
  const prohibido = ['empresa_id','autor_id','anulado_por','path','vehiculo_id','id',
                     'factura_compania','factura_franquicia','factura_particular',
                     'origen_import','orden_adicional','created_at','updated_at','clave_hash']
  for (const recurso of ['resumen','vehiculos','movimientos','facturacion','adjuntos']) {
    const r = await api(viva.clave, `recurso=${recurso}&estado=todos&limite=200`)
    const texto = JSON.stringify(r.body)
    const encontrados = prohibido.filter(p => texto.includes(`"${p}"`))
    check(`${recurso}: sin campos internos`, encontrados.length === 0, JSON.stringify(encontrados))
  }

  // Ningún UUID suelto en la respuesta
  for (const recurso of ['vehiculos','movimientos','facturacion','adjuntos']) {
    const r = await api(viva.clave, `recurso=${recurso}&estado=todos&limite=200`)
    const uuids = JSON.stringify(r.body).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []
    check(`${recurso}: sin UUID internos`, uuids.length === 0, JSON.stringify(uuids.slice(0, 2)))
  }

  // Adjuntos: nada que permita bajar un archivo
  const adj = await api(viva.clave, 'recurso=adjuntos&limite=200')
  const txt = JSON.stringify(adj.body)
  check('adjuntos: sin path, URL ni firma',
        !/https?:\/\//.test(txt) && !txt.includes('storage') && !txt.includes('signed'),
        txt.slice(0, 100))
}

// ── 6. Límites ────────────────────────────────────────────────────
console.log(`${BR}6. LÍMITES`)
{
  const r = await api(viva.clave, 'recurso=vehiculos&estado=todos&limite=99999')
  check('limite=99999 se recorta a 200', (r.body.datos || []).length <= 200,
        String((r.body.datos || []).length))
  check('y lo informa en la página', r.body.pagina?.limite === 200, JSON.stringify(r.body.pagina))

  const neg = await api(viva.clave, 'recurso=vehiculos&limite=-5')
  check('limite negativo no rompe', neg.status === 200)

  const ancho = await api(viva.clave, 'recurso=movimientos&desde=2020-01-01&hasta=2026-12-31&limite=200')
  const fechas = (ancho.body.datos || []).map(m => new Date(m.fecha))
  const masViejo = fechas.length ? Math.min(...fechas.map(f => f.getTime())) : Date.now()
  const dias = (Date.now() - masViejo) / 86400000
  check('rango de 6 años se recorta a 90 días', dias <= 92, `el más viejo tiene ${Math.round(dias)} días`)
  check('y lo informa', ancho.body.ventana_maxima_dias === 90)
}

// ── 7. La clave no sirve para nada más ────────────────────────────
console.log(`${BR}7. LA CLAVE NO ABRE NINGUNA OTRA PUERTA`)
{
  const k = viva.clave
  // Como credencial de Supabase
  for (const [etiqueta, headers] of [
    ['como apikey',        { apikey: k }],
    ['como Bearer',        { apikey: ANON, Authorization: `Bearer ${k}` }],
    ['como apikey+Bearer', { apikey: k, Authorization: `Bearer ${k}` }],
  ]) {
    const r = await fetch(`${SUPA}/rest/v1/vehiculo?select=patente&limit=1`, { headers })
    check(`consultar tablas ${etiqueta} → rechazado`, !r.ok, `status ${r.status}`)
  }

  // Iniciar sesión en SAU
  const login = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'integracion@prueba.sau', password: k }) })
  check('iniciar sesión con la clave → falla', !login.ok, `status ${login.status}`)

  // Llamar RPC operativas del taller
  for (const fn of ['taller_validar_avance', 'taller_registrar_monto', 'taller_retroceder_etapa']) {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}) })
    check(`llamar ${fn} → rechazado`, !r.ok, `status ${r.status}`)
  }

  // Las propias RPC de integración, desde afuera
  for (const fn of ['integracion_resumen', 'integracion_validar_clave', 'integracion_crear_clave']) {
    const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}) })
    check(`${fn} no es invocable con anon`, !r.ok, `status ${r.status}`)
  }

  // Storage
  const st = await fetch(`${SUPA}/storage/v1/object/list/taller`, {
    method: 'POST', headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 5 }) })
  check('listar Storage con la clave → rechazado', !st.ok, `status ${st.status}`)
}

// ── 8. Rastro: último acceso y logs ───────────────────────────────
console.log(`${BR}8. ÚLTIMO ACCESO Y REGISTRO`)
{
  const f = await fetch(`${SUPA}/rest/v1/integracion_api_key?id=eq.${viva.id}&select=ultimo_acceso,ultima_ip,prefijo`, { headers: SH })
  const k = (await f.json())[0]
  check('ultimo_acceso quedó registrado', !!k.ultimo_acceso, JSON.stringify(k.ultimo_acceso))
  check('el prefijo identifica la clave', k.prefijo?.startsWith('sauk_'), k.prefijo)

  const l = await fetch(`${SUPA}/rest/v1/integracion_log?api_key_id=eq.${viva.id}&select=*&order=creado_en.desc&limit=5`, { headers: SH })
  const logs = await l.json()
  check('hay registros de acceso', logs.length > 0, String(logs.length))
  check('con recurso, filas y status',
        logs[0]?.recurso && logs[0]?.status !== null && logs[0]?.filas !== null,
        JSON.stringify(logs[0]))
  const campos = Object.keys(logs[0] || {})
  check('el log NO guarda payloads',
        !campos.some(c => /payload|respuesta|body|datos/.test(c)), JSON.stringify(campos))

  // Un rechazo también queda registrado
  await api(viva.clave, 'recurso=inventado')
  const l2 = await fetch(`${SUPA}/rest/v1/integracion_log?api_key_id=eq.${viva.id}&status=eq.400&select=recurso&limit=1`, { headers: SH })
  check('los rechazos también se registran', (await l2.json()).length > 0)
}

// ── 9. Revocación inmediata ───────────────────────────────────────
console.log(`${BR}9. REVOCACIÓN INMEDIATA`)
{
  check('antes de revocar entra', (await api(viva.clave, 'recurso=resumen')).status === 200)
  await fetch(`${SUPA}/rest/v1/integracion_api_key?id=eq.${viva.id}`, {
    method: 'PATCH', headers: SH, body: JSON.stringify({ activa: false }) })
  check('después de revocar → 401', (await api(viva.clave, 'recurso=resumen')).status === 401)
}

// ── 10. Forani no fue tocado por esta suite ───────────────────────
console.log(`${BR}10. FORANI INTACTO`)
{
  const f = await fetch(`${SUPA}/rest/v1/integracion_api_key?empresa_id=eq.${FORANI.id}&select=id`, { headers: SH })
  check('NO existe ninguna credencial de Forani', (await f.json()).length === 0)

  const l = await fetch(`${SUPA}/rest/v1/integracion_log?select=api_key_id`, { headers: SH })
  const ids = new Set((await l.json()).map(x => x.api_key_id))
  check('todos los accesos registrados son de claves de prueba',
        [...ids].every(id => id === null || creadas.includes(id)))
}

// ── Limpieza ──────────────────────────────────────────────────────
console.log(`${BR}LIMPIEZA`)
{
  for (const id of creadas) {
    await fetch(`${SUPA}/rest/v1/integracion_log?api_key_id=eq.${id}`, { method: 'DELETE', headers: SH })
    await fetch(`${SUPA}/rest/v1/integracion_api_key?id=eq.${id}`, { method: 'DELETE', headers: SH })
  }
  const q = await fetch(`${SUPA}/rest/v1/integracion_api_key?select=id`, { headers: SH })
  const quedan = await q.json()
  check('no quedó ninguna credencial', quedan.length === 0, `quedan ${quedan.length}`)
  const ql = await fetch(`${SUPA}/rest/v1/integracion_log?select=id`, { headers: SH })
  check('no quedó ningún registro de prueba', (await ql.json()).length === 0)
}

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
