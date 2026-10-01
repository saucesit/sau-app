/**
 * Los tres perfiles del taller (migración 0035), con usuarios ficticios.
 *
 * Comprueba lo que cada uno PUEDE y lo que NO, siempre contra el servidor:
 * que "ve todo" no sea "hace todo", que eliminar quede solo en Completo, que
 * los papeles con importes no lleguen al operario ni por la tabla ni por el
 * bucket, y que ninguno se saltee las etapas habilitadas.
 *
 * Mismo criterio de destino que las otras suites.
 *
 *   node scripts/pruebas-perfiles.mjs
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

async function login(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No se pudo autenticar ${email}: ${JSON.stringify(j)}`)
  return { token: j.access_token, email }
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
async function subir(u, path, cont, mime) {
  const r = await fetch(`${SUPA}/storage/v1/object/taller/${path}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': mime },
    body: cont,
  })
  return { status: r.status, ok: r.ok }
}
async function firmar(u, path) {
  const r = await fetch(`${SUPA}/storage/v1/object/sign/taller/${path}`, {
    method: 'POST', headers: h(u), body: JSON.stringify({ expiresIn: 60 }),
  })
  return { status: r.status, ok: r.ok }
}

// ──────────────────────────────────────────────────────────────────
const completo = await login('taller-a-completo@prueba.sau')
const admin    = await login('taller-a-administrador@prueba.sau')
const operario = await login('taller-a-operario@prueba.sau')

// Vehículo propio de esta suite.
let { body: vs } = await rest(completo, 'vehiculo?patente=eq.ZZPERF01&select=id,empresa_id,etapa')
if (!vs?.length) {
  const alta = await rest(completo, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA_A, patente: 'ZZPERF01', vehiculo: 'AUTO DE PRUEBA PERFILES',
      cliente_nombre: 'CLIENTE PERFILES', compania: 'Zurich',
      fecha_ingreso: new Date().toISOString().slice(0, 10),
      fecha_pactada: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      panos: 2, dias_chapa: 3,
    }),
  })
  if (!alta.ok) { console.error('No se pudo crear ZZPERF01:', JSON.stringify(alta.body)); process.exit(1) }
  vs = alta.body
}
const V = vs[0]
console.log(`\nVehículo de prueba: ZZPERF01 (${V.etapa})\n`)

// ── 1. Ver la plata ───────────────────────────────────────────────
console.log('1. QUIÉN VE LA PLATA')
{
  for (const [quien, u, debeVer] of [['completo', completo, true], ['administrador', admin, true], ['operario', operario, false]]) {
    const m = await rest(u, `vehiculo_monto?vehiculo_id=eq.${V.id}&select=monto_compania`)
    const ve = Array.isArray(m.body) && m.body.length > 0
    check(`${quien} ${debeVer ? 've' : 'NO ve'} los importes`, ve === debeVer, JSON.stringify(m.body))
  }
}

// ── 2. Eliminar ───────────────────────────────────────────────────
console.log('\n2. ELIMINAR, SOLO COMPLETO')
{
  const descartable = await rest(completo, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA_A, patente: 'ZZBORRA1', vehiculo: 'PARA BORRAR',
      cliente_nombre: 'X', compania: 'Particular',
      fecha_ingreso: new Date().toISOString().slice(0, 10),
    }),
  })
  const ID = descartable.body?.[0]?.id
  check('se crea un vehículo descartable', !!ID, JSON.stringify(descartable.body))

  for (const [quien, u] of [['operario', operario], ['administrador', admin]]) {
    await rest(u, `vehiculo?id=eq.${ID}`, { method: 'DELETE' })
    const { body: sigue } = await rest(completo, `vehiculo?id=eq.${ID}&select=id`)
    check(`${quien} no lo borra`, sigue?.length === 1)
  }

  await rest(completo, `vehiculo?id=eq.${ID}`, { method: 'DELETE' })
  const { body: ya } = await rest(completo, `vehiculo?id=eq.${ID}&select=id`)
  check('completo sí lo borra', ya?.length === 0)
}

// ── 3. Nadie borra bitácora ni adjuntos ───────────────────────────
console.log('\n3. BITÁCORA Y ADJUNTOS NO SE BORRAN')
{
  const { body: ev } = await rest(completo, `vehiculo_evento?vehiculo_id=eq.${V.id}&select=id&limit=1`)
  if (ev?.length) {
    await rest(completo, `vehiculo_evento?id=eq.${ev[0].id}`, { method: 'DELETE' })
    const { body: sigue } = await rest(completo, `vehiculo_evento?id=eq.${ev[0].id}&select=id`)
    check('ni completo borra un movimiento de la bitácora', sigue?.length === 1)
  }
  const { body: ar } = await rest(completo, 'vehiculo_archivo?select=id&limit=1')
  if (ar?.length) {
    await rest(completo, `vehiculo_archivo?id=eq.${ar[0].id}`, { method: 'DELETE' })
    const { body: sigue } = await rest(completo, `vehiculo_archivo?id=eq.${ar[0].id}&select=id`)
    check('ni un adjunto', sigue?.length === 1)
  }
}

// ── 4. Frenar el auto ─────────────────────────────────────────────
console.log('\n4. MECÁNICA / DETENIDO / AMPLIACIÓN')
{
  const o = await rpc(operario, 'taller_cambiar_excepcion', { p_vehiculo: V.id, p_excepcion: 'mecanica' })
  check('el operario no frena el vehículo', !o.ok, JSON.stringify(o.body))

  const a = await rpc(admin, 'taller_cambiar_excepcion', { p_vehiculo: V.id, p_excepcion: 'mecanica' })
  check('el administrador sí', a.ok, JSON.stringify(a.body))
  await rpc(admin, 'taller_cambiar_excepcion', { p_vehiculo: V.id, p_excepcion: null })

  // Pero el operario sí puede dejar constancia.
  const n = await rest(operario, 'vehiculo_evento', {
    method: 'POST', body: JSON.stringify({ vehiculo_id: V.id, tipo: 'nota', texto: 'Falta un repuesto.' }),
  })
  check('pero sí anota en el reporte diario', n.ok, `status ${n.status}`)
}

// ── 5. Editar datos, con rastro ───────────────────────────────────
console.log('\n5. EDITAR DATOS DEL VEHÍCULO')
{
  const o = await rest(operario, `vehiculo?id=eq.${V.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ telefono: '000' }),
  })
  check('el operario no edita datos',
        !o.ok || (Array.isArray(o.body) && o.body.length === 0), `status ${o.status}`)

  const nuevo = '387 777-' + String(Date.now()).slice(-4)
  const a = await rest(admin, `vehiculo?id=eq.${V.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ telefono: nuevo, panos: 9 }),
  })
  check('el administrador sí', a.ok && a.body?.length === 1, `status ${a.status}`)

  const { body: ev } = await rest(admin,
    `vehiculo_evento?vehiculo_id=eq.${V.id}&tipo=eq.edicion&select=texto&order=created_at.desc&limit=1`)
  check('y el cambio queda en la bitácora', /teléfono/i.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)
  check('con el valor anterior y el nuevo', (ev?.[0]?.texto || '').includes(nuevo), ev?.[0]?.texto)
  check('y también el cambio de paños', /paños/i.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)
}

// ── 6. Documentos con importes ────────────────────────────────────
console.log('\n6. DOCUMENTOS CON IMPORTES')
{
  const marca = Date.now()
  const ruta = `${V.empresa_id}/${V.id}/orden_compania-${marca}-p.pdf`
  const s = await subir(completo, ruta, '%PDF-1.4', 'application/pdf')
  check('completo sube la orden de la compañía', s.ok, `status ${s.status}`)
  await rest(completo, 'vehiculo_archivo', {
    method: 'POST',
    body: JSON.stringify({ vehiculo_id: V.id, tipo: 'orden_compania', path: ruta, nombre: 'orden.pdf' }),
  })

  const vistaOperario = await rest(operario, `vehiculo_archivo?vehiculo_id=eq.${V.id}&select=tipo`)
  check('el operario no ve la orden de la compañía',
        !(vistaOperario.body || []).some(x => x.tipo === 'orden_compania'),
        JSON.stringify(vistaOperario.body))

  const f = await firmar(operario, ruta)
  check('ni consigue su enlace', !f.ok, `status ${f.status}`)

  const vistaAdmin = await rest(admin, `vehiculo_archivo?vehiculo_id=eq.${V.id}&select=tipo`)
  check('el administrador sí la ve',
        (vistaAdmin.body || []).some(x => x.tipo === 'orden_compania'))
  const fa = await firmar(admin, ruta)
  check('y consigue su enlace', fa.ok, `status ${fa.status}`)

  const d = await subir(operario, `${V.empresa_id}/${V.id}/orden_firmada-${marca}-i.pdf`, 'x', 'application/pdf')
  check('el operario no sube documentos con importes', !d.ok, `status ${d.status}`)
}

// ── 7. Las etapas siguen mandando ─────────────────────────────────
console.log('\n7. NI SIQUIERA EL ADMINISTRADOR SE SALTEA LAS ETAPAS')
{
  const { body: v } = await rest(admin, `vehiculo?id=eq.${V.id}&select=etapa`)
  // El administrador de prueba tiene habilitadas chapa y pintura, no recepción
  // ni preparación: marcar en una etapa que no es suya tiene que fallar.
  const r = await rpc(admin, 'taller_marcar_trabajo_hecho', { p_vehiculo: V.id })
  const esSuya = ['chapa', 'pintura'].includes(v[0].etapa)
  check(`en ${v[0].etapa} ${esSuya ? 'puede' : 'NO puede'} marcar trabajo`,
        r.ok === esSuya, JSON.stringify(r.body))
}

// ── 8. Ninguno sale de su empresa ─────────────────────────────────
console.log('\n8. NINGUNO SALE DE SU EMPRESA')
{
  const { body: otras } = await rest(completo, 'empresa?select=id,nombre_fantasia')
  check('completo solo ve su empresa', otras?.length === 1, JSON.stringify(otras?.map(e => e.nombre_fantasia)))

  const { body: ajenos } = await rest(admin, `vehiculo?empresa_id=neq.${EMPRESA_A}&select=id`)
  check('el administrador no ve vehículos de otras', ajenos?.length === 0)
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
