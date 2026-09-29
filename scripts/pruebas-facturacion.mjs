/**
 * Pruebas de la facturación por rubro (migración 0033).
 *
 * Corre solo contra destinos autorizados: la base local, o el proyecto que
 * figure abajo en PROYECTOS_AUTORIZADOS. Cualquier otro destino lo rechaza.
 *
 * Hoy está autorizado el proyecto de SAU, a propósito: el taller todavía no
 * usa el sistema para trabajar y estamos con una sola base. Cuando haya
 * entorno separado, esta lista se vacía.
 *
 * Trabaja únicamente sobre las empresas ZZ PRUEBA y sobre un vehículo propio
 * (ZZFACT01) que crea si no está. No toca TALLER FORANI ni los vehículos de
 * demostración.
 *
 *   node scripts/pruebas-facturacion.mjs
 */
import fs from 'node:fs'

const BR = String.fromCharCode(10)

// Referencias de proyecto que este script tiene permitido tocar.
const PROYECTOS_AUTORIZADOS = ['cezrotffjvqmymtdjhdw']

const EMPRESA_A = '11111111-aaaa-4aaa-8aaa-111111111111'

function leerEnv(archivo) {
  try {
    return Object.fromEntries(
      fs.readFileSync(new URL(archivo, import.meta.url), 'utf8')
        .split(BR)
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
        }))
  } catch { return {} }
}

const env  = { ...leerEnv('../.env.local'), ...leerEnv('../.env.desarrollo') }
const SUPA = process.env.SUPA_URL  || env.VITE_SUPABASE_URL
const ANON = process.env.SUPA_ANON || env.VITE_SUPABASE_ANON_KEY
const PASS = process.env.SUPA_PASS || 'PruebaTaller2026'

if (!SUPA || !ANON) {
  console.error('Falta la configuración de Supabase (.env.local o .env.desarrollo).')
  process.exit(1)
}

const local = /localhost|127\.0\.0\.1|\[::1\]/.test(SUPA)
const ref   = (SUPA.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1]
if (!local && !PROYECTOS_AUTORIZADOS.includes(ref)) {
  console.error(`Destino no autorizado: ${SUPA}`)
  console.error('Agregalo a PROYECTOS_AUTORIZADOS solo si de verdad corresponde.')
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
// En la base local son los usuarios del seed; contra el proyecto autorizado,
// los de las empresas ZZ PRUEBA, que ya existen.
const U = local
  ? { duena: 'duena@local.test',              sinMontosA: 'chapista@local.test',
      sinMontosB: 'recepcion@local.test',     ajeno: 'almacen@local.test' }
  : { duena: 'taller-a-completo@prueba.sau',  sinMontosA: 'taller-a-operario@prueba.sau',
      sinMontosB: 'taller-a-coordinador@prueba.sau', ajeno: 'taller-b-admin@prueba.sau' }

const duena     = await login(U.duena)
const chapista  = await login(U.sinMontosA)   // sin taller.montos
const recepcion = await login(U.sinMontosB)   // sin taller.montos

// Vehículo propio de esta suite: así no se ensucian los de demostración
// ni los de TALLER FORANI, a los que estos usuarios ni siquiera llegan.
let { body: vs } = await rest(duena, 'vehiculo?patente=eq.ZZFACT01&select=id,patente')
if (!vs?.length) {
  const alta = await rest(duena, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA_A, patente: 'ZZFACT01', vehiculo: 'AUTO DE PRUEBA FACTURACION',
      cliente_nombre: 'CLIENTE DE PRUEBA', compania: 'Particular',
      fecha_ingreso: new Date().toISOString().slice(0, 10),
      fecha_pactada: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      panos: 3, dias_chapa: 5,
    }),
  })
  if (!alta.ok) { console.error('No se pudo crear ZZFACT01:', JSON.stringify(alta.body)); process.exit(1) }
  vs = alta.body
}
const VEH = vs[0].id

// Importes conocidos y estado de arranque limpio, para poder correrla dos veces.
await rest(duena, `vehiculo_monto?vehiculo_id=eq.${VEH}`, {
  method: 'PATCH',
  body: JSON.stringify({ monto_compania: 1000000, monto_franquicia: 200000, monto_particular: 300000 }),
})
for (const r of ['compania', 'franquicia', 'particular']) {
  await rpc(duena, 'taller_registrar_facturacion', { p_vehiculo: VEH, p_rubro: r, p_estado: 'pendiente' })
}
await rpc(duena, 'taller_registrar_cobro', { p_vehiculo: VEH, p_campo: 'cobro_franquicia', p_valor: false })

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

  // El campo actual se borra, pero el historial no: la bitácora tiene que
  // poder responder "con qué número se había facturado esto".
  const { body: ev } = await rest(duena,
    `vehiculo_evento?vehiculo_id=eq.${VEH}&tipo=eq.facturacion&select=texto&order=created_at.desc&limit=1`)
  const txt = ev?.[0]?.texto || ''
  check('la bitácora conserva el estado anterior', /antes:\s*facturado/i.test(txt), txt)
  check('y el número con el que se había facturado', /A-0001-00012345/.test(txt), txt)

  const { body: evs } = await rest(duena,
    `vehiculo_evento?vehiculo_id=eq.${VEH}&tipo=eq.facturacion&select=texto&order=created_at.desc`)
  check('el movimiento original sigue estando',
        (evs || []).some(e => /facturado con factura A-0001-00012345/.test(e.texto)))
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

// ── 6. Sin taller.montos: ni ve la plata ni factura ───────────────
// No alcanza con que la pantalla no dibuje el panel: el servidor no tiene que
// mandarle un solo importe ni dejarlo facturar por más que llame al RPC a mano.
console.log('\n6. SIN taller.montos')
{
  for (const u of [chapista, recepcion]) {
    const quien = u.email.split('@')[0]

    const m = await rest(u, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
    check(`${quien}: el servidor no le manda ningún importe`,
          Array.isArray(m.body) && m.body.length === 0, JSON.stringify(m.body))

    // Tampoco por la vía de pedir las columnas sueltas.
    const s = await rest(u, `vehiculo_monto?select=monto_compania,estado_compania,factura_compania`)
    check(`${quien}: tampoco pidiendo las columnas sueltas`,
          Array.isArray(s.body) && s.body.length === 0, JSON.stringify(s.body))

    const f = await rpc(u, 'taller_registrar_facturacion',
      { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado', p_factura: 'X-1' })
    check(`${quien}: no puede facturar`, !f.ok, JSON.stringify(f.body))

    const c = await rpc(u, 'taller_registrar_cobro',
      { p_vehiculo: VEH, p_campo: 'cobro_compania', p_valor: true })
    check(`${quien}: tampoco puede registrar cobros`, !c.ok)
  }

  // Que sí vea el vehículo: el bloqueo es de plata, no de trabajo.
  const v = await rest(chapista, `vehiculo?id=eq.${VEH}&select=*`)
  check('pero sí ve el vehículo y su trabajo asignado',
        v.body?.[0]?.id === VEH)
  check('y la fila del vehículo no trae ningún importe pegado',
        v.body?.[0] && !Object.keys(v.body[0]).some(k => /^monto_|^estado_|^factura_/.test(k)),
        Object.keys(v.body?.[0] || {}).join(','))
}

// ── 7. Otra empresa: ni consulta ni modifica ──────────────────────
console.log('\n7. AISLAMIENTO ENTRE EMPRESAS')
{
  const ajeno = await login(U.ajeno)   // otra empresa

  const ver = await rest(ajeno, `vehiculo?id=eq.${VEH}&select=id`)
  check('no ve el vehículo de la otra empresa',
        Array.isArray(ver.body) && ver.body.length === 0, JSON.stringify(ver.body))

  const lista = await rest(ajeno, 'vehiculo?select=id')
  check('ni listando todos los vehículos',
        Array.isArray(lista.body) && lista.body.length === 0, JSON.stringify(lista.body))

  const mon = await rest(ajeno, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
  check('no ve sus importes', Array.isArray(mon.body) && mon.body.length === 0)

  const bit = await rest(ajeno, `vehiculo_evento?vehiculo_id=eq.${VEH}&select=texto`)
  check('no ve su bitácora', Array.isArray(bit.body) && bit.body.length === 0)

  const mod = await rest(ajeno, `vehiculo?id=eq.${VEH}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ cliente_nombre: 'INTRUSO' }),
  })
  check('no puede modificarlo',
        !mod.ok || (Array.isArray(mod.body) && mod.body.length === 0), `status ${mod.status}`)

  const fact = await rpc(ajeno, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado', p_factura: 'Z-9' })
  check('no puede facturarlo', !fact.ok, JSON.stringify(fact.body))

  const avan = await rpc(ajeno, 'taller_validar_avance', { p_vehiculo: VEH })
  check('no puede moverlo de etapa', !avan.ok)

  // Y que de verdad no lo tocó.
  const { body: despues } = await rest(duena, `vehiculo?id=eq.${VEH}&select=cliente_nombre`)
  check('el vehículo quedó intacto', despues?.[0]?.cliente_nombre !== 'INTRUSO',
        despues?.[0]?.cliente_nombre)
}

// ── 8. Se puede facturar antes de entregar ────────────────────────
console.log('\n8. FACTURAR ANTES DE ENTREGAR')
{
  const { body: v } = await rest(duena, `vehiculo?id=eq.${VEH}&select=etapa`)
  const r = await rpc(duena, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado', p_factura: 'B-0002-00000099' })
  check(`se factura con el auto todavía en ${v[0].etapa}`, r.ok, JSON.stringify(r.body))
}

// ── 9. Los totales del tablero ────────────────────────────────────
// El total lo arma el navegador, así que se prueba la función directamente
// contra los datos que devuelve el servidor.
console.log('\n9. TOTALES DEL TABLERO')
{
  const { totalesAFacturar } = await import('../src/lib/taller.js')

  const { body: activos } = await rest(duena, 'vehiculo?etapa=neq.entregado&select=id,etapa')
  const { body: montos }  = await rest(duena, 'vehiculo_monto?select=*')
  const porId = Object.fromEntries((montos || []).map(m => [m.vehiculo_id, m]))
  const unidos = (activos || []).map(v => ({ ...v, ...(porId[v.id] || {}) }))

  const t = totalesAFacturar(unidos)
  const aMano = unidos.reduce((s, v) =>
    s + (v.estado_compania === 'pendiente' ? Number(v.monto_compania || 0) : 0), 0)
  check('el total de compañía suma solo lo pendiente', t.compania === aMano, `${t.compania} vs ${aMano}`)

  const facturado = unidos.find(v => v.estado_compania === 'facturado')
  check('un rubro facturado no suma',
        !facturado || totalesAFacturar([facturado]).compania === 0)

  const { body: entregados } = await rest(duena, 'vehiculo?etapa=eq.entregado&select=id,etapa&limit=5')
  const entUnidos = (entregados || []).map(v => ({ ...v, ...(porId[v.id] || {}) }))
  check('los entregados no suman aunque tengan pendiente',
        totalesAFacturar(entUnidos).compania === 0
        && totalesAFacturar(entUnidos).franquicia === 0
        && totalesAFacturar(entUnidos).particular === 0)
  check('pero conservan sus importes para consultarlos',
        entUnidos.length === 0 || entUnidos.some(v => Number(v.monto_compania || 0) > 0))
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
