/**
 * Anular un ingreso cargado por error, y restaurarlo (migración 0052).
 *
 * Lo que se comprueba es una sola idea con muchas consecuencias: un vehículo
 * anulado SALE del circuito vigente y NO PIERDE NADA. Sale de la pizarra, de
 * los totales, de la guardia de patente duplicada y de los reportes; y
 * conserva sus archivos, su bitácora, sus importes y su facturación.
 *
 * Todo contra TALLER SAN MARTÍN. Los vehículos que crea se identifican con
 * ZZANUL% y los borra el seed; ninguna escritura toca a Forani.
 *
 *   node scripts/pruebas-anulacion.mjs
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'

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

async function subir(u, path, contenido, tipoMime = 'application/pdf') {
  const r = await fetch(`${SUPA}/storage/v1/object/taller/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': tipoMime },
    body: contenido,
  })
  return { status: r.status, ok: r.ok }
}

// ──────────────────────────────────────────────────────────────────
const admin       = await login('taller-a-completo@prueba.sau')       // empresa.admin
const sinAdmin    = await login('taller-a-administrador@prueba.sau')  // todo menos empresa.admin
const coordinador = await login('taller-a-coordinador@prueba.sau')
const operario    = await login('taller-a-operario@prueba.sau')
const otraEmpresa = await login('taller-b-admin@prueba.sau')

const marca = Date.now() % 1000000
const hoy   = new Date().toISOString().slice(0, 10)

/** Crea un vehículo de prueba en la empresa A. Devuelve la fila. */
async function nuevo(sufijo, extra = {}) {
  const r = await rest(admin, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA_A,
      patente: `ZZANUL${sufijo}`,
      vehiculo: 'AUTO DE PRUEBA ANULACION',
      cliente_nombre: 'CLIENTE DE PRUEBA',
      compania: 'Particular',
      fecha_ingreso: hoy,
      ...extra,
    }),
  })
  if (!r.ok) { console.error(`No pude crear ZZANUL${sufijo}:`, JSON.stringify(r.body)); process.exit(1) }
  return r.body[0]
}

const creados = []
const V1 = await nuevo(`A${marca}`); creados.push(V1.id)
console.log(`${BR}Vehículo de prueba: ${V1.patente}${BR}`)

// ── 1. Quién puede anular ─────────────────────────────────────────
console.log('1. SOLO empresa.admin ANULA')
{
  const sin = await rpc(sinAdmin, 'taller_anular_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'quiero sacarlo' })
  check('el perfil Administrador no puede anular', !sin.ok, JSON.stringify(sin.body))

  const coord = await rpc(coordinador, 'taller_anular_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'quiero sacarlo' })
  check('el coordinador tampoco', !coord.ok)

  const op = await rpc(operario, 'taller_anular_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'quiero sacarlo' })
  check('el operario menos todavía', !op.ok)

  const ajeno = await rpc(otraEmpresa, 'taller_anular_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'de otra empresa' })
  check('y un admin de OTRA empresa no toca este vehículo', !ajeno.ok, JSON.stringify(ajeno.body))

  const { body: intacto } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=anulado_en`)
  check('después de los cuatro intentos sigue sin anular', intacto?.[0]?.anulado_en === null)
}

// ── 2. El motivo es obligatorio ───────────────────────────────────
console.log(`${BR}2. SIN MOTIVO NO SE ANULA`)
{
  for (const [label, motivo] of [['vacío', ''], ['solo espacios', '   '], ['nulo', null]]) {
    const r = await rpc(admin, 'taller_anular_vehiculo', { p_vehiculo: V1.id, p_motivo: motivo })
    check(`motivo ${label} → rechazado`, !r.ok, JSON.stringify(r.body))
  }
  const { body: intacto } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=anulado_en`)
  check('y el vehículo sigue activo', intacto?.[0]?.anulado_en === null)
}

// ── 3. Anulación normal ───────────────────────────────────────────
console.log(`${BR}3. ANULAR, CON AUTOR Y FECHA`)
{
  const MOTIVO = 'Cargado dos veces por error'
  const r = await rpc(admin, 'taller_anular_vehiculo', { p_vehiculo: V1.id, p_motivo: MOTIVO })
  check('quien administra sí anula', r.ok, JSON.stringify(r.body))

  const { body: d } = await rest(admin,
    `vehiculo?id=eq.${V1.id}&select=anulado_en,anulado_por,anulado_motivo,etapa`)
  check('queda la fecha',  !!d?.[0]?.anulado_en)
  check('queda el autor',  !!d?.[0]?.anulado_por)
  check('queda el motivo', d?.[0]?.anulado_motivo === MOTIVO, d?.[0]?.anulado_motivo)
  check('la etapa NO se toca: queda donde estaba', d?.[0]?.etapa === 'recepcion', d?.[0]?.etapa)

  const { body: ev } = await rest(admin,
    `vehiculo_evento?vehiculo_id=eq.${V1.id}&tipo=eq.anulacion_vehiculo&select=texto,autor_id`)
  check('hay un movimiento propio en la bitácora', ev?.length === 1, JSON.stringify(ev))
  check('con el motivo adentro', /dos veces por error/.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)
  check('y con autor', !!ev?.[0]?.autor_id)

  const otra = await rpc(admin, 'taller_anular_vehiculo', { p_vehiculo: V1.id, p_motivo: 'de nuevo' })
  check('no se anula dos veces', !otra.ok, JSON.stringify(otra.body))
}

// ── 4. La fila NO se borra, y nadie la toca a mano ───────────────
console.log(`${BR}4. ANULAR NO ES BORRAR`)
{
  const { body: sigue } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=id,patente`)
  check('la fila sigue existiendo', sigue?.length === 1)

  // Las tres columnas están blindadas igual que el resto del flujo.
  const mano = await rest(admin, `vehiculo?id=eq.${V1.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ anulado_motivo: 'motivo cambiado a mano' }),
  })
  const { body: tras } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=anulado_motivo`)
  check('el motivo no se edita por API directa',
        tras?.[0]?.anulado_motivo === 'Cargado dos veces por error',
        `status ${mano.status} → ${tras?.[0]?.anulado_motivo}`)

  const desanular = await rest(admin, `vehiculo?id=eq.${V1.id}`, {
    method: 'PATCH', body: JSON.stringify({ anulado_en: null }),
  })
  const { body: tras2 } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=anulado_en`)
  check('ni se levanta la marca con un PATCH', !!tras2?.[0]?.anulado_en,
        `status ${desanular.status}`)
}

// ── 5. Desaparece del circuito vigente ───────────────────────────
console.log(`${BR}5. FUERA DE LA PIZARRA, LOS KPIs Y LOS TOTALES`)
{
  // La consulta exacta que hace la pizarra.
  const { body: pizarra } = await rest(admin,
    `vehiculo?empresa_id=eq.${EMPRESA_A}&etapa=neq.entregado&anulado_en=is.null&select=id`)
  check('no está en la pizarra', !(pizarra || []).some(x => x.id === V1.id))

  // Y la de siempre, para dejar claro que la diferencia es el filtro nuevo.
  const { body: vieja } = await rest(admin,
    `vehiculo?empresa_id=eq.${EMPRESA_A}&etapa=neq.entregado&select=id`)
  check('la consulta vieja SÍ lo traía (por eso hizo falta el filtro)',
        (vieja || []).some(x => x.id === V1.id))

  const { totalesAFacturar, esActivo, estaAnulado } = await import('../src/lib/taller.js')
  const { body: m } = await rest(admin, `vehiculo_monto?vehiculo_id=eq.${V1.id}&select=*`)
  const { body: v } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=*`)
  const unido = { ...v[0], ...(m?.[0] || {}) }
  check('estaAnulado lo reconoce', estaAnulado(unido) === true)
  check('esActivo dice que no', esActivo(unido) === false)
  const t = totalesAFacturar([unido])
  check('sus importes no suman en los totales',
        t.compania === 0 && t.franquicia === 0 && t.particular === 0, JSON.stringify(t))

  // El archivo de entregados tampoco se lo come.
  const { body: entregados } = await rest(admin,
    `vehiculo?empresa_id=eq.${EMPRESA_A}&etapa=eq.entregado&anulado_en=is.null&select=id`)
  check('no aparece entre los entregados', !(entregados || []).some(x => x.id === V1.id))
}

// ── 6. Aparece en ANULADOS ───────────────────────────────────────
console.log(`${BR}6. SE CONSULTA DESDE ANULADOS`)
{
  const { body: anulados } = await rest(admin,
    `vehiculo?empresa_id=eq.${EMPRESA_A}&anulado_en=not.is.null&select=id,patente,anulado_motivo`)
  check('está en la lista de anulados', (anulados || []).some(x => x.id === V1.id))
  check('con su motivo a la vista',
        anulados.find(x => x.id === V1.id)?.anulado_motivo === 'Cargado dos veces por error')

  const { body: ficha } = await rest(admin, `vehiculo?id=eq.${V1.id}&select=*`)
  check('y su ficha se sigue abriendo', ficha?.length === 1)
}

// ── 7. Un anulado no se mueve por el circuito ────────────────────
console.log(`${BR}7. UN ANULADO NO AVANZA NI SE ENTREGA`)
{
  const av = await rpc(coordinador, 'taller_validar_avance', { p_vehiculo: V1.id })
  check('no avanza', !av.ok, JSON.stringify(av.body))
  check('y el mensaje dice que está anulado',
        /anulad/i.test(JSON.stringify(av.body || '')), JSON.stringify(av.body))

  const tr = await rpc(operario, 'taller_marcar_trabajo_hecho', { p_vehiculo: V1.id })
  check('no se le marca trabajo', !tr.ok, JSON.stringify(tr.body))

  const ex = await rpc(coordinador, 'taller_cambiar_excepcion',
    { p_vehiculo: V1.id, p_excepcion: 'detenido' })
  check('no se le pone una excepción', !ex.ok, JSON.stringify(ex.body))

  const en = await rpc(coordinador, 'taller_entregar', { p_vehiculo: V1.id, p_fecha: hoy })
  check('no se entrega', !en.ok)

  const { body: quieto } = await rest(admin,
    `vehiculo?id=eq.${V1.id}&select=etapa,excepcion,trabajo_hecho`)
  check('después de los cuatro intentos sigue igual',
        quieto?.[0]?.etapa === 'recepcion' && quieto?.[0]?.excepcion === null
        && quieto?.[0]?.trabajo_hecho === false, JSON.stringify(quieto?.[0]))
}

// ── 8. La patente queda libre ────────────────────────────────────
console.log(`${BR}8. UN ANULADO NO OCUPA LA PATENTE`)
{
  // Éste es el punto que hacía falta cerrar: si el anulado siguiera contando
  // como orden activa, se habría cambiado "no puedo sacar el mal cargado" por
  // "no puedo cargar el bueno".
  const bueno = await rest(admin, 'vehiculo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      empresa_id: EMPRESA_A, patente: V1.patente,
      vehiculo: 'EL BUENO', cliente_nombre: 'CLIENTE DE PRUEBA',
      compania: 'Particular', fecha_ingreso: hoy }),
  })
  check('se puede cargar el mismo auto de nuevo, sin confirmar nada', bueno.ok,
        JSON.stringify(bueno.body))
  if (bueno.ok) creados.push(bueno.body[0].id)

  const { body: activas } = await rpc(admin, 'taller_ordenes_activas',
    { p_empresa: EMPRESA_A, p_patente: V1.patente })
  check('taller_ordenes_activas devuelve solo la buena',
        activas?.length === 1 && activas[0].id === bueno.body[0].id,
        JSON.stringify(activas?.map(x => x.vehiculo)))
}

// ── 9. Restaurar ─────────────────────────────────────────────────
console.log(`${BR}9. RESTAURAR, Y EL CONFLICTO DE PATENTE`)
{
  const sin = await rpc(sinAdmin, 'taller_restaurar_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'lo quiero de vuelta' })
  check('restaurar también es solo de empresa.admin', !sin.ok)

  const sinMotivo = await rpc(admin, 'taller_restaurar_vehiculo',
    { p_vehiculo: V1.id, p_motivo: '  ' })
  check('y también exige motivo', !sinMotivo.ok)

  // Con la otra orden abierta, restaurar dejaría dos. Se rechaza.
  const choque = await rpc(admin, 'taller_restaurar_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'me equivoqué al anularlo' })
  check('NO se restaura si ya hay otra orden activa de la misma patente', !choque.ok,
        JSON.stringify(choque.body))
  check('y el mensaje dice cuál es el conflicto',
        /otra orden activa/i.test(JSON.stringify(choque.body || '')), JSON.stringify(choque.body))
  check('no se resolvió solo: sigue anulado',
        !!(await rest(admin, `vehiculo?id=eq.${V1.id}&select=anulado_en`)).body?.[0]?.anulado_en)

  // Se saca del medio la orden buena —anulándola, que es la vía que existe— y
  // ahora sí se puede restaurar la original.
  const buena = creados[creados.length - 1]
  await rpc(admin, 'taller_anular_vehiculo',
    { p_vehiculo: buena, p_motivo: 'Prueba: se libera la patente' })

  const r = await rpc(admin, 'taller_restaurar_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'Se anuló el que no era' })
  check('sin conflicto, restaura', r.ok, JSON.stringify(r.body))

  const { body: d } = await rest(admin,
    `vehiculo?id=eq.${V1.id}&select=anulado_en,anulado_por,anulado_motivo,etapa`)
  check('se levanta la marca completa',
        d?.[0]?.anulado_en === null && d?.[0]?.anulado_por === null
        && d?.[0]?.anulado_motivo === null, JSON.stringify(d?.[0]))
  check('y vuelve a la etapa donde estaba', d?.[0]?.etapa === 'recepcion', d?.[0]?.etapa)

  const { body: ev } = await rest(admin,
    `vehiculo_evento?vehiculo_id=eq.${V1.id}&tipo=eq.restauracion_vehiculo&select=texto,autor_id`)
  check('con su propio movimiento de auditoría', ev?.length === 1, JSON.stringify(ev))
  check('con el motivo', /el que no era/.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)
  check('y con autor', !!ev?.[0]?.autor_id)

  const otra = await rpc(admin, 'taller_restaurar_vehiculo',
    { p_vehiculo: V1.id, p_motivo: 'de nuevo' })
  check('no se restaura algo que no está anulado', !otra.ok)

  // Y ya restaurado, vuelve a moverse normalmente.
  const av = await rpc(coordinador, 'taller_validar_avance', { p_vehiculo: V1.id })
  check('restaurado, avanza como siempre', av.ok && av.body === 'chapa', JSON.stringify(av.body))
}

// ── 10. Con facturación y adjuntos: no se pierde nada ────────────
console.log(`${BR}10. SE ANULA CON PLATA Y PAPELES, Y NO SE PIERDE NADA`)
{
  const V2 = await nuevo(`B${marca}`); creados.push(V2.id)

  await rpc(admin, 'taller_registrar_monto',
    { p_vehiculo: V2.id, p_rubro: 'compania', p_monto: 123456 })
  await rpc(admin, 'taller_registrar_facturacion',
    { p_vehiculo: V2.id, p_rubro: 'compania', p_estado: 'facturado' })

  const ruta = `${EMPRESA_A}/${V2.id}/factura-${marca}-anul.pdf`
  await subir(admin, ruta, '%PDF-1.4')
  await rest(admin, 'vehiculo_archivo', {
    method: 'POST',
    body: JSON.stringify({ vehiculo_id: V2.id, tipo: 'factura', path: ruta, nombre: 'factura.pdf' }),
  })
  await rest(admin, 'vehiculo_evento', {
    method: 'POST',
    body: JSON.stringify({ vehiculo_id: V2.id, tipo: 'nota', texto: 'Nota previa a la anulación' }),
  })

  const antes = {
    archivos: (await rest(admin, `vehiculo_archivo?vehiculo_id=eq.${V2.id}&select=id`)).body?.length,
    eventos:  (await rest(admin, `vehiculo_evento?vehiculo_id=eq.${V2.id}&select=id`)).body?.length,
    monto:    (await rest(admin, `vehiculo_monto?vehiculo_id=eq.${V2.id}&select=*`)).body?.[0],
  }

  const r = await rpc(admin, 'taller_anular_vehiculo',
    { p_vehiculo: V2.id, p_motivo: 'Se facturó en el auto equivocado' })
  check('se anula aunque tenga facturación cargada', r.ok, JSON.stringify(r.body))

  const despues = {
    archivos: (await rest(admin, `vehiculo_archivo?vehiculo_id=eq.${V2.id}&select=id`)).body?.length,
    eventos:  (await rest(admin, `vehiculo_evento?vehiculo_id=eq.${V2.id}&select=id`)).body?.length,
    monto:    (await rest(admin, `vehiculo_monto?vehiculo_id=eq.${V2.id}&select=*`)).body?.[0],
  }

  check('los adjuntos siguen todos', despues.archivos === antes.archivos,
        `${antes.archivos} → ${despues.archivos}`)
  check('la bitácora no perdió nada (sumó el movimiento de anulación)',
        despues.eventos === antes.eventos + 1, `${antes.eventos} → ${despues.eventos}`)
  check('el importe sigue cargado', Number(despues.monto?.monto_compania) === 123456,
        despues.monto?.monto_compania)
  check('y el estado de facturación también',
        despues.monto?.estado_compania === 'facturado', despues.monto?.estado_compania)

  const { body: nota } = await rest(admin,
    `vehiculo_evento?vehiculo_id=eq.${V2.id}&tipo=eq.nota&select=texto`)
  check('la nota anterior sigue ahí', /previa a la anulación/.test(nota?.[0]?.texto || ''))
}

// ── 11. Aislamiento entre empresas ───────────────────────────────
console.log(`${BR}11. CADA EMPRESA VE SOLO LO SUYO`)
{
  const { body: ajenos } = await rest(otraEmpresa,
    `vehiculo?anulado_en=not.is.null&select=id,empresa_id`)
  check('la empresa B no ve los anulados de A',
        !(ajenos || []).some(x => x.empresa_id === EMPRESA_A),
        JSON.stringify((ajenos || []).map(x => x.empresa_id)))

  const restaurar = await rpc(otraEmpresa, 'taller_restaurar_vehiculo',
    { p_vehiculo: creados[creados.length - 1], p_motivo: 'lo restauro yo' })
  check('ni los restaura', !restaurar.ok)
}

// ── 12. La integración no reporta anulados ───────────────────────
console.log(`${BR}12. LOS REPORTES DE n8n NO VEN ANULADOS`)
if (local) { console.log('  (la integración se prueba solo contra el proyecto autorizado)') }
else {
  const salida = execSync(`supabase projects api-keys --project-ref ${ref}`,
                          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const fila = salida.split(BR).find(l => l.includes('service_role'))
  const SERVICE = (fila.match(/(eyJ[A-Za-z0-9_\-.]+|sb_secret_[A-Za-z0-9_\-]+)/) || [])[1]
  const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

  const crear = await fetch(`${SUPA}/rest/v1/rpc/integracion_crear_clave`, {
    method: 'POST', headers: SH,
    body: JSON.stringify({ p_empresa: EMPRESA_A, p_nombre: `PRUEBA-ANUL-${marca}`, p_dias: 1 }),
  })
  const clave = await crear.json()

  const api = async (query) => {
    const r = await fetch(`${SUPA}/functions/v1/reporte-taller?${query}`, {
      headers: { Authorization: `Bearer ${clave.clave}` } })
    return { status: r.status, body: await r.json() }
  }

  // El V2 del punto 10 quedó anulado, con importe y factura.
  const anuladoPat = `ZZANULB${marca}`

  const veh = await api('recurso=vehiculos&estado=todos&limite=200')
  const patentes = (veh.body?.datos || []).map(x => x.patente)
  check('vehiculos (estado=todos) no incluye el anulado', !patentes.includes(anuladoPat),
        `status ${veh.status}`)

  const fact = await api('recurso=facturacion&estado=todos&limite=200')
  const patFact = (fact.body?.datos || []).map(x => x.patente)
  check('facturacion no incluye el anulado', !patFact.includes(anuladoPat))

  const adj = await api(`recurso=adjuntos&patente=${anuladoPat}`)
  check('adjuntos del anulado no se reportan', (adj.body?.datos || []).length === 0,
        JSON.stringify(adj.body?.datos?.length))

  const mov = await api('recurso=movimientos&limite=200')
  const patMov = (mov.body?.datos || []).map(x => x.patente)
  check('sus movimientos tampoco', !patMov.includes(anuladoPat))

  const res = await api('recurso=resumen')
  check('el resumen devuelve números', typeof res.body?.datos?.activos === 'number',
        JSON.stringify(res.body?.datos))

  // La credencial de prueba se borra, y sus accesos también. El log primero:
  // borrar la clave deja sus filas con api_key_id en null y después no hay
  // forma de distinguirlas, que es justo lo que pruebas-integracion comprueba.
  await fetch(`${SUPA}/rest/v1/integracion_log?api_key_id=eq.${clave.id}`,
              { method: 'DELETE', headers: SH })
  await fetch(`${SUPA}/rest/v1/integracion_api_key?id=eq.${clave.id}`,
              { method: 'DELETE', headers: SH })

  const quedanClaves = await (await fetch(
    `${SUPA}/rest/v1/integracion_api_key?id=eq.${clave.id}&select=id`, { headers: SH })).json()
  check('la credencial de prueba se borró', (quedanClaves || []).length === 0)

  const quedanLogs = await (await fetch(
    `${SUPA}/rest/v1/integracion_log?select=id`, { headers: SH })).json()
  check('y no dejó accesos en el log', (quedanLogs || []).length === 0,
        `quedan ${(quedanLogs || []).length}`)
}

// ── Limpieza ─────────────────────────────────────────────────────
// Los ZZANUL% los borra el seed, igual que el resto de los vehículos de
// prueba: taller.eliminar está reservado a SAU y eso es una prueba en sí misma.
console.log(`${BR}Vehículos de prueba creados (los limpia el seed): ${creados.length}`)

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
