/**
 * Volver una etapa atrás, y reabrir un entregado (migración 0048).
 *
 * Lo que fija: que se pueda volver de a una etapa, que el avance anterior NUNCA
 * se borre, que el motivo sea obligatorio, quién puede cada cosa, y que reabrir
 * no deje dos órdenes activas de la misma patente.
 *
 * Trabaja sobre un vehículo propio en la empresa de prueba. No toca Forani.
 *
 *   node scripts/pruebas-retroceso.mjs
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
    body: JSON.stringify({ email, password: PASS }) })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No se pudo autenticar ${email}`)
  return { token: j.access_token, email }
}
const h = (u) => ({ apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' })
async function rest(u, path, opts = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { ...h(u), ...opts.headers } })
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { ok: r.ok, status: r.status, body: b }
}
const rpc = (u, fn, args) => rest(u, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

// ──────────────────────────────────────────────────────────────────
const U = local
  ? { completo: 'duena@local.test', coord: 'encargado@local.test',
      operario: 'chapista@local.test', conta: 'recepcion@local.test' }
  : { completo: 'taller-a-completo@prueba.sau', coord: 'taller-a-administrador@prueba.sau',
      operario: 'taller-a-operario@prueba.sau', conta: 'taller-a-contador@prueba.sau' }

const completo = await login(U.completo)
const coord    = await login(U.coord)   // tiene taller.validar, no empresa.admin
const operario = await login(U.operario)
const conta    = await login(U.conta)

const { body: emp } = await rest(completo, 'vehiculo?select=empresa_id&limit=1')
const EMPRESA = emp[0].empresa_id
const marca = Date.now() % 100000
const PAT   = `ZZRET${marca}`

const { body: creado } = await rest(completo, 'vehiculo', {
  method: 'POST', headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ empresa_id: EMPRESA, patente: PAT, vehiculo: 'AUTO DE PRUEBA RETROCESO',
    cliente_nombre: 'CLIENTE RETROCESO', compania: 'Particular',
    fecha_ingreso: '2026-10-01', fecha_pactada: '2026-11-30' }) })
const VEH = creado[0].id
console.log(`\nVehículo de prueba: ${PAT}${BR}`)

const leer = async () => (await rest(completo, `vehiculo?id=eq.${VEH}&select=*`)).body?.[0]
const eventos = async (tipo) => (await rest(completo,
  `vehiculo_evento?vehiculo_id=eq.${VEH}${tipo ? `&tipo=eq.${tipo}` : ''}&select=*&order=created_at.desc`)).body || []
const avanzar = () => rpc(completo, 'taller_validar_avance', { p_vehiculo: VEH })

// ── 1. El motivo es obligatorio ───────────────────────────────────
console.log('1. EL MOTIVO ES OBLIGATORIO')
{
  await avanzar()   // recepcion → chapa
  check('el auto avanzó a chapa', (await leer()).etapa === 'chapa', (await leer()).etapa)

  for (const [etiqueta, motivo] of [['vacío', ''], ['solo espacios', '   '], ['nulo', null]]) {
    const r = await rpc(completo, 'taller_retroceder_etapa', { p_vehiculo: VEH, p_motivo: motivo })
    check(`rechaza un motivo ${etiqueta}`, !r.ok, JSON.stringify(r.body))
  }
  check('y el auto no se movió', (await leer()).etapa === 'chapa')
}

// ── 2. Retroceder una etapa ───────────────────────────────────────
console.log('\n2. VOLVER UNA ETAPA')
{
  const avancesAntes = (await eventos('avance')).length
  const r = await rpc(completo, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'Se apretó avanzar de más' })
  check('vuelve de chapa a recepción', r.ok, JSON.stringify(r.body))
  check('y devuelve la etapa nueva', r.body === 'recepcion', JSON.stringify(r.body))

  const v = await leer()
  check('la etapa quedó en recepción', v.etapa === 'recepcion', v.etapa)
  check('el trabajo quedó sin marcar', v.trabajo_hecho === false)
  check('el reloj de la etapa se reinició',
        new Date(v.etapa_desde) > new Date(Date.now() - 60000), v.etapa_desde)

  // Lo más importante: el avance anterior sigue ahí.
  check('el avance anterior NO se borró', (await eventos('avance')).length === avancesAntes,
        `${(await eventos('avance')).length} vs ${avancesAntes}`)

  const ev = (await eventos('retroceso'))[0]
  check('hay un movimiento propio de retroceso', !!ev, JSON.stringify(ev))
  check('que dice de dónde y a dónde',
        /chapa/.test(ev?.texto || '') && /recepcion/.test(ev?.texto || ''), ev?.texto)
  check('con el motivo', /avanzar de más/.test(ev?.texto || ''), ev?.texto)
  check('con autor', !!ev?.autor_id)
  check('y fecha', !!ev?.created_at)
}

// ── 3. No se puede retroceder desde la primera etapa ──────────────
console.log('\n3. DESDE RECEPCIÓN NO SE VUELVE')
{
  const r = await rpc(completo, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'a ver qué pasa' })
  check('rechaza volver desde recepción', !r.ok, JSON.stringify(r.body))
  check('con un mensaje que lo explica',
        /primera etapa/i.test(JSON.stringify(r.body)), JSON.stringify(r.body))
}

// ── 4. Una etapa por vez, por toda la cadena ──────────────────────
console.log('\n4. UNA POR VEZ, EN LOS DOS SENTIDOS')
{
  // Hasta control de calidad: recepcion → chapa → ... (las intermedias piden
  // que el operario marque, así que lo hace quien tiene taller.trabajar)
  for (let i = 0; i < 6; i++) {
    const v = await leer()
    if (v.etapa === 'control_calidad') break
    await rpc(operario, 'taller_marcar_trabajo_hecho', { p_vehiculo: VEH })
    await avanzar()
  }
  check('llegó a control de calidad', (await leer()).etapa === 'control_calidad',
        (await leer()).etapa)

  const r = await rpc(completo, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'Hay que rehacer la terminación' })
  check('vuelve a terminación', r.body === 'terminacion', JSON.stringify(r.body))
  const r2 = await rpc(completo, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'Y también la pintura' })
  check('y de nuevo a pintura', r2.body === 'pintura', JSON.stringify(r2.body))
  check('dos movimientos de retroceso', (await eventos('retroceso')).length === 3,
        String((await eventos('retroceso')).length))
}

// ── 5. La excepción se conserva ───────────────────────────────────
console.log('\n5. LA EXCEPCIÓN SE CONSERVA')
{
  await rpc(completo, 'taller_cambiar_excepcion', { p_vehiculo: VEH, p_excepcion: 'mecanica' })
  const antes = await leer()
  check('el auto quedó en mecánica', antes.excepcion === 'mecanica', antes.excepcion)

  const r = await rpc(completo, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'Vuelve con la mecánica puesta' })
  check('se puede retroceder con excepción activa', r.ok, JSON.stringify(r.body))

  const dsp = await leer()
  check('la excepción sigue puesta', dsp.excepcion === 'mecanica', dsp.excepcion)
  check('y conserva desde cuándo', dsp.excepcion_desde === antes.excepcion_desde)

  await rpc(completo, 'taller_cambiar_excepcion', { p_vehiculo: VEH, p_excepcion: null })
}

// ── 6. No se toca la plata ni los adjuntos ────────────────────────
console.log('\n6. LA PLATA Y LOS PAPELES NO SE MUEVEN')
{
  await rpc(completo, 'taller_registrar_monto', { p_vehiculo: VEH, p_rubro: 'compania', p_monto: 500000 })
  await rpc(completo, 'taller_registrar_facturacion',
    { p_vehiculo: VEH, p_rubro: 'compania', p_estado: 'facturado', p_factura: 'A-0001-00000777' })
  const { body: m1 } = await rest(completo, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)

  await rpc(completo, 'taller_retroceder_etapa', { p_vehiculo: VEH, p_motivo: 'control de plata' })

  const { body: m2 } = await rest(completo, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
  check('el importe no cambió', Number(m2[0].monto_compania) === Number(m1[0].monto_compania))
  check('el estado de facturación tampoco', m2[0].estado_compania === m1[0].estado_compania)
  check('ni el número de factura', m2[0].factura_compania === m1[0].factura_compania)
}

// ── 7. Quién puede retroceder ─────────────────────────────────────
console.log('\n7. QUIÉN PUEDE VOLVER DE ETAPA')
{
  const etapaAntes = (await leer()).etapa

  const op = await rpc(operario, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'quiero volver' })
  check('el operario no puede', !op.ok, JSON.stringify(op.body))

  const co = await rpc(conta, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'quiero volver' })
  check('el contador tampoco', !co.ok, JSON.stringify(co.body))

  check('y el auto no se movió', (await leer()).etapa === etapaAntes)

  const cd = await rpc(coord, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'El coordinador corrige su propio clic' })
  check('el coordinador sí', cd.ok, JSON.stringify(cd.body))
}

// ── 8. Reabrir un entregado ───────────────────────────────────────
console.log('\n8. REABRIR UN ENTREGADO')
{
  // Llevarlo hasta entregado
  for (let i = 0; i < 7; i++) {
    const v = await leer()
    if (v.etapa === 'control_calidad') break
    await rpc(operario, 'taller_marcar_trabajo_hecho', { p_vehiculo: VEH })
    await avanzar()
  }
  await rpc(completo, 'taller_entregar', { p_vehiculo: VEH, p_fecha: '2026-10-10' })
  const ent = await leer()
  check('el auto quedó entregado', ent.etapa === 'entregado', ent.etapa)
  check('con fecha de entrega', ent.fecha_entrega === '2026-10-10', ent.fecha_entrega)

  // Retroceder NO sirve para un entregado: hay que reabrir
  const mal = await rpc(completo, 'taller_retroceder_etapa',
    { p_vehiculo: VEH, p_motivo: 'probando' })
  check('un entregado no retrocede', !mal.ok, JSON.stringify(mal.body))
  check('y el mensaje manda a la reapertura',
        /reapertura/i.test(JSON.stringify(mal.body)), JSON.stringify(mal.body))

  // Motivo obligatorio
  const sinMotivo = await rpc(completo, 'taller_reabrir_vehiculo', { p_vehiculo: VEH, p_motivo: '  ' })
  check('reabrir exige motivo', !sinMotivo.ok, JSON.stringify(sinMotivo.body))

  // El coordinador NO puede reabrir: es empresa.admin
  const porCoord = await rpc(coord, 'taller_reabrir_vehiculo',
    { p_vehiculo: VEH, p_motivo: 'quiero reabrirlo' })
  check('el coordinador no reabre', !porCoord.ok, JSON.stringify(porCoord.body))
  check('sigue entregado', (await leer()).etapa === 'entregado')

  const { body: montoAntes } = await rest(completo, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)

  const r = await rpc(completo, 'taller_reabrir_vehiculo',
    { p_vehiculo: VEH, p_motivo: 'El cliente volvió por un detalle de pintura' })
  check('quien administra sí reabre', r.ok, JSON.stringify(r.body))

  const v = await leer()
  check('vuelve a control de calidad', v.etapa === 'control_calidad', v.etapa)
  check('se borró la fecha de entrega', v.fecha_entrega === null, v.fecha_entrega)
  check('el trabajo quedó sin marcar', v.trabajo_hecho === false)

  const { body: montoDsp } = await rest(completo, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=*`)
  check('la facturación quedó intacta',
        montoDsp[0].estado_compania === montoAntes[0].estado_compania &&
        montoDsp[0].factura_compania === montoAntes[0].factura_compania &&
        Number(montoDsp[0].monto_compania) === Number(montoAntes[0].monto_compania))

  const ev = (await eventos('reapertura'))[0]
  check('hay un movimiento propio de reapertura', !!ev, JSON.stringify(ev))
  check('con el motivo', /detalle de pintura/.test(ev?.texto || ''), ev?.texto)
  check('con autor', !!ev?.autor_id)
  check('y la entrega anterior sigue en la bitácora', (await eventos('entrega')).length === 1)
}

// ── 9. Reabrir no puede dejar dos órdenes activas ─────────────────
console.log('\n9. REABRIR CON OTRA ORDEN ACTIVA')
{
  // Entregar el de prueba otra vez
  await rpc(completo, 'taller_entregar', { p_vehiculo: VEH, p_fecha: '2026-10-11' })
  check('vuelve a quedar entregado', (await leer()).etapa === 'entregado')

  // Y abrir OTRA orden con la misma patente
  const otra = await rest(completo, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ empresa_id: EMPRESA, patente: PAT, vehiculo: 'SEGUNDA ORDEN',
      cliente_nombre: 'X', compania: 'Particular', fecha_ingreso: '2026-10-12' }) })
  check('la segunda orden entra (el otro está entregado)', otra.ok, JSON.stringify(otra.body))

  const r = await rpc(completo, 'taller_reabrir_vehiculo',
    { p_vehiculo: VEH, p_motivo: 'quiero reabrirlo igual' })
  check('NO se puede reabrir con otra orden activa', !r.ok, JSON.stringify(r.body))
  check('y el mensaje dice cuál es la que molesta',
        /orden activa/i.test(JSON.stringify(r.body)), JSON.stringify(r.body))
  check('el entregado sigue entregado', (await leer()).etapa === 'entregado')
}

// ── 10. Limpieza ──────────────────────────────────────────────────
console.log('\n10. LIMPIEZA')
{
  const borrar = await rest(completo, `vehiculo?patente=eq.${PAT}`, { method: 'DELETE' })
  const { body: queda } = await rest(completo, `vehiculo?patente=eq.${PAT}&select=id`)
  check('ni quien valida puede borrar vehículos',
        !borrar.ok || (queda || []).length > 0, `status ${borrar.status}`)
  console.log(`  (los descartables ZZRET% los saca scripts/seed-pruebas-taller.sql)`)
}

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
