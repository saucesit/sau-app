/**
 * Pruebas negativas del alta de membresías.
 *
 * Cada caso acá fue posible en producción hasta la migración 0031: un usuario
 * cualquiera podía agregarse como admin de cualquier empresa y leerle todo.
 * Estas pruebas existen para que no vuelva a pasar sin que nos enteremos.
 *
 * No modifica datos de clientes: lo único que crea son invitaciones sobre la
 * empresa de prueba, y las borra al final.
 */
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const SUPA = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const PASS = 'PruebaTaller2026'

const FORANI    = 'bdd20f9b-1030-434a-96de-2418afb53760'
const EMPRESA_A = '11111111-aaaa-4aaa-8aaa-111111111111'

let ok = 0, fail = 0
const fallos = []
const check = (nombre, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  PASA   ${nombre}`) }
  else { fail++; fallos.push(nombre); console.log(`  FALLA  ${nombre}${detalle ? ' → ' + detalle : ''}`) }
}

async function login(email, clave = PASS) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: clave }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No autenticó ${email}: ${JSON.stringify(j)}`)
  return { token: j.access_token, uid: j.user.id, email }
}

const h = (u, extra = {}) => ({
  apikey: ANON, ...(u ? { Authorization: `Bearer ${u.token}` } : {}),
  'Content-Type': 'application/json', ...extra,
})

async function rest(u, path, opts = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: h(u, opts.headers) })
  const txt = await r.text()
  let body = null
  try { body = txt ? JSON.parse(txt) : null } catch { body = txt }
  return { status: r.status, ok: r.ok, body }
}

async function fn(nombre, cuerpo, u) {
  const r = await fetch(`${SUPA}/functions/v1/${nombre}`, {
    method: 'POST', headers: h(u), body: JSON.stringify(cuerpo),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const CLAVE_INVITADO = 'PruebaInvit2026'
// Email distinto en cada corrida: así la suite se puede repetir sin chocar con
// el usuario que creó la anterior.
const EMAIL_INVITADO = `invitado-${Date.now()}@prueba.sau`

const intruso = await login('taller-b-admin@prueba.sau')
// El que tiene empresa.admin en la empresa A, no el que solo administra el taller
const adminA  = await login('taller-a-completo@prueba.sau')

console.log(`\nIntruso: ${intruso.email} (empresa ZZ PRUEBA TALLER B)\n`)

// ── 1. No puede autoagregarse a otra empresa ─────────────────────
console.log('1. AUTOAGREGARSE A UNA EMPRESA AJENA')
{
  const alta = await rest(intruso, 'membresia', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      usuario_id: intruso.uid, empresa_id: FORANI, rol: 'admin',
      permisos: ['empresa.admin', 'taller.montos'], activa: true,
    }),
  })
  check('no puede crear su propia membresía en Forani', !alta.ok, `status ${alta.status}`)

  const empleado = await rest(intruso, 'membresia', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      usuario_id: intruso.uid, empresa_id: FORANI, rol: 'empleado',
      permisos: ['taller.ver'], activa: true,
    }),
  })
  check('tampoco como simple empleado', !empleado.ok, `status ${empleado.status}`)

  const enLaSuya = await rest(intruso, 'membresia', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      usuario_id: intruso.uid, empresa_id: EMPRESA_A, rol: 'admin',
      permisos: ['empresa.admin'], activa: true,
    }),
  })
  check('ni en la empresa de prueba A', !enLaSuya.ok, `status ${enLaSuya.status}`)
}

// ── 2. No puede darse permisos ───────────────────────────────────
console.log('\n2. OTORGARSE PERMISOS')
{
  const propia = await rest(intruso, `membresia?usuario_id=eq.${intruso.uid}&select=id,permisos`)
  const mia = propia.body?.[0]
  check('ve su propia membresía', Boolean(mia))

  if (mia) {
    const sube = await rest(intruso, `membresia?id=eq.${mia.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ permisos: [...mia.permisos, 'empresa.admin'] }),
    })
    const cambio = Array.isArray(sube.body) && sube.body.length > 0
    check('no puede agregarse empresa.admin a sí mismo', !cambio, `status ${sube.status}`)
  }
}

// ── 3. No puede leer nada de Forani ──────────────────────────────
console.log('\n3. LEER DATOS DE OTRA EMPRESA')
{
  const autos = await rest(intruso, `vehiculo?empresa_id=eq.${FORANI}&select=patente`)
  check('no ve los vehículos de Forani', Array.isArray(autos.body) && autos.body.length === 0,
        `devolvió ${Array.isArray(autos.body) ? autos.body.length : '?'}`)

  const montos = await rest(intruso, `vehiculo_monto?empresa_id=eq.${FORANI}&select=monto_compania`)
  check('no ve los montos de Forani', Array.isArray(montos.body) && montos.body.length === 0,
        `devolvió ${Array.isArray(montos.body) ? montos.body.length : '?'}`)

  const equipo = await rest(intruso, `membresia?empresa_id=eq.${FORANI}&select=id`)
  check('no ve el equipo de Forani', Array.isArray(equipo.body) && equipo.body.length === 0)
}

// ── 4. El padrón de empresas ya no es público ────────────────────
console.log('\n4. PADRÓN DE EMPRESAS')
{
  const sinLogin = await rest(null, 'empresa?select=razon_social')
  const filas = Array.isArray(sinLogin.body) ? sinLogin.body.length : 0
  check('sin login no se lista ninguna empresa', filas === 0, `devolvió ${filas}`)

  const conLogin = await rest(intruso, 'empresa?select=razon_social')
  const n = Array.isArray(conLogin.body) ? conLogin.body.length : 0
  check('un usuario solo ve su propia empresa', n <= 1, `devolvió ${n}`)

  const nombre = await fetch(`${SUPA}/rest/v1/rpc/empresa_nombre_publico`, {
    method: 'POST', headers: h(null), body: JSON.stringify({ p_empresa: FORANI }),
  })
  const txt = await nombre.json().catch(() => null)
  check('pero las páginas públicas siguen resolviendo el nombre', txt === 'TALLER FORANI', String(txt))
}

// ── 5. Invitar requiere ser admin de esa empresa ─────────────────
console.log('\n5. INVITAR')
{
  const ajena = await fn('invitar', {
    empresa_id: FORANI, nombre: 'Intruso', email: 'intruso@prueba.sau',
    rol: 'admin', permisos: ['empresa.admin'],
  }, intruso)
  check('no puede invitar gente a una empresa ajena', ajena.body?.ok !== true,
        ajena.body?.error)

  const propia = await fn('invitar', {
    empresa_id: EMPRESA_A, nombre: 'Invitado Prueba', email: EMAIL_INVITADO,
    rol: 'empleado', permisos: ['taller.ver', 'taller.trabajar'],
  }, adminA)
  check('el admin de la empresa sí puede', propia.body?.ok === true, propia.body?.error)

  var token = propia.body?.token
}

// ── 6. Tokens usados y vencidos ──────────────────────────────────
console.log('\n6. TOKENS')
{
  const inventado = await fn('aceptar-invitacion', { token: 'noexiste', password: 'loquesea123' })
  check('un token inventado no sirve', inventado.body?.ok !== true, inventado.body?.error)

  const corta = await fn('aceptar-invitacion', { token, password: '123' })
  check('rechaza contraseñas cortas', corta.body?.ok !== true, corta.body?.error)

  const primera = await fn('aceptar-invitacion', { token, password: CLAVE_INVITADO })
  check('el token funciona una vez', primera.body?.ok === true, primera.body?.error)

  const segunda = await fn('aceptar-invitacion', { token, password: CLAVE_INVITADO })
  check('y no funciona la segunda', segunda.body?.ok !== true, segunda.body?.error)
  check('el motivo es que ya fue usada', /ya fue usada/i.test(segunda.body?.error || ''),
        segunda.body?.error)

  // Vencida: se fuerza el vencimiento de una invitación nueva
  const otra = await fn('invitar', {
    empresa_id: EMPRESA_A, nombre: 'Vencido', email: `vencido-${Date.now()}@prueba.sau`,
    rol: 'empleado', permisos: ['taller.ver'],
  }, adminA)
  await rest(adminA, `invitacion?token=eq.${otra.body.token}`, {
    method: 'PATCH', body: JSON.stringify({ expira_en: '2020-01-01T00:00:00Z' }),
  })
  const vencida = await fn('aceptar-invitacion', { token: otra.body.token, password: CLAVE_INVITADO })
  check('una invitación vencida no entra', vencida.body?.ok !== true, vencida.body?.error)
  check('y el motivo es el vencimiento', /venció/i.test(vencida.body?.error || ''), vencida.body?.error)
}

// ── 7. Los permisos los fija quien invita ────────────────────────
console.log('\n7. LOS PERMISOS LOS DECIDE QUIEN INVITA')
{
  const invitado = await login(EMAIL_INVITADO, CLAVE_INVITADO).catch(() => null)
  check('el invitado puede entrar con la contraseña que eligió', Boolean(invitado))

  if (invitado) {
    const mem = await rest(invitado, `membresia?usuario_id=eq.${invitado.uid}&select=empresa_id,rol,permisos`)
    const m = mem.body?.[0]
    check('quedó en la empresa correcta', m?.empresa_id === EMPRESA_A, m?.empresa_id)
    check('con el rol que le pusieron', m?.rol === 'empleado', m?.rol)
    check('y sin empresa.admin', !m?.permisos?.includes('empresa.admin'), JSON.stringify(m?.permisos))
  }
}

// ── Limpieza ─────────────────────────────────────────────────────
// Se borran las invitaciones y la membresía que creó esta corrida. El usuario
// de auth queda, pero sin acceso a ninguna empresa.
await rest(adminA, `invitacion?empresa_id=eq.${EMPRESA_A}`, { method: 'DELETE' })
const invitadoFinal = await login(EMAIL_INVITADO, CLAVE_INVITADO).catch(() => null)
if (invitadoFinal) {
  await rest(adminA, `membresia?empresa_id=eq.${EMPRESA_A}&usuario_id=eq.${invitadoFinal.uid}`,
             { method: 'DELETE' })
}
const quedan = await rest(adminA, `membresia?empresa_id=eq.${EMPRESA_A}&select=id`)
const invs   = await rest(adminA, `invitacion?empresa_id=eq.${EMPRESA_A}&select=id`)
check('la empresa de prueba queda con su equipo original', quedan.body?.length === 7,
      `quedaron ${quedan.body?.length}`)
check('y sin invitaciones sueltas', invs.body?.length === 0, `quedaron ${invs.body?.length}`)

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
