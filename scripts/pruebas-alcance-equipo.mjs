/**
 * Hasta dónde llega un cliente administrando su equipo (0038 + edge functions).
 *
 * Todas las llamadas van directo a la API con un JWT de usuario, que es
 * exactamente el rol `authenticated`: lo que se prueba acá no lo protege
 * ninguna pantalla.
 *
 * Solo cuentas ficticias. Restaura todo al terminar.
 *
 *   node scripts/pruebas-alcance-equipo.mjs
 */
import fs from 'node:fs'

const PROYECTOS_AUTORIZADOS = ['cezrotffjvqmymtdjhdw']
const BR = String.fromCharCode(10)
const EMPRESA_A = '11111111-aaaa-4aaa-8aaa-111111111111'

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
async function fn(u, nombre, cuerpo) {
  const r = await fetch(`${SUPA}/functions/v1/${nombre}`, {
    method: 'POST', headers: h(u), body: JSON.stringify(cuerpo),
  })
  const t = await r.text()
  let b = null
  try { b = JSON.parse(t) } catch { b = t }
  return { status: r.status, ok: r.ok, body: b }
}

const completo = await login('taller-a-completo@prueba.sau')   // Completo: tiene empresa.admin
const admini   = await login('taller-a-administrador@prueba.sau')
const operario = await login('taller-a-operario@prueba.sau')

const mems = {}
for (const [alias, u] of Object.entries({ completo, admini, operario })) {
  const { body } = await rest(completo, `membresia?usuario_id=eq.${u.uid}&select=id,rol,permisos,activa,taller_etapas`)
  mems[alias] = body[0]
}
console.log(`\nCompleto administra la empresa A. Administrador y Operario, no.\n`)

async function restaurar() {
  for (const [quien, m] of Object.entries(mems)) {
    await rest(completo, `membresia?id=eq.${m.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ rol: m.rol, permisos: m.permisos, activa: m.activa, taller_etapas: m.taller_etapas }),
    })
  }
}

try {
  // ── 1. Completo no otorga los permisos reservados ───────────────
  console.log('1. COMPLETO NO OTORGA LO RESERVADO')
  for (const permiso of ['empresa.admin', 'empresa.rrhh', 'taller.eliminar']) {
    const r = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ permisos: [...mems.operario.permisos, permiso] }),
    })
    const { body: p } = await rest(completo, `membresia?id=eq.${mems.operario.id}&select=permisos`)
    check(`no le da ${permiso} a otro`, !p?.[0]?.permisos?.includes(permiso), `status ${r.status}`)
  }
  {
    const r = await rest(completo, `membresia?id=eq.${mems.admini.id}`, {
      method: 'PATCH', body: JSON.stringify({ permisos: ['taller.ver', 'inventado.permiso'] }),
    })
    check('rechaza un permiso que no existe en la lista', !r.ok, `status ${r.status}`)
  }

  // ── 2. Ni toca una membresía Completo ───────────────────────────
  console.log('\n2. LA MEMBRESÍA COMPLETO LA ADMINISTRA SAU')
  {
    const quitar = await rest(completo, `membresia?id=eq.${mems.completo.id}`, {
      method: 'PATCH', body: JSON.stringify({ permisos: ['taller.ver'] }),
    })
    check('no se quita a sí mismo el perfil Completo', !quitar.ok, `status ${quitar.status}`)

    const baja = await rest(completo, `membresia?id=eq.${mems.completo.id}`, {
      method: 'PATCH', body: JSON.stringify({ activa: false }),
    })
    check('no desactiva una membresía Completo', !baja.ok, `status ${baja.status}`)

    const borrar = await rest(completo, `membresia?id=eq.${mems.completo.id}`, { method: 'DELETE' })
    const { body: sigue } = await rest(completo, `membresia?id=eq.${mems.completo.id}&select=id`)
    check('ni la borra', sigue?.length === 1, `status ${borrar.status}`)
  }

  // ── 3. Ni se cambia el rol, ni muda la membresía ─────────────────
  console.log('\n3. NI ROL DE SAU, NI MUDANZAS')
  {
    const r = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', body: JSON.stringify({ rol: 'admin' }),
    })
    check('no pone a nadie en rol admin', !r.ok, `status ${r.status}`)

    const m = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', body: JSON.stringify({ empresa_id: '22222222-bbbb-4bbb-8bbb-222222222222' }),
    })
    check('no muda una membresía a otra empresa', !m.ok, `status ${m.status}`)

    const d = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', body: JSON.stringify({ usuario_id: completo.uid }),
    })
    check('no se apropia de la membresía de otro', !d.ok, `status ${d.status}`)
  }

  // ── 4. Lo legítimo sigue funcionando ────────────────────────────
  console.log('\n4. LO QUE SÍ PUEDE HACER COMPLETO')
  {
    const r = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        permisos: ['taller.ver', 'taller.trabajar', 'taller.cargar', 'taller.validar', 'taller.montos', 'reportes.ver'],
      }),
    })
    check('asigna el perfil Administrador', r.ok, `status ${r.status}`)

    const e = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ taller_etapas: ['chapa', 'pintura'] }),
    })
    check('habilita etapas', e.ok, `status ${e.status}`)

    const mal = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', body: JSON.stringify({ taller_etapas: ['chapa', 'inventada'] }),
    })
    check('pero no una etapa inventada', !mal.ok, `status ${mal.status}`)

    const baja = await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ activa: false }),
    })
    check('da de baja a alguien de su equipo', baja.ok, `status ${baja.status}`)
    await rest(completo, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', body: JSON.stringify({ activa: true }),
    })
  }

  // ── 5. Administrador y Operario no gestionan permisos ───────────
  console.log('\n5. ADMINISTRADOR Y OPERARIO NO GESTIONAN PERMISOS')
  for (const u of [admini, operario]) {
    const r = await rest(u, `membresia?id=eq.${mems.operario.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ permisos: ['taller.ver', 'taller.montos'] }),
    })
    check(`${u.email}: no modifica membresías`,
          !r.ok || (Array.isArray(r.body) && r.body.length === 0), `status ${r.status}`)
  }

  // ── 6. Las edge functions rechazan, no recortan ─────────────────
  console.log('\n6. LAS FUNCIONES RECHAZAN CON MOTIVO')
  {
    const r = await fn(completo, 'invitar', {
      empresa_id: EMPRESA_A, nombre: 'Intento', email: `alcance-${Date.now()}@prueba.sau`,
      rol: 'empleado', permisos: ['taller.ver', 'empresa.admin'], taller_etapas: [],
    })
    const msg = JSON.stringify(r.body)
    check('invitar rechaza un permiso reservado', !r.body?.ok, msg)
    check('y lo dice con claridad', /SAU/.test(msg), msg)

    const r2 = await fn(completo, 'invitar', {
      empresa_id: EMPRESA_A, nombre: 'Intento', email: `alcance2-${Date.now()}@prueba.sau`,
      rol: 'admin', permisos: ['taller.ver'], taller_etapas: [],
    })
    check('invitar rechaza el rol admin', !r2.body?.ok, JSON.stringify(r2.body))

    const r3 = await fn(completo, 'crear-empleado', {
      nombre: 'Intento', email: `alcance3-${Date.now()}@prueba.sau`, password: 'xxxxxxxx',
      empresa_id: EMPRESA_A, permisos: ['taller.ver', 'taller.eliminar'], rol: 'empleado',
    })
    check('crear-empleado rechaza taller.eliminar', !r3.body?.ok, JSON.stringify(r3.body))

    const r4 = await fn(operario, 'invitar', {
      empresa_id: EMPRESA_A, nombre: 'X', email: `x-${Date.now()}@prueba.sau`,
      rol: 'empleado', permisos: ['taller.ver'], taller_etapas: [],
    })
    check('el operario no puede invitar', !r4.body?.ok, JSON.stringify(r4.body))

    const r5 = await fn(completo, 'invitar', {
      empresa_id: '22222222-bbbb-4bbb-8bbb-222222222222', nombre: 'X',
      email: `y-${Date.now()}@prueba.sau`, rol: 'empleado', permisos: ['taller.ver'], taller_etapas: [],
    })
    check('ni invitar a una empresa que no administra', !r5.body?.ok, JSON.stringify(r5.body))
  }

  // ── 7. Una invitación legítima sigue andando ────────────────────
  console.log('\n7. UNA INVITACIÓN LEGÍTIMA SIGUE ANDANDO')
  {
    const correo = `legitima-${Date.now()}@prueba.sau`
    const r = await fn(completo, 'invitar', {
      empresa_id: EMPRESA_A, nombre: 'Operario Nuevo', email: correo,
      rol: 'empleado', permisos: ['taller.ver', 'taller.trabajar'], taller_etapas: ['chapa'],
    })
    check('se genera la invitación', r.body?.ok === true, JSON.stringify(r.body))
    if (r.body?.token) {
      await rest(completo, `invitacion?token=eq.${r.body.token}`, { method: 'DELETE' })
    }
  }
} finally {
  await restaurar()
  const { body: fin } = await rest(completo, `membresia?empresa_id=eq.${EMPRESA_A}&select=id,permisos,rol,activa`)
  const iguales = Object.values(mems).every(m => {
    const act = fin.find(x => x.id === m.id)
    return act && act.rol === m.rol && act.activa === m.activa &&
           JSON.stringify([...act.permisos].sort()) === JSON.stringify([...m.permisos].sort())
  })
  console.log(`\nCuentas restauradas: ${iguales ? 'sí' : 'NO — REVISAR'}`)
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
