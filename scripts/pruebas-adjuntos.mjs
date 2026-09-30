/**
 * Adjuntos de un vehículo entregado (migración 0034).
 *
 * Comprueba tres cosas: que sumar papeles después de la entrega no reactive el
 * vehículo, que quede registrado quién y cuándo, y que un operario no llegue a
 * los que muestran plata — ni por la tabla ni por el bucket.
 *
 * Mismo criterio de destino que las otras suites.
 *
 *   node scripts/pruebas-adjuntos.mjs
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

async function subir(u, path, contenido, tipoMime) {
  const r = await fetch(`${SUPA}/storage/v1/object/taller/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': tipoMime },
    body: contenido,
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
const U = local
  ? { duena: 'duena@local.test', operario: 'chapista@local.test' }
  : { duena: 'taller-a-completo@prueba.sau', operario: 'taller-a-operario@prueba.sau' }

const duena    = await login(U.duena)
const operario = await login(U.operario)

const { body: ent } = await rest(duena,
  'vehiculo?etapa=eq.entregado&select=id,patente,empresa_id,etapa,fecha_entrega&limit=1')
if (!ent?.length) { console.error('No hay ningún vehículo entregado para probar.'); process.exit(1) }
const V = ent[0]
console.log(`\nVehículo entregado: ${V.patente}\n`)

const marca = Date.now()
const rutaRecibo = `${V.empresa_id}/${V.id}/recibo-${marca}-prueba.pdf`
const rutaFoto   = `${V.empresa_id}/${V.id}/foto_entrega-${marca}-prueba.png`

// ── 1. Lo que ya existía sigue visible ────────────────────────────
console.log('1. NO SE ROMPIÓ LO ANTERIOR')
{
  const d = await rest(duena, `vehiculo_archivo?vehiculo_id=eq.${V.id}&select=id,tipo`)
  check('la dueña sigue viendo los adjuntos de siempre', Array.isArray(d.body), JSON.stringify(d.body))

  const { body: fotos } = await rest(operario, `vehiculo_archivo?tipo=like.foto*&select=id,tipo&limit=5`)
  check('el operario sigue viendo fotos', Array.isArray(fotos), JSON.stringify(fotos))
}

// ── 2. Sumar papeles después de entregar ──────────────────────────
console.log('\n2. DOCUMENTOS POSTERIORES A LA ENTREGA')
{
  const s = await subir(duena, rutaRecibo, '%PDF-1.4', 'application/pdf')
  check('se sube el recibo al bucket', s.ok, `status ${s.status}`)

  const i = await rest(duena, 'vehiculo_archivo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ vehiculo_id: V.id, tipo: 'recibo', path: rutaRecibo, nombre: 'recibo.pdf' }),
  })
  check('queda registrado en la ficha', i.ok, JSON.stringify(i.body))
  check('con autor', !!i.body?.[0]?.autor_id, JSON.stringify(i.body?.[0]?.autor_id))
  check('y con fecha', !!i.body?.[0]?.created_at)

  const f = await subir(duena, rutaFoto, 'x', 'image/png')
  check('también una foto de entrega', f.ok, `status ${f.status}`)

  const fi = await rest(duena, 'vehiculo_archivo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ vehiculo_id: V.id, tipo: 'foto_entrega', path: rutaFoto, nombre: 'entrega.png' }),
  })
  check('y la foto también queda en la ficha', fi.ok, JSON.stringify(fi.body))
}

// ── 3. No reactiva el vehículo ────────────────────────────────────
console.log('\n3. NO REACTIVA EL VEHÍCULO')
{
  const { body: v2 } = await rest(duena, `vehiculo?id=eq.${V.id}&select=etapa,fecha_entrega`)
  check('sigue entregado', v2[0].etapa === 'entregado', v2[0].etapa)
  check('con la misma fecha de entrega', v2[0].fecha_entrega === V.fecha_entrega)

  const { body: act } = await rest(duena,
    `vehiculo?etapa=neq.entregado&select=id&id=eq.${V.id}`)
  check('no vuelve a la pizarra', Array.isArray(act) && act.length === 0)

  const { totalesAFacturar } = await import('../src/lib/taller.js')
  const { body: m } = await rest(duena, `vehiculo_monto?vehiculo_id=eq.${V.id}&select=*`)
  const unido = { ...v2[0], ...(m?.[0] || {}) }
  const t = totalesAFacturar([unido])
  check('sus importes siguen fuera de los totales',
        t.compania === 0 && t.franquicia === 0 && t.particular === 0, JSON.stringify(t))
}

// ── 4. El operario no llega a la plata ────────────────────────────
console.log('\n4. EL OPERARIO NO VE DOCUMENTOS CON IMPORTES')
{
  const r = await rest(operario, `vehiculo_archivo?vehiculo_id=eq.${V.id}&select=id,tipo`)
  const tipos = (r.body || []).map(x => x.tipo)
  check('no le aparece el recibo en la ficha', !tipos.includes('recibo'), JSON.stringify(tipos))
  check('pero sí la foto de entrega', tipos.includes('foto_entrega'), JSON.stringify(tipos))

  const s = await firmar(operario, rutaRecibo)
  check('no puede pedir la URL firmada del recibo', !s.ok, `status ${s.status}`)

  const sf = await firmar(operario, rutaFoto)
  check('pero sí la de la foto', sf.ok, `status ${sf.status}`)

  const sub = await subir(operario, `${V.empresa_id}/${V.id}/factura-${marca}-intruso.pdf`, 'x', 'application/pdf')
  check('no puede subir una factura', !sub.ok, `status ${sub.status}`)

  const ins = await rest(operario, 'vehiculo_archivo', {
    method: 'POST', body: JSON.stringify({ vehiculo_id: V.id, tipo: 'factura', path: 'x/y/factura-1.pdf' }),
  })
  check('ni registrarla en la ficha', !ins.ok, `status ${ins.status}`)
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
