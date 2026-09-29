/**
 * Pruebas de la facturación por rubro (migración 0033).
 *
 * NO CORRE TODAVÍA: necesita que 0033 esté aplicada. Está escrita para el
 * entorno de pruebas separado, no para producción.
 *
 * Apunta a donde diga SUPA_URL/SUPA_ANON en el entorno; si no están, cae en
 * .env.desarrollo, que es la base local. Nunca lee .env.local a propósito, para
 * que un descuido no la dispare contra producción.
 *
 *   node scripts/pruebas-facturacion.mjs
 */
import fs from 'node:fs'

function leerEnv(archivo) {
  try {
    return Object.fromEntries(
      fs.readFileSync(new URL(archivo, import.meta.url), 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
        }))
  } catch { return {} }
}

const env  = leerEnv('../.env.desarrollo')
const SUPA = process.env.SUPA_URL  || env.VITE_SUPABASE_URL
const ANON = process.env.SUPA_ANON || env.VITE_SUPABASE_ANON_KEY
const PASS = process.env.SUPA_PASS

if (!SUPA || !ANON || !PASS) {
  console.error('Falta configuración. Necesita .env.desarrollo (o SUPA_URL y')
  console.error('SUPA_ANON) más SUPA_PASS con la clave de los usuarios locales.')
  process.exit(1)
}
if (/supabase\.co/.test(SUPA)) {
  console.error(`Esto apunta a ${SUPA}, que no es la base local. Cortado a propósito.`)
  process.exit(1)
}

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

async function login(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
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

// ──────────────────────────────────────────────────────────────────
const duena     = await login('duena@local.test')
const chapista  = await login('chapista@local.test')   // sin taller.montos
const recepcion = await login('recepcion@local.test')  // sin taller.montos

const { body: vs } = await rest(duena, 'vehiculo?etapa=neq.entregado&select=id,patente&limit=1')
if (!vs?.length) { console.error('No hay vehículos activos. ¿Corrió supabase/seed.sql?'); process.exit(1) }
const VEH = vs[0].id
console.log(`\nVehículo de prueba: ${vs[0].patente}\n`)

const monto = async (u = duena) =>
  (await rest(u, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)).body?.[0] || null

// ── 1. Estado inicial ─────────────────────────────────────────────
console.log('1. ESTADO INICIAL')
{
  const m = await monto()
  check('los tres rubros arrancan en pendiente',
        m.estado_compania === 'pendiente' && m.estado_franquicia === 'pendiente'
        && m.estado_particular === 'pendiente')
  check('y sin número de factura', !m.factura_compania)
}

// ── 2. Marcar facturado ───────────────────────────────────────────
console.log('\n2. MARCAR FACTURADO')
{
  const r = await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado', p_factura: 'A-0001-00012345' })
  check('la dueña puede marcar facturado', r.ok, JSON.stringify(r.body))

  const m = await monto()
  check('el rubro quedó facturado', m.estado_compania === 'facturado', m.estado_compania)
  check('y guardó el número', m.factura_compania === 'A-0001-00012345', m.factura_compania)

  const { body: ev } = await rest(duena,
    `vehiculo_evento?vehiculo_id=eq.${VEH}&tipo=eq.facturacion&select=texto&order=created_at.desc&limit=1`)
  check('dejó el movimiento en la bitácora',
        /A-0001-00012345/.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)
}

// ── 3. Facturar NO toca el cobro ──────────────────────────────────
console.log('\n3. FACTURAR Y COBRAR SON INDEPENDIENTES')
{
  const m = await monto()
  check('marcar facturado no marcó el cobro', m.cobro_compania === false, String(m.cobro_compania))

  await rpc(duena, 'taller_registrar_cobro',
    { p_vehiculo: VEH, p_campo: 'cobro_franquicia', p_valor: true })
  const m2 = await monto()
  check('marcar cobrado no marcó la facturación',
        m2.estado_franquicia === 'pendiente', m2.estado_franquicia)
}

// ── 4. No aplica y vuelta a pendiente ─────────────────────────────
console.log('\n4. NO APLICA Y VUELTA ATRÁS')
{
  await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'particular', p_estado: 'no_aplica' })
  const m = await monto()
  check('se puede marcar no aplica', m.estado_particular === 'no_aplica', m.estado_particular)

  await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'pendiente' })
  const m2 = await monto()
  check('volver a pendiente borra el número de factura',
        m2.estado_compania === 'pendiente' && m2.factura_compania === null,
        `${m2.estado_compania} / ${m2.factura_compania}`)
}

// ── 5. Validaciones ───────────────────────────────────────────────
console.log('\n5. VALIDACIONES')
{
  const a = await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'inventado', p_estado: 'facturado' })
  check('rechaza un rubro inválido', !a.ok)

  const b = await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'pagado' })
  check('rechaza un estado inválido', !b.ok)

  const c = await rest(duena, `vehiculo_monto?vehiculo_id=eq.${VEH}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ estado_compania: 'facturado' }),
  })
  check('no se puede facturar por API directa, sin bitácora', !c.ok, `status ${c.status}`)
}

// ── 6. Permisos ───────────────────────────────────────────────────
console.log('\n6. PERMISOS')
{
  const r = await rpc(chapista, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado' })
  check('quien no tiene taller.montos no puede facturar', !r.ok)

  const m = await monto(recepcion)
  check('y tampoco ve los importes', m === null)
}

// ── 7. Se puede facturar antes de entregar ────────────────────────
console.log('\n7. FACTURAR ANTES DE ENTREGAR')
{
  const { body: v } = await rest(duena, `vehiculo?id=eq.${VEH}&select=etapa`)
  const r = await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado', p_factura: 'B-0002-00000099' })
  check(`se factura con el auto todavía en ${v[0].etapa}`, r.ok, JSON.stringify(r.body))
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
