/**
 * Pruebas del módulo taller con usuarios reales de dos empresas distintas.
 * Cada usuario se autentica de verdad y las llamadas van por la API pública,
 * así que lo que se prueba son las policies y las funciones, no la interfaz.
 *
 * No toca datos demo: trabaja solo sobre las empresas ZZ PRUEBA.
 */
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const SUPA = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const PASS = 'PruebaTaller2026'

const EMPRESA_A = '11111111-aaaa-4aaa-8aaa-111111111111'
const EMPRESA_B = '22222222-bbbb-4bbb-8bbb-222222222222'

let ok = 0, fail = 0
const fallos = []

function check(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`  PASA   ${nombre}`) }
  else { fail++; fallos.push(nombre); console.log(`  FALLA  ${nombre}${detalle ? ' → ' + detalle : ''}`) }
}

async function login(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No se pudo autenticar ${email}: ${JSON.stringify(j)}`)
  return { token: j.access_token, uid: j.user.id, email }
}

const h = (u, extra = {}) => ({
  apikey: ANON, Authorization: `Bearer ${u.token}`,
  'Content-Type': 'application/json', ...extra,
})

async function rest(u, path, opts = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: h(u, opts.headers) })
  const txt = await r.text()
  let body = null
  try { body = txt ? JSON.parse(txt) : null } catch { body = txt }
  return { status: r.status, ok: r.ok, body }
}

const rpc = (u, fn, args) =>
  rest(u, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

async function subir(u, path, contenido) {
  const r = await fetch(`${SUPA}/storage/v1/object/taller/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'text/plain' },
    body: contenido,
  })
  return { status: r.status, ok: r.ok }
}

async function firmar(u, path) {
  const r = await fetch(`${SUPA}/storage/v1/object/sign/taller/${path}`, {
    method: 'POST',
    headers: h(u),
    body: JSON.stringify({ expiresIn: 60 }),
  })
  return { status: r.status, ok: r.ok }
}

// ──────────────────────────────────────────────────────────────────
const users = {}
for (const [k, mail] of Object.entries({
  operario:    'taller-a-operario@prueba.sau',
  pintor:      'taller-a-pintor@prueba.sau',
  coordinador: 'taller-a-coordinador@prueba.sau',
  admin:       'taller-a-admin@prueba.sau',
  completo:    'taller-a-completo@prueba.sau',
  otraEmpresa: 'taller-b-admin@prueba.sau',
})) users[k] = await login(mail)

const { body: vs } = await rest(users.admin, `vehiculo?patente=eq.ZZTEST01&select=id,etapa`)
const VEH = vs[0].id
console.log(`\nVehículo de prueba: ${VEH} (etapa ${vs[0].etapa})\n`)

// ── 1. Aislamiento entre empresas ────────────────────────────────
console.log('1. AISLAMIENTO ENTRE EMPRESAS')
{
  const r = await rest(users.otraEmpresa, `vehiculo?id=eq.${VEH}&select=id`)
  check('empresa B no ve el vehículo de la empresa A', Array.isArray(r.body) && r.body.length === 0,
        JSON.stringify(r.body))

  const a = await rpc(users.otraEmpresa, 'taller_validar_avance', { p_vehiculo: VEH })
  check('empresa B no puede avanzar un vehículo de la empresa A', !a.ok)

  const m = await rest(users.otraEmpresa, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=monto_compania`)
  check('empresa B no ve los montos de la empresa A', Array.isArray(m.body) && m.body.length === 0)
}

// ── 2. Montos ────────────────────────────────────────────────────
console.log('\n2. MONTOS (tabla separada)')
{
  const o = await rest(users.operario,    `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
  check('operario no lee montos, ni por API', Array.isArray(o.body) && o.body.length === 0)

  const c = await rest(users.coordinador, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
  check('coordinador no lee montos', Array.isArray(c.body) && c.body.length === 0)

  const a = await rest(users.admin,       `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
  check('administración sí lee montos', Array.isArray(a.body) && a.body.length === 1)

  check('la fila de montos se creó sola con el vehículo',
        Array.isArray(a.body) && a.body[0]?.monto_compania === 0)
  check('la empresa del monto coincide con la del vehículo',
        a.body?.[0]?.empresa_id === EMPRESA_A, a.body?.[0]?.empresa_id)

  const cob = await rpc(users.operario, 'taller_registrar_cobro',
                        { p_vehiculo: VEH, p_campo: 'cobro_compania', p_valor: true })
  check('operario no puede registrar cobros', !cob.ok)
}

// ── 3. Flujo de etapas ───────────────────────────────────────────
console.log('\n3. FLUJO DE ETAPAS')
{
  const salto = await rest(users.coordinador, `vehiculo?id=eq.${VEH}`, {
    method: 'PATCH', body: JSON.stringify({ etapa: 'entregado' }),
    headers: { Prefer: 'return=representation' },
  })
  check('UPDATE directo no puede saltear etapas', !salto.ok,
        `status ${salto.status}`)

  const e1 = await rpc(users.coordinador, 'taller_validar_avance', { p_vehiculo: VEH })
  check('no se avanza sin que el operario marque el trabajo', !e1.ok)

  const e2 = await rpc(users.admin, 'taller_marcar_trabajo_hecho', { p_vehiculo: VEH })
  check('administración no marca trabajo (no lo ejecuta)', !e2.ok)

  const e3 = await rpc(users.operario, 'taller_marcar_trabajo_hecho', { p_vehiculo: VEH })
  check('operario marca su trabajo como hecho', e3.ok, JSON.stringify(e3.body))

  const e4 = await rpc(users.operario, 'taller_validar_avance', { p_vehiculo: VEH })
  check('operario no puede validar su propio trabajo', !e4.ok)

  const e5 = await rpc(users.coordinador, 'taller_validar_avance', { p_vehiculo: VEH })
  check('coordinador valida y avanza', e5.ok && e5.body === 'preparacion',
        JSON.stringify(e5.body))

  const e6 = await rpc(users.coordinador, 'taller_entregar', { p_vehiculo: VEH, p_fecha: null })
  check('no se entrega desde una etapa intermedia', !e6.ok)

  const { body: est } = await rest(users.admin, `vehiculo?id=eq.${VEH}&select=etapa,trabajo_hecho`)
  check('al avanzar se reinicia el trabajo pendiente',
        est[0].etapa === 'preparacion' && est[0].trabajo_hecho === false,
        JSON.stringify(est[0]))
}

// ── 4. Excepciones ───────────────────────────────────────────────
console.log('\n4. EXCEPCIONES')
{
  const x1 = await rpc(users.operario, 'taller_cambiar_excepcion',
                       { p_vehiculo: VEH, p_excepcion: 'mecanica' })
  check('operario puede activar una excepción', x1.ok, JSON.stringify(x1.body))

  const { body: e } = await rest(users.admin, `vehiculo?id=eq.${VEH}&select=etapa,excepcion`)
  check('la excepción no cambia la etapa',
        e[0].etapa === 'preparacion' && e[0].excepcion === 'mecanica', JSON.stringify(e[0]))

  const x2 = await rpc(users.operario, 'taller_cambiar_excepcion',
                       { p_vehiculo: VEH, p_excepcion: 'inventada' })
  check('no se acepta una excepción inválida', !x2.ok)

  await rpc(users.operario, 'taller_cambiar_excepcion', { p_vehiculo: VEH, p_excepcion: null })
  const { body: e2 } = await rest(users.admin, `vehiculo?id=eq.${VEH}&select=etapa,excepcion`)
  check('al levantarla, retoma en la misma etapa',
        e2[0].etapa === 'preparacion' && e2[0].excepcion === null)
}

// ── 5. Bitácora ──────────────────────────────────────────────────
console.log('\n5. BITÁCORA')
{
  const n1 = await rest(users.operario, 'vehiculo_evento', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ vehiculo_id: VEH, tipo: 'nota', texto: 'Nota de prueba del operario' }),
  })
  check('operario puede agregar una nota', n1.ok, JSON.stringify(n1.body))
  check('el autor de la nota lo pone el servidor',
        n1.body?.[0]?.autor_id === users.operario.uid, n1.body?.[0]?.autor_id)

  const n2 = await rest(users.operario, 'vehiculo_evento', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ vehiculo_id: VEH, tipo: 'nota', texto: 'Autor falseado',
                           autor_id: users.admin.uid }),
  })
  check('no se puede falsear el autor de una nota',
        n2.body?.[0]?.autor_id === users.operario.uid, n2.body?.[0]?.autor_id)

  const n3 = await rest(users.coordinador, 'vehiculo_evento', {
    method: 'POST',
    body: JSON.stringify({ vehiculo_id: VEH, tipo: 'avance', texto: 'Avance inventado' }),
  })
  check('el navegador no puede inventar eventos de avance', !n3.ok)

  const n4 = await rest(users.otraEmpresa, 'vehiculo_evento', {
    method: 'POST',
    body: JSON.stringify({ vehiculo_id: VEH, tipo: 'nota', texto: 'Nota de otra empresa' }),
  })
  check('empresa B no puede escribir en la bitácora de A', !n4.ok)
}

// ── 6. Storage ───────────────────────────────────────────────────
console.log('\n6. STORAGE')
{
  const ruta = `${EMPRESA_A}/${VEH}/prueba-${Date.now()}.txt`

  const s1 = await subir(users.coordinador, ruta, 'contenido de prueba')
  check('coordinador sube un archivo a su empresa', s1.ok, `status ${s1.status}`)

  const s2 = await subir(users.operario, `${EMPRESA_A}/${VEH}/operario-${Date.now()}.txt`, 'x')
  check('operario no puede subir archivos', !s2.ok, `status ${s2.status}`)

  const s3 = await subir(users.otraEmpresa, `${EMPRESA_A}/${VEH}/intruso-${Date.now()}.txt`, 'x')
  check('empresa B no puede subir a la carpeta de A', !s3.ok, `status ${s3.status}`)

  const s4 = await firmar(users.coordinador, ruta)
  check('coordinador firma la URL de su archivo', s4.ok, `status ${s4.status}`)

  const s5 = await firmar(users.operario, ruta)
  check('operario puede leer archivos de su empresa', s5.ok, `status ${s5.status}`)

  const s6 = await firmar(users.otraEmpresa, ruta)
  check('empresa B no puede firmar un archivo de A', !s6.ok, `status ${s6.status}`)
}

// ── 7. Entrega completa ──────────────────────────────────────────
console.log('\n7. ENTREGA')
{
  for (const etapa of ['preparacion', 'pintura', 'pre_entrega']) {
    await rpc(users.operario, 'taller_marcar_trabajo_hecho', { p_vehiculo: VEH })
    await rpc(users.coordinador, 'taller_validar_avance', { p_vehiculo: VEH })
  }
  const { body: t } = await rest(users.admin, `vehiculo?id=eq.${VEH}&select=etapa`)
  check('la cadena completa llega a terminado', t[0].etapa === 'terminado', t[0].etapa)

  const d1 = await rpc(users.operario, 'taller_entregar', { p_vehiculo: VEH, p_fecha: null })
  check('operario no puede entregar', !d1.ok)

  const d2 = await rpc(users.coordinador, 'taller_entregar', { p_vehiculo: VEH, p_fecha: null })
  check('coordinador entrega desde terminado', d2.ok, JSON.stringify(d2.body))

  const d3 = await rpc(users.coordinador, 'taller_validar_avance', { p_vehiculo: VEH })
  check('un vehículo entregado ya no avanza', !d3.ok)
}

// ── 8. Especialidad del operario ─────────────────────────────────
console.log('\n8. ESPECIALIDAD DEL OPERARIO')
{
  // Vehículo nuevo, cargado por el coordinador (prueba también el alta)
  const alta = await rest(users.coordinador, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA_A, patente: `ZZ ESP ${Date.now() % 10000}`,
      vehiculo: 'VW GOL', cliente_nombre: 'PRUEBA ESPECIALIDAD',
      compania: 'Particular', etapa: 'chapa',
      fecha_ingreso: new Date().toISOString().slice(0, 10),
    }),
  })
  check('coordinador puede dar de alta un vehículo', alta.ok, JSON.stringify(alta.body))
  const V2 = alta.body?.[0]?.id

  const p1 = await rpc(users.pintor, 'taller_marcar_trabajo_hecho', { p_vehiculo: V2 })
  check('el pintor no puede marcar trabajo en chapa', !p1.ok,
        JSON.stringify(p1.body?.message || p1.body))

  const o1 = await rpc(users.operario, 'taller_marcar_trabajo_hecho', { p_vehiculo: V2 })
  check('el operario sin especialidad sí puede', o1.ok)

  // Lo llevamos hasta pintura para probar el caso inverso
  await rpc(users.coordinador, 'taller_validar_avance', { p_vehiculo: V2 })   // → preparacion
  await rpc(users.operario,    'taller_marcar_trabajo_hecho', { p_vehiculo: V2 })
  await rpc(users.coordinador, 'taller_validar_avance', { p_vehiculo: V2 })   // → pintura

  const p2 = await rpc(users.pintor, 'taller_marcar_trabajo_hecho', { p_vehiculo: V2 })
  check('el pintor sí puede marcar trabajo en pintura', p2.ok, JSON.stringify(p2.body))

  const { body: fin } = await rest(users.admin, `vehiculo?id=eq.${V2}&select=etapa,patente`)
  check('el vehículo quedó en pintura', fin[0].etapa === 'pintura', fin[0].etapa)
  console.log(`  (vehículo de prueba creado: ${fin[0].patente})`)
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
