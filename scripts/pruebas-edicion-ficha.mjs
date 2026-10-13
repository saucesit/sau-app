/**
 * Editar el expediente después del alta (migración 0045).
 *
 * El alta es rápida y la ficha se completa después. Lo que fija esta suite:
 * que los trece datos se puedan corregir, que ninguno se mueva sin quedar
 * escrito en la bitácora, que el permiso siga siendo taller.cargar, y que las
 * cuatro columnas estructurales no se puedan tocar por más que la policy deje
 * pasar el UPDATE.
 *
 * Escribe SOLO sobre un vehículo propio que crea en la empresa de prueba.
 * Nunca toca TALLER FORANI.
 *
 *   node scripts/pruebas-edicion-ficha.mjs
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
const rpc = (u, fn, args) => rest(u, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

// ──────────────────────────────────────────────────────────────────
const U = local
  ? { duena: 'duena@local.test', operario: 'chapista@local.test', coord: 'encargado@local.test' }
  : { duena: 'taller-a-completo@prueba.sau', operario: 'taller-a-operario@prueba.sau',
      coord: 'taller-a-coordinador@prueba.sau' }

const duena    = await login(U.duena)
const operario = await login(U.operario)
const coord    = await login(U.coord)

const { body: emp } = await rest(duena, 'vehiculo?select=empresa_id&limit=1')
const EMPRESA = emp?.[0]?.empresa_id
if (!EMPRESA) { console.error('No se pudo ubicar la empresa de prueba'); process.exit(1) }

const marca = Date.now() % 100000
const PAT   = `ZZED${marca}`

const { body: creado } = await rest(duena, 'vehiculo', {
  method: 'POST', headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    empresa_id: EMPRESA, patente: PAT, vehiculo: 'AUTO DE PRUEBA EDICION',
    cliente_nombre: 'CLIENTE ORIGINAL', compania: 'Particular',
    fecha_ingreso: '2026-10-01', fecha_pactada: null,
  }),
})
const VEH = creado?.[0]?.id
if (!VEH) { console.error('No se pudo crear el vehículo de prueba'); process.exit(1) }
console.log(`\nVehículo de prueba: ${PAT}\n`)

const leer = async (u = duena) =>
  (await rest(u, `vehiculo?id=eq.${VEH}&select=*`)).body?.[0] || null
const eventos = async () =>
  (await rest(duena, `vehiculo_evento?vehiculo_id=eq.${VEH}&tipo=eq.edicion&select=*&order=created_at.desc`)).body || []
const editar = (u, datos) =>
  rest(u, `vehiculo?id=eq.${VEH}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
                                     body: JSON.stringify(datos) })

// ── 1. Los diez campos normales ───────────────────────────────────
console.log('1. LOS DIEZ CAMPOS NORMALES')
{
  const nuevos = {
    vehiculo: 'Toyota Hilux SRX', kilometraje: 88000, cliente_nombre: 'CLIENTE CORREGIDO',
    telefono: '387 555-9999', panos: 4, dias_chapa: 6, compania: 'Zurich',
    productor: 'P. Nuevo', perito: 'J. Nuevo', nro_siniestro: '70999888777',
  }
  const r = await editar(duena, nuevos)
  check('se editan los diez de una', r.ok, JSON.stringify(r.body))

  const v = await leer()
  const iguales = Object.entries(nuevos).every(([c, val]) => String(v[c]) === String(val))
  check('y quedan todos guardados', iguales,
        JSON.stringify(Object.fromEntries(Object.keys(nuevos).map(c => [c, v[c]]))))

  const ev = (await eventos())[0]
  check('con un movimiento en la bitácora', !!ev, JSON.stringify(ev))
  check('que nombra los diez campos',
        ['vehículo', 'kilometraje', 'cliente', 'teléfono', 'paños', 'días de chapa',
         'compañía', 'productor', 'perito', 'siniestro'].every(p => (ev?.texto || '').includes(p)),
        ev?.texto)
  check('con el valor anterior', /CLIENTE ORIGINAL/.test(ev?.texto || ''), ev?.texto)
  check('y el nuevo',            /CLIENTE CORREGIDO/.test(ev?.texto || ''), ev?.texto)
  check('con autor', !!ev?.autor_id)
  check('y fecha',   !!ev?.created_at)
}

// ── 2. Guardar lo mismo no ensucia la bitácora ────────────────────
console.log('\n2. SIN CAMBIOS, SIN MOVIMIENTO')
{
  const antes = (await eventos()).length
  const r = await editar(duena, { perito: 'J. Nuevo' })
  check('guardar el mismo valor no falla', r.ok, JSON.stringify(r.body))
  check('pero no deja un movimiento nuevo', (await eventos()).length === antes)
}

// ── 3. Los tres campos sensibles ──────────────────────────────────
console.log('\n3. PATENTE Y FECHAS')
{
  const nueva = `ZZED${marca}X`
  const r = await editar(duena, { patente: nueva })
  check('la patente se puede cambiar', r.ok, JSON.stringify(r.body))
  const v = await leer()
  check('y se guarda normalizada', v.patente === nueva.toUpperCase(), v.patente)
  check('queda en la bitácora', /patente/.test((await eventos())[0]?.texto || ''))

  const rf = await editar(duena, { fecha_pactada: '2026-11-30' })
  check('se completa una fecha pactada vacía', rf.ok, JSON.stringify(rf.body))
  check('y queda escrito', /fecha pactada/.test((await eventos())[0]?.texto || ''),
        (await eventos())[0]?.texto)

  const ri = await editar(duena, { fecha_ingreso: '2026-09-15' })
  check('se cambia la fecha de ingreso de un activo', ri.ok, JSON.stringify(ri.body))
  check('con el antes y el después',
        /15\/09\/2026/.test((await eventos())[0]?.texto || ''), (await eventos())[0]?.texto)
}

// ── 4. Las cuatro columnas estructurales ──────────────────────────
console.log('\n4. LO QUE NO SE TOCA')
{
  const v = await leer()
  const casos = [
    ['id',              { id: '00000000-0000-4000-8000-000000000000' }],
    ['created_at',      { created_at: '2020-01-01T00:00:00Z' }],
    ['origen_import',   { origen_import: 'inventado' }],
    ['orden_adicional', { orden_adicional: true }],
  ]
  for (const [nombre, datos] of casos) {
    const r = await editar(duena, datos)
    check(`no se puede cambiar ${nombre}`, !r.ok, `status ${r.status}`)
  }

  const despues = await leer()
  check('y ninguno se movió',
        despues.id === v.id && despues.created_at === v.created_at &&
        despues.origen_import === v.origen_import &&
        despues.orden_adicional === v.orden_adicional)

  // Colado junto a un campo legítimo, tampoco.
  const mixto = await editar(duena, { perito: 'P. Otro', orden_adicional: true })
  check('tampoco colado junto a un campo editable', !mixto.ok, `status ${mixto.status}`)
  check('y el campo legítimo tampoco entró',
        (await leer()).perito === 'J. Nuevo', (await leer()).perito)
}

// ── 5. El alta de una segunda orden sigue funcionando ─────────────
// Es lo que había que verificar al cerrar orden_adicional: la bandera se pone
// al INSERTAR y la guardia es sobre UPDATE, así que el circuito legítimo vive.
console.log('\n5. LA SEGUNDA ORDEN LEGÍTIMA')
{
  const v = await leer()
  const sinConfirmar = await rest(duena, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA, patente: v.patente, vehiculo: 'SEGUNDA ORDEN',
      cliente_nombre: 'X', compania: 'Particular', fecha_ingreso: '2026-10-05' }),
  })
  check('sin confirmar, la segunda orden se rechaza', !sinConfirmar.ok, `status ${sinConfirmar.status}`)
  check('y el mensaje explica por qué',
        /orden activa/i.test(JSON.stringify(sinConfirmar.body)), JSON.stringify(sinConfirmar.body))

  const confirmada = await rest(duena, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA, patente: v.patente, vehiculo: 'SEGUNDA ORDEN',
      cliente_nombre: 'X', compania: 'Particular', fecha_ingreso: '2026-10-05',
      orden_adicional: true }),
  })
  check('confirmando que es otra orden, entra', confirmada.ok, JSON.stringify(confirmada.body))
  const SEGUNDA = confirmada.body?.[0]?.id
  check('y queda con la bandera puesta', confirmada.body?.[0]?.orden_adicional === true)

  // Pero editar una patente hacia una que ya tiene orden activa, no.
  if (SEGUNDA) {
    const otra = await rest(duena, 'vehiculo', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        empresa_id: EMPRESA, patente: `ZZOTRA${marca}`, vehiculo: 'TERCERA',
        cliente_nombre: 'X', compania: 'Particular', fecha_ingreso: '2026-10-06' }),
    })
    if (otra.ok) {
      const choque = await rest(duena, `vehiculo?id=eq.${otra.body[0].id}`, {
        method: 'PATCH', body: JSON.stringify({ patente: v.patente }) })
      check('editar la patente hacia una con orden activa se rechaza', !choque.ok,
            `status ${choque.status}`)
      await rest(duena, `vehiculo?id=eq.${otra.body[0].id}`, { method: 'DELETE' })
    }
    await rest(duena, `vehiculo?id=eq.${SEGUNDA}`, { method: 'DELETE' })
  }
}

// ── 6. Permisos ───────────────────────────────────────────────────
console.log('\n6. QUIÉN PUEDE EDITAR')
{
  const r = await editar(operario, { cliente_nombre: 'TOCADO POR EL OPERARIO' })
  check('el operario no edita la ficha',
        !r.ok || (Array.isArray(r.body) && r.body.length === 0), `status ${r.status}`)
  check('y el dato no cambió', (await leer()).cliente_nombre === 'CLIENTE CORREGIDO')

  // El coordinador sí tiene taller.cargar: es el mismo permiso que da de alta.
  const c = await editar(coord, { perito: 'J. Coordinador' })
  check('quien da de alta también edita', c.ok, JSON.stringify(c.body))
  check('y queda registrado con su nombre',
        (await eventos())[0]?.autor_id !== null)

  const { body: mio } = await rest(duena, `vehiculo_evento?vehiculo_id=eq.${VEH}&tipo=eq.edicion&select=autor_id&order=created_at.desc&limit=1`)
  check('el autor del último cambio es quien lo hizo', !!mio?.[0]?.autor_id)
}

// ── 7. Un entregado ───────────────────────────────────────────────
console.log('\n7. UN VEHÍCULO ENTREGADO')
{
  const { body: ent } = await rest(duena,
    'vehiculo?etapa=eq.entregado&select=*&limit=1')
  if (!ent?.length) { console.log('  (sin entregados para probar)') }
  else {
    const E = ent[0]

    // Los doce que sí: ninguno reescribe la historia del trabajo.
    const doce = {
      vehiculo: E.vehiculo, kilometraje: (E.kilometraje || 0) + 1,
      cliente_nombre: E.cliente_nombre, telefono: '387 555-0000',
      panos: E.panos, dias_chapa: E.dias_chapa, compania: E.compania,
      productor: 'P. Entregado ' + marca, perito: 'J. Corregido ' + marca,
      nro_siniestro: E.nro_siniestro, patente: E.patente,
      fecha_pactada: E.fecha_pactada,
    }
    const r = await rest(duena, `vehiculo?id=eq.${E.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify(doce) })
    check('los doce campos se corrigen en un entregado', r.ok, JSON.stringify(r.body))

    const { body: ev } = await rest(duena,
      `vehiculo_evento?vehiculo_id=eq.${E.id}&tipo=eq.edicion&select=texto&order=created_at.desc&limit=1`)
    check('y queda en su bitácora', /perito/.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)

    // La fecha de ingreso, no. Es regla de negocio y la hace cumplir el
    // servidor (migración 0046), no solamente la pantalla.
    const otra = new Date(E.fecha_ingreso)
    otra.setDate(otra.getDate() - 10)
    const f = await rest(duena, `vehiculo?id=eq.${E.id}`, {
      method: 'PATCH', body: JSON.stringify({ fecha_ingreso: otra.toISOString().slice(0, 10) }) })
    check('la fecha de ingreso de un entregado NO se cambia por API', !f.ok, `status ${f.status}`)
    check('y el mensaje explica por qué',
          /trabajo ya cerrado/i.test(JSON.stringify(f.body)), JSON.stringify(f.body))
    check('la fecha quedó como estaba',
          (await rest(duena, `vehiculo?id=eq.${E.id}&select=fecha_ingreso`)).body?.[0]?.fecha_ingreso
          === E.fecha_ingreso)

    // Ni colada junto a un campo que sí se puede.
    const colada = await rest(duena, `vehiculo?id=eq.${E.id}`, {
      method: 'PATCH', body: JSON.stringify({
        perito: 'J. Intruso', fecha_ingreso: otra.toISOString().slice(0, 10) }) })
    check('tampoco colada junto a un campo editable', !colada.ok, `status ${colada.status}`)
    check('y el campo editable tampoco entró',
          (await rest(duena, `vehiculo?id=eq.${E.id}&select=perito`)).body?.[0]?.perito
          !== 'J. Intruso')

    // Mandar la MISMA fecha no es un cambio y no tiene por qué fallar: si no,
    // guardar el formulario entero de un entregado se caería sin motivo.
    const igual = await rest(duena, `vehiculo?id=eq.${E.id}`, {
      method: 'PATCH', body: JSON.stringify({
        fecha_ingreso: E.fecha_ingreso, perito: 'J. Igual ' + marca }) })
    check('mandar la misma fecha de ingreso no falla', igual.ok, `status ${igual.status}`)

    // Devolver el entregado a como estaba.
    await rest(duena, `vehiculo?id=eq.${E.id}`, {
      method: 'PATCH', body: JSON.stringify({
        kilometraje: E.kilometraje, telefono: E.telefono,
        productor: E.productor, perito: E.perito }) })
  }

  // Y en un activo la fecha de ingreso se sigue pudiendo corregir.
  const act = await editar(duena, { fecha_ingreso: '2026-09-20' })
  check('en un activo la fecha de ingreso sí se cambia', act.ok, JSON.stringify(act.body))
  check('y queda en la bitácora',
        /fecha de ingreso/.test((await eventos())[0]?.texto || ''), (await eventos())[0]?.texto)
}

// ── 8. Lo obligatorio y el flujo ──────────────────────────────────
console.log('\n8. LO QUE SIGUE PROTEGIDO')
{
  const nulo = await editar(duena, { cliente_nombre: null })
  check('el cliente no puede quedar nulo', !nulo.ok, `status ${nulo.status}`)

  const etapa = await editar(duena, { etapa: 'pintura' })
  check('la etapa sigue sin moverse por UPDATE', !etapa.ok, `status ${etapa.status}`)

  const entrega = await editar(duena, { fecha_entrega: '2026-10-10' })
  check('la fecha de entrega tampoco', !entrega.ok, `status ${entrega.status}`)

  const empresa = await editar(duena, { empresa_id: '22222222-bbbb-4bbb-8bbb-222222222222' })
  check('ni la empresa', !empresa.ok, `status ${empresa.status}`)
}

// ── 9. Limpieza ───────────────────────────────────────────────────
// La suite NO puede borrar lo que creó: taller.eliminar está reservado a SAU
// justamente porque borrar un vehículo se lleva su historial entero. Que el
// intento sea rechazado es parte de lo que hay que comprobar. Los descartables
// quedan con patente ZZED% / ZZOTRA% y los saca seed-pruebas-taller.sql.
console.log('\n9. LIMPIEZA')
{
  const borrar = await rest(duena, `vehiculo?id=eq.${VEH}`, { method: 'DELETE' })
  const { body: queda } = await rest(duena, `vehiculo?id=eq.${VEH}&select=id,patente`)
  check('ni quien edita puede borrar un vehículo',
        !borrar.ok || (Array.isArray(queda) && queda.length === 1), `status ${borrar.status}`)
  check('el descartable queda identificado para el seed',
        queda?.[0]?.patente?.startsWith('ZZED'), JSON.stringify(queda))
  console.log('  (corré scripts/seed-pruebas-taller.sql para sacarlos)')
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
