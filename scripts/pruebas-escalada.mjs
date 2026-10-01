/**
 * Cierre de la escalada de privilegios (migración 0037a).
 *
 * Solo cuentas ficticias. NO usa la cuenta de Facundo: que su sesión conserve
 * el acceso global lo comprueba él, y queda anotado como pendiente.
 *
 *   node scripts/pruebas-escalada.mjs
 */
import fs from 'node:fs'

const PROYECTOS_AUTORIZADOS = ['cezrotffjvqmymtdjhdw']
const BR = String.fromCharCode(10)

function leerEnv(a) {
  try {
    return Object.fromEntries(
      fs.readFileSync(new URL(a, import.meta.url), 'utf8').split(BR)
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
  } catch { return {} }
}

const env  = { ...leerEnv('../.env.local'), ...leerEnv('../.env.desarrollo') }
const SUPA = process.env.SUPA_URL  || env.VITE_SUPABASE_URL
const ANON = process.env.SUPA_ANON || env.VITE_SUPABASE_ANON_KEY
const PASS = 'PruebaTaller2026'

const local = /localhost|127\.0\.0\.1|\[::1\]/.test(SUPA || '')
const ref   = (String(SUPA).match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1]
if (!SUPA || (!local && !PROYECTOS_AUTORIZADOS.includes(ref))) {
  console.error(`Destino no autorizado: ${SUPA}`); process.exit(1)
}
console.log(local ? 'Base local' : `Proyecto autorizado: ${ref}`)

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

async function login(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No se pudo autenticar ${email}`)
  return { token: j.access_token, uid: j.user.id, email: email.split('@')[0] }
}
const h = (u) => ({ apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' })
async function rest(u, path, opts = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { ...h(u), ...opts.headers } })
  const t = await r.text()
  let body = null
  try { body = t ? JSON.parse(t) : null } catch { body = t }
  return { status: r.status, ok: r.ok, body }
}

const operario = await login('taller-a-operario@prueba.sau')
const completo = await login('taller-a-completo@prueba.sau')
const adminB   = await login('taller-b-admin@prueba.sau')

// ── 1. Nadie se da administración global ──────────────────────────
console.log('\n1. NADIE SE DA ADMINISTRACIÓN GLOBAL')
for (const u of [operario, completo, adminB]) {
  for (const campo of ['es_sau_admin', 'es_sau_contadora']) {
    const r = await rest(u, `profile?id=eq.${u.uid}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ [campo]: true }),
    })
    const { body: p } = await rest(u, `profile?id=eq.${u.uid}&select=${campo}`)
    check(`${u.email}: rechaza ponerse ${campo}`,
          !r.ok && p?.[0]?.[campo] !== true, `status ${r.status} / quedó ${p?.[0]?.[campo]}`)
  }
}

// ── 2. Ni se la da a otro ─────────────────────────────────────────
console.log('\n2. NI SE LA DA A OTRA CUENTA')
{
  const r = await rest(completo, `profile?id=eq.${operario.uid}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ es_sau_admin: true }),
  })
  const { body: p } = await rest(operario, `profile?id=eq.${operario.uid}&select=es_sau_admin`)
  check('no se la otorga a otra cuenta', p?.[0]?.es_sau_admin !== true, `status ${r.status}`)

  // Y tampoco creando un perfil nuevo con el atributo puesto.
  const nuevo = await rest(completo, 'profile', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: crypto.randomUUID(), nombre: 'Intruso', es_sau_admin: true }),
  })
  check('no crea un perfil ya privilegiado', !nuevo.ok, `status ${nuevo.status}`)
}

// ── 3. Los datos normales se siguen editando ──────────────────────
console.log('\n3. LOS DATOS NORMALES DEL PERFIL SE SIGUEN EDITANDO')
{
  const tel = '387 ' + String(Date.now()).slice(-6)
  const r = await rest(operario, `profile?id=eq.${operario.uid}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ telefono: tel }),
  })
  check('puede cambiar su teléfono', r.ok, `status ${r.status}`)

  const { body: p } = await rest(operario, `profile?id=eq.${operario.uid}&select=telefono,nombre`)
  check('y quedó guardado', p?.[0]?.telefono === tel, p?.[0]?.telefono)

  const n = await rest(operario, `profile?id=eq.${operario.uid}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ nombre: p[0].nombre, apellido: 'Prueba' }),
  })
  check('y su nombre y apellido', n.ok, `status ${n.status}`)

  // Pero no el de otro: eso lo limita profile_update_self, no los permisos.
  const ajeno = await rest(operario, `profile?id=eq.${completo.uid}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ telefono: '000' }),
  })
  check('pero no el perfil de otra persona',
        !ajeno.ok || (Array.isArray(ajeno.body) && ajeno.body.length === 0), `status ${ajeno.status}`)
}

// ── 4. Nadie se asomó a otra empresa ──────────────────────────────
console.log('\n4. NADIE VE INFORMACIÓN DE OTRAS EMPRESAS')
for (const u of [operario, completo, adminB]) {
  const { body: e } = await rest(u, 'empresa?select=id')
  check(`${u.email}: ve una sola empresa`, e?.length === 1, `ve ${e?.length}`)
}
{
  const { body: m } = await rest(adminB, 'vehiculo_monto?select=monto_compania&limit=5')
  check('el admin de B no ve ningún monto del taller de A', (m?.length || 0) === 0)
}

// ── 5. Ninguna cuenta ficticia quedó elevada ──────────────────────
console.log('\n5. NINGUNA CUENTA FICTICIA QUEDÓ ELEVADA')
for (const u of [operario, completo, adminB]) {
  const { body: p } = await rest(u, `profile?id=eq.${u.uid}&select=es_sau_admin,es_sau_contadora`)
  check(`${u.email}: sigue sin privilegios`,
        p?.[0]?.es_sau_admin !== true && p?.[0]?.es_sau_contadora !== true,
        JSON.stringify(p?.[0]))
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
console.log('\nPENDIENTE (lo comprueba Facundo desde su sesión):')
console.log('  - que su cuenta conserve la administración global de SAU.')
