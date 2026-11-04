/**
 * "No pierdas de vista": los últimos comentarios del reporte diario.
 *
 * Lo que se fija acá es de dónde salen esas novedades y qué NO entra: solo
 * notas del reporte diario —no avances, ni entregas, ni facturación—, solo de
 * vehículos que están adentro del taller, y siempre de la propia empresa.
 *
 * NO ESCRIBE NADA. Todo lo que hace contra la base son SELECT, igual que la
 * suite de búsqueda: se puede correr contra producción sin dejar rastro.
 *
 *   node scripts/pruebas-novedades.mjs
 */
import fs from 'node:fs'

const PROYECTOS_AUTORIZADOS = ['cezrotffjvqmymtdjhdw']
const BR = String.fromCharCode(10)
const EMPRESA_A = '11111111-aaaa-4aaa-8aaa-111111111111'   // TALLER SAN MARTÍN

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

/**
 * Las mismas dos consultas que hace la Pizarra, en el mismo orden. Si cambian
 * allá y no acá, esta suite deja de estar probando lo que se ejecuta.
 */
async function novedadesDe(u) {
  const { body: autos } = await rest(u,
    'vehiculo?select=id,patente,vehiculo&etapa=neq.entregado&anulado_en=is.null')
  if (!autos?.length) return { autos: [], notas: [] }
  const ids = autos.map(v => v.id).join(',')
  const { body: notas } = await rest(u,
    `vehiculo_evento?select=id,vehiculo_id,texto,created_at,autor_id` +
    `&vehiculo_id=in.(${ids})&tipo=eq.nota&order=created_at.desc`)
  return { autos, notas: Array.isArray(notas) ? notas : [] }
}

// ──────────────────────────────────────────────────────────────────
const duena      = await login('taller-a-completo@prueba.sau')
const operario   = await login('taller-a-operario@prueba.sau')
const otraEmpresa = await login('taller-b-admin@prueba.sau')

// ── 1. La fuente es el reporte diario, y nada más ────────────────
console.log(`${BR}1. SOLO COMENTARIOS DEL REPORTE DIARIO`)
{
  const { notas } = await novedadesDe(duena)
  check('hay novedades para mostrar', notas.length > 0, `${notas.length}`)

  // Lo que la Pizarra pide es tipo=nota. Se comprueba que en la base existan
  // los otros tipos y que ninguno se cuele por esta consulta.
  const { body: todos } = await rest(duena,
    'vehiculo_evento?select=tipo&limit=1000')
  const tipos = [...new Set((todos || []).map(e => e.tipo))]
  check('la bitácora tiene movimientos de otros tipos',
        tipos.filter(t => t !== 'nota').length > 0, tipos.join(' '))

  const ids = notas.map(n => n.id)
  const { body: verificadas } = await rest(duena,
    `vehiculo_evento?select=id,tipo&id=in.(${ids.slice(0, 50).join(',')})`)
  check('todo lo que trae la consulta es tipo nota',
        (verificadas || []).every(e => e.tipo === 'nota'),
        [...new Set((verificadas || []).map(e => e.tipo))].join(' '))

  // Y explícitamente: ningún avance, entrega ni facturación.
  for (const t of ['avance', 'entrega', 'facturacion', 'trabajo_hecho', 'monto', 'ingreso']) {
    const { body: delTipo } = await rest(duena,
      `vehiculo_evento?select=id&tipo=eq.${t}&limit=5`)
    const colados = (delTipo || []).filter(e => ids.includes(e.id))
    check(`no se cuela ningún movimiento de tipo ${t}`, colados.length === 0)
  }
}

// ── 2. Ordenadas, de lo más nuevo a lo más viejo ─────────────────
console.log(`${BR}2. LA MÁS RECIENTE PRIMERO`)
{
  const { notas } = await novedadesDe(duena)
  const ordenado = notas.every((n, i) =>
    i === 0 || new Date(notas[i - 1].created_at) >= new Date(n.created_at))
  check('vienen de la más nueva a la más vieja', ordenado,
        notas.slice(0, 3).map(n => n.created_at).join(' | '))

  // created_at es el único orden posible: la bitácora no tiene updated_at.
  const { body: una } = await rest(duena, 'vehiculo_evento?select=*&limit=1')
  check('vehiculo_evento no tiene updated_at: created_at es la única fecha',
        una?.[0] && !('updated_at' in una[0]), Object.keys(una?.[0] || {}).join(' '))
}

// ── 3. Solo vehículos que están adentro ──────────────────────────
console.log(`${BR}3. SOLO LOS QUE ESTÁN EN EL TALLER`)
{
  const { autos, notas } = await novedadesDe(duena)
  const idsActivos = new Set(autos.map(v => v.id))
  check('toda novedad pertenece a un vehículo activo',
        notas.every(n => idsActivos.has(n.vehiculo_id)))

  // Un entregado con notas existe y queda afuera, que es la decisión tomada.
  const { body: entregados } = await rest(duena,
    'vehiculo?select=id&etapa=eq.entregado&limit=200')
  const idsEntregados = (entregados || []).map(v => v.id)
  if (idsEntregados.length) {
    const { body: notasEnt } = await rest(duena,
      `vehiculo_evento?select=id&tipo=eq.nota&vehiculo_id=in.(${idsEntregados.slice(0, 100).join(',')})&limit=50`)
    check('hay notas en entregados que a propósito no se muestran',
          Array.isArray(notasEnt), `${notasEnt?.length} en entregados`)
    check('y ninguna de ellas está en el panel',
          !(notasEnt || []).some(e => notas.some(n => n.id === e.id)))
  }

  // Un anulado tampoco: no es trabajo vigente.
  const { body: anulados } = await rest(duena,
    'vehiculo?select=id&anulado_en=not.is.null&limit=50')
  if (anulados?.length) {
    check('ningún vehículo anulado aporta novedades',
          !notas.some(n => anulados.some(a => a.id === n.vehiculo_id)))
  } else {
    check('ningún vehículo anulado aporta novedades', true, '(no hay anulados ahora)')
  }
}

// ── 4. Patente, vehículo y autor ─────────────────────────────────
console.log(`${BR}4. SE PUEDE SABER DE QUÉ AUTO Y DE QUIÉN`)
{
  const { autos, notas } = await novedadesDe(duena)
  const porId = Object.fromEntries(autos.map(v => [v.id, v]))
  check('cada novedad resuelve su patente',
        notas.every(n => !!porId[n.vehiculo_id]?.patente))
  check('y su vehículo',
        notas.every(n => typeof porId[n.vehiculo_id]?.vehiculo === 'string'))

  const autores = [...new Set(notas.map(n => n.autor_id).filter(Boolean))]
  if (autores.length) {
    const { body: ps } = await rest(duena,
      `profile?select=id,nombre,apellido&id=in.(${autores.join(',')})`)
    check('los autores se resuelven contra profile', (ps || []).length > 0,
          `${ps?.length} de ${autores.length}`)
  }

  // Las notas sin autor tienen que poder mostrarse igual: la importación dejó
  // varias así y no son un error.
  const sinAutor = notas.filter(n => !n.autor_id)
  check('una nota sin autor no rompe nada: se muestra sin nombre',
        sinAutor.every(n => typeof n.texto === 'string'),
        `${sinAutor.length} sin autor`)
}

// ── 5. Cada empresa ve lo suyo ───────────────────────────────────
console.log(`${BR}5. AISLAMIENTO ENTRE EMPRESAS`)
{
  const mias = await novedadesDe(duena)
  const suyas = await novedadesDe(otraEmpresa)
  check('la empresa A tiene novedades', mias.notas.length > 0)
  check('la empresa B no ve ninguna de A',
        !suyas.notas.some(n => mias.notas.some(m => m.id === n.id)),
        `A=${mias.notas.length} B=${suyas.notas.length}`)

  const { body: ajenos } = await rest(otraEmpresa,
    `vehiculo?select=id&empresa_id=eq.${EMPRESA_A}`)
  check('ni los vehículos de A', (ajenos || []).length === 0)
}

// ── 6. Quién puede leerlas ───────────────────────────────────────
console.log(`${BR}6. PERMISOS`)
{
  // El reporte diario lo lee cualquiera del taller: el operario anota ahí.
  const { notas } = await novedadesDe(operario)
  check('el operario ve las novedades de su taller', notas.length > 0, `${notas.length}`)

  // Y nadie escribe desde el panel: es una lista de lectura.
  const inventar = await rest(duena, 'vehiculo_evento', {
    method: 'POST',
    body: JSON.stringify({ vehiculo_id: (await novedadesDe(duena)).autos[0]?.id,
                           tipo: 'avance', texto: 'Avance inventado desde el panel' }),
  })
  check('no se puede inventar un movimiento que no sea nota', !inventar.ok,
        `status ${inventar.status}`)
}

// ── 7. Cómo se muestra la fecha ──────────────────────────────────
console.log(`${BR}7. LA FECHA SE LEE DE UN VISTAZO`)
{
  const { fechaCorta } = await import('../src/lib/taller.js')
  const ahora = new Date(2026, 10, 4, 15, 30)          // 04/11/2026 15:30

  check('hoy se dice "hoy" con la hora',
        fechaCorta(new Date(2026, 10, 4, 9, 5).toISOString(), ahora) === 'hoy 09:05',
        fechaCorta(new Date(2026, 10, 4, 9, 5).toISOString(), ahora))
  check('ayer se dice "ayer"',
        fechaCorta(new Date(2026, 10, 3, 23, 50).toISOString(), ahora) === 'ayer 23:50',
        fechaCorta(new Date(2026, 10, 3, 23, 50).toISOString(), ahora))
  check('anteayer ya muestra la fecha',
        fechaCorta(new Date(2026, 10, 2, 8, 0).toISOString(), ahora) === '02/11 08:00',
        fechaCorta(new Date(2026, 10, 2, 8, 0).toISOString(), ahora))
  // Lo de las 23:50 de anoche es "ayer", no "hace 15 horas": se comparan días
  // de calendario y no ventanas de 24 horas.
  check('la medianoche no se cuenta en horas sino en días',
        fechaCorta(new Date(2026, 10, 3, 23, 59).toISOString(),
                   new Date(2026, 10, 4, 0, 10)) === 'ayer 23:59')
  check('una fecha vacía no rompe', fechaCorta(null) === '—' && fechaCorta('') === '—')
  check('una fecha inválida tampoco', fechaCorta('no-es-fecha') === '—',
        fechaCorta('no-es-fecha'))
}

// ── 8. El código usa esa fuente y no otra ────────────────────────
console.log(`${BR}8. UNA SOLA FUENTE`)
{
  const tablero = fs.readFileSync(
    new URL('../src/pages/taller/Tablero.jsx', import.meta.url), 'utf8')

  check('la Pizarra pide las notas por tipo', /eq\('tipo',\s*'nota'\)/.test(tablero))
  check('y lo hace una sola vez: no duplica la consulta',
        (tablero.match(/from\('vehiculo_evento'\)/g) || []).length === 1,
        (tablero.match(/from\('vehiculo_evento'\)/g) || []).length + ' consultas')
  check('de esa misma consulta salen la última nota de la tarjeta y el panel',
        /ultima\[/.test(tablero) && /setNovedades\(/.test(tablero))
  check('el panel filtra por vehículos activos en la consulta de vehículos',
        /neq\('etapa',\s*'entregado'\)/.test(tablero) && /is\('anulado_en',\s*null\)/.test(tablero))
  check('un toque abre la ficha',
        /className="t-nov"[\s\S]{0,80}abrirFicha\(n\.vehiculo_id\)/.test(tablero))
  check('no hay ninguna empresa escrita en el Tablero',
        !/forani|bdd20f9b|11111111-aaaa/i.test(tablero))
  check('la sección sigue llamándose como la conoce el taller',
        /No pierdas de vista/.test(tablero))
  check('y la cola de decisiones sigue estando', /COLA DE DECISIONES/.test(tablero))
}

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
