/**
 * Administración global de SAU (migración 0037).
 *
 * NO CORRE HASTA QUE 0037 ESTÉ APLICADA. Las secciones 1 y 2 se pueden correr
 * antes para ver el estado actual: hoy FALLAN, y eso es exactamente el problema
 * que 0037 arregla.
 *
 * Necesita la contraseña de la cuenta de Facundo para probar que conserva el
 * acceso global. Se pasa por entorno y no se escribe en ningún lado:
 *
 *   SAU_ADMIN_EMAIL=... SAU_ADMIN_PASS=... node scripts/pruebas-admin-global.mjs
 *
 * Sin esas dos variables, la sección 3 se saltea y el resto corre igual.
 */
import fs from 'node:fs'

const PROYECTOS_AUTORIZADOS = ['cezrotffjvqmymtdjhdw']
const BR = String.fromCharCode(10)
const EMPRESA_A = '11111111-aaaa-4aaa-8aaa-111111111111'
const EMPRESA_B = '22222222-bbbb-4bbb-8bbb-222222222222'

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
const PASS = process.env.SUPA_PASS || 'PruebaTaller2026'

const local = /localhost|127\.0\.0\.1|\[::1\]/.test(SUPA || '')
const ref   = (String(SUPA).match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1]
if (!SUPA || (!local && !PROYECTOS_AUTORIZADOS.includes(ref))) {
  console.error(`Destino no autorizado: ${SUPA}`)
  process.exit(1)
}
console.log(local ? 'Base local' : `Proyecto autorizado: ${ref}`)

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

async function login(email, pass = PASS) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No se pudo autenticar ${email}: ${j.error_code || ''}`)
  return { token: j.access_token, uid: j.user.id, email }
}
const h = (u) => ({ apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' })
async function rest(u, path, opts = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { ...h(u), ...opts.headers } })
  const t = await r.text()
  let body = null
  try { body = t ? JSON.parse(t) : null } catch { body = t }
  return { status: r.status, ok: r.ok, body }
}
const rpc = (u, fn, args) => rest(u, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

// ──────────────────────────────────────────────────────────────────
const completoA = await login('taller-a-completo@prueba.sau')   // Completo de la empresa A
const adminB    = await login('taller-b-admin@prueba.sau')      // administra la empresa B
const operario  = await login('taller-a-operario@prueba.sau')

// ── 1. Nadie se asciende a administrador global ───────────────────
console.log('\n1. NADIE SE DA EL ATRIBUTO A SÍ MISMO')
{
  for (const [quien, u] of [['operario', operario], ['completo de empresa', completoA]]) {
    const r = await rest(u, `profile?id=eq.${u.uid}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ es_sau_admin: true }),
    })
    const { body: p } = await rest(u, `profile?id=eq.${u.uid}&select=es_sau_admin`)
    check(`${quien} no logra ponerse es_sau_admin`, p?.[0]?.es_sau_admin !== true,
          `status ${r.status} / quedó ${p?.[0]?.es_sau_admin}`)
  }

  // Tampoco a otro: profile_update_self ya lo limita a la fila propia, pero se
  // comprueba igual porque es la vía obvia.
  const r = await rest(completoA, `profile?id=eq.${operario.uid}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ es_sau_admin: true }),
  })
  const { body: p } = await rest(operario, `profile?id=eq.${operario.uid}&select=es_sau_admin`)
  check('ni se lo da a otra persona', p?.[0]?.es_sau_admin !== true, `status ${r.status}`)
}

// ── 2. Ser admin de una empresa no abre las demás ─────────────────
console.log('\n2. ADMINISTRAR UNA EMPRESA NO ES ADMINISTRAR SAU')
{
  const { body: emp } = await rest(adminB, 'empresa?select=id,nombre_fantasia')
  check('el admin de la empresa B solo ve su empresa', emp?.length === 1,
        JSON.stringify(emp?.map(e => e.nombre_fantasia)))

  const { body: v } = await rest(adminB, `vehiculo?empresa_id=eq.${EMPRESA_A}&select=id`)
  check('no ve los vehículos de la empresa A', v?.length === 0)

  const { body: m } = await rest(adminB, `membresia?empresa_id=eq.${EMPRESA_A}&select=id`)
  check('no ve el equipo de la empresa A', m?.length === 0)

  const esAdmin = await rpc(adminB, 'es_admin_sau', {})
  check('y es_admin_sau() le da falso', esAdmin.body === false, JSON.stringify(esAdmin.body))

  // El perfil Completo de Forani es lo mismo: dueño de SU empresa y nada más.
  const esAdmin2 = await rpc(completoA, 'es_admin_sau', {})
  check('el perfil Completo tampoco es admin de SAU', esAdmin2.body === false)
  const { body: emp2 } = await rest(completoA, 'empresa?select=id')
  check('y solo ve su propia empresa', emp2?.length === 1, String(emp2?.length))
}

// ── 3. La cuenta de SAU conserva el acceso global ─────────────────
console.log('\n3. LA CUENTA DE SAU MANTIENE EL ACCESO')
if (!process.env.SAU_ADMIN_EMAIL || !process.env.SAU_ADMIN_PASS) {
  console.log('  (salteada: faltan SAU_ADMIN_EMAIL y SAU_ADMIN_PASS)')
} else {
  const sau = await login(process.env.SAU_ADMIN_EMAIL, process.env.SAU_ADMIN_PASS)

  const esAdmin = await rpc(sau, 'es_admin_sau', {})
  check('es_admin_sau() le da verdadero', esAdmin.body === true, JSON.stringify(esAdmin.body))

  const { body: emp } = await rest(sau, 'empresa?select=id')
  check('ve todas las empresas', (emp?.length || 0) >= 8, String(emp?.length))

  const { body: v } = await rest(sau, `vehiculo?empresa_id=eq.${EMPRESA_A}&select=id&limit=1`)
  check('entra a los vehículos de un cliente, para dar soporte', (v?.length || 0) === 1)

  const { body: mo } = await rest(sau, 'vehiculo_monto?select=vehiculo_id&limit=1')
  check('y a sus montos', (mo?.length || 0) === 1)

  // Soporte atribuido: lo que haga queda a su nombre en la bitácora de siempre.
  const { body: act } = await rest(sau,
    `vehiculo?empresa_id=eq.${EMPRESA_A}&etapa=neq.entregado&select=id&limit=1`)
  if (act?.length) {
    const marca = 'Soporte SAU — prueba ' + Date.now()
    const n = await rest(sau, 'vehiculo_evento', {
      method: 'POST', body: JSON.stringify({ vehiculo_id: act[0].id, tipo: 'nota', texto: marca }),
    })
    check('puede anotar en la bitácora de un cliente', n.ok, `status ${n.status}`)

    const { body: ev } = await rest(sau,
      `vehiculo_evento?vehiculo_id=eq.${act[0].id}&select=autor_id,texto&order=created_at.desc&limit=1`)
    check('y la acción queda atribuida a su usuario, no anónima',
          ev?.[0]?.autor_id === sau.uid && ev?.[0]?.texto === marca,
          `autor=${ev?.[0]?.autor_id}`)
  }
}

// ── 4. El taller sigue funcionando igual ──────────────────────────
console.log('\n4. LOS PERMISOS DEL TALLER NO SE MOVIERON')
{
  const { body: vs } = await rest(completoA, 'vehiculo?etapa=neq.entregado&select=id&limit=1')
  const VEH = vs?.[0]?.id

  const m1 = await rest(completoA, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=monto_compania`)
  check('completo sigue viendo los importes', (m1.body?.length || 0) === 1)

  const m2 = await rest(operario, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=monto_compania`)
  check('el operario sigue sin verlos', (m2.body?.length || 0) === 0)

  const f = await rpc(operario, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado' })
  check('y sigue sin poder facturar', !f.ok)

  const e = await rpc(operario, 'taller_cambiar_excepcion', { p_vehiculo: VEH, p_excepcion: 'mecanica' })
  check('ni frenar un vehículo', !e.ok)

  const d = await rest(operario, `vehiculo?id=eq.${VEH}`, { method: 'DELETE' })
  const { body: sigue } = await rest(completoA, `vehiculo?id=eq.${VEH}&select=id`)
  check('ni borrarlo', sigue?.length === 1, `status ${d.status}`)
}

// ── 5. El rol de la membresía ya no abre otras empresas ───────────
// Es el corazón del cambio: aunque alguien quede con rol 'admin' en una
// empresa, eso no puede volver a significar acceso global.
console.log('\n5. EL ROL DE UNA MEMBRESÍA NO VIAJA ENTRE EMPRESAS')
{
  const { body: roles } = await rest(adminB, `membresia?select=rol,empresa_id`)
  check('el admin de B ve solo su propia membresía', (roles?.length || 0) >= 1
        && roles.every(r => r.empresa_id === EMPRESA_B), JSON.stringify(roles))

  const ajeno = await rest(adminB, `vehiculo_monto?select=monto_compania&limit=1`)
  check('y ningún monto de otra empresa', (ajeno.body?.length || 0) === 0)
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
