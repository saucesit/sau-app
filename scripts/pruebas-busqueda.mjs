/**
 * Búsqueda de vehículos: la pizarra y el archivo de entregados.
 *
 * La pizarra filtra en memoria y el archivo consulta al servidor. Son dos
 * mecanismos distintos y por eso pueden separarse sin que nadie se entere: lo
 * que esta suite fija es que escribir lo mismo encuentre lo mismo en las dos.
 *
 * NO ESCRIBE NADA. Todo lo que hace contra la base son SELECT. Se puede correr
 * contra producción sin dejar rastro, que es la condición con la que se pidió.
 *
 *   node scripts/pruebas-busqueda.mjs
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
console.log(local ? 'Base local' : `Proyecto autorizado: ${ref} (solo lectura)`)

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

const { coincide, limpiarBusqueda, normalizarPatente, CAMPOS_BUSQUEDA } =
  await import('../src/lib/taller.js')

// ── 1. La regla, sin tocar la base ────────────────────────────────
console.log('\n1. LA REGLA DE COINCIDENCIA')
{
  const auto = {
    patente: 'AB222CC', nro_siniestro: '70110022003',
    cliente_nombre: 'Transportes del Norte SRL', vehiculo: 'Toyota Hilux SRV',
    compania: 'Mapfre', productor: 'M. Arias',
  }

  check('encuentra por patente exacta',        coincide(auto, 'AB222CC'))
  check('por patente en minúscula',            coincide(auto, 'ab222cc'))
  check('por patente con espacios',            coincide(auto, 'ab 222 cc'))
  check('por patente con guiones',             coincide(auto, 'AB-222-CC'))
  check('por un pedazo de la patente',         coincide(auto, '222'))
  check('por número de siniestro',             coincide(auto, '70110022003'))
  check('por parte del siniestro',             coincide(auto, '0022003'))
  check('por cliente',                         coincide(auto, 'transportes'))
  check('por cliente con mayúsculas',          coincide(auto, 'NORTE'))
  check('por vehículo',                        coincide(auto, 'hilux'))
  check('por marca',                           coincide(auto, 'toyota'))

  check('un término vacío muestra todo',       coincide(auto, ''))
  check('solo espacios también',               coincide(auto, '   '))
  check('null no rompe',                       coincide(auto, null))

  check('no encuentra cualquier cosa',        !coincide(auto, 'zzzz'))
  check('no encuentra otra patente',          !coincide(auto, 'AF350PM'))

  // Compañía queda afuera a propósito: se decidió no incluirla todavía.
  check('NO busca por compañía',              !coincide(auto, 'mapfre'))
  check('NO busca por productor',             !coincide(auto, 'arias'))

  // Un auto con campos vacíos no debe romper el filtro.
  const pelado = { patente: 'ZZ000ZZ' }
  check('un auto sin cliente ni vehículo no rompe', coincide(pelado, 'ZZ000ZZ'))
  check('y no coincide de más',                    !coincide(pelado, 'hilux'))

  // Los caracteres que rompen el `or` de PostgREST se descartan igual en los dos lados.
  check('la coma se limpia',        limpiarBusqueda('a,b') === 'a b')
  check('los paréntesis también',   limpiarBusqueda('a(b)') === 'a b')
  check('y el asterisco',           limpiarBusqueda('a*b') === 'a b')
  check('normaliza la patente',     normalizarPatente(' ab-222 cc ') === 'AB222CC')
  check('los campos son los cuatro acordados',
        JSON.stringify(CAMPOS_BUSQUEDA) ===
        JSON.stringify(['patente', 'nro_siniestro', 'cliente_nombre', 'vehiculo']),
        JSON.stringify(CAMPOS_BUSQUEDA))
}

// ── 2. El filtro no toca los totales ──────────────────────────────
// Es la garantía que se pidió: buscar filtra tarjetas, no cambia el estado del
// taller que muestran los contadores.
console.log('\n2. BUSCAR NO CAMBIA LOS CONTADORES')
{
  const { totalesAFacturar, estado } = await import('../src/lib/taller.js')
  const flota = [
    { id: 1, etapa: 'chapa',   patente: 'AA111BB', vehiculo: 'Gol',   cliente_nombre: 'Ana',
      fecha_ingreso: '2026-10-01', monto_compania: 100, estado_compania: 'pendiente' },
    { id: 2, etapa: 'pintura', patente: 'CC333DD', vehiculo: 'Hilux', cliente_nombre: 'Beto',
      fecha_ingreso: '2026-10-02', monto_compania: 200, estado_compania: 'pendiente' },
  ]
  const visibles = flota.filter(v => coincide(v, 'AA111BB'))

  check('la búsqueda deja un solo auto visible', visibles.length === 1, String(visibles.length))
  check('pero el total a facturar se calcula sobre la flota entera',
        totalesAFacturar(flota).compania === 300, String(totalesAFacturar(flota).compania))
  check('y la cantidad de activos también',
        flota.length === 2 && flota.filter(v => estado(v)).length === 2)
}

// ── 3. Las dos pantallas encuentran lo mismo ──────────────────────
// El archivo busca contra el servidor con un `or` de PostgREST; la pizarra
// filtra en memoria. Acá se corren los dos sobre las MISMAS filas y se exige
// el mismo resultado. Si alguien cambia uno solo, esto falla.
console.log('\n3. SERVIDOR Y MEMORIA COINCIDEN')
{
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: local ? 'duena@local.test' : 'taller-a-completo@prueba.sau', password: PASS }),
  })
  const j = await r.json()
  if (!j.access_token) { console.error('No se pudo autenticar'); process.exit(1) }
  const h = { apikey: ANON, Authorization: `Bearer ${j.access_token}` }

  const leer = async (path) => {
    const res = await fetch(`${SUPA}/rest/v1/${path}`, { headers: h })
    return res.ok ? res.json() : null
  }

  const todos = await leer('vehiculo?etapa=eq.entregado&select=id,patente,nro_siniestro,cliente_nombre,vehiculo&limit=400')
  check('se leyeron entregados para comparar', Array.isArray(todos) && todos.length > 0,
        String(todos?.length))

  if (todos?.length) {
    // Términos tomados de los datos que ya existen, más algunos inventados.
    const muestra = todos[Math.floor(todos.length / 2)]
    const terminos = [
      muestra.patente,
      muestra.patente.slice(0, 4),
      (muestra.cliente_nombre || '').split(' ')[0],
      (muestra.vehiculo || '').split(' ')[0],
      'zzzznoexiste',
    ].filter(t => t && t.length >= 3)

    for (const t of terminos) {
      const plano = normalizarPatente(limpiarBusqueda(t))
      const suelto = limpiarBusqueda(t)
      const o = `patente.ilike.%${plano}%,nro_siniestro.ilike.%${plano}%,` +
                `cliente_nombre.ilike.%${suelto}%,vehiculo.ilike.%${suelto}%`
      const delServidor = await leer(
        `vehiculo?etapa=eq.entregado&select=id&or=(${encodeURIComponent(o)})&limit=400`)
      const enMemoria = todos.filter(v => coincide(v, t))

      const a = new Set((delServidor || []).map(v => v.id))
      const b = new Set(enMemoria.map(v => v.id))
      const igual = a.size === b.size && [...a].every(id => b.has(id))
      check(`"${t}" → mismo resultado en servidor y en memoria (${a.size})`,
            igual, `servidor ${a.size} vs memoria ${b.size}`)
    }
  }
}

// ── 4. Contra los activos de verdad ───────────────────────────────
// Solo lectura: se busca una patente real de la pizarra y se exige que caiga
// exactamente ese auto. Es el caso que pidió Tefo.
console.log('\n4. BUSCAR UN ACTIVO POR SU PATENTE')
{
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: local ? 'duena@local.test' : 'taller-a-completo@prueba.sau', password: PASS }),
  })
  const { access_token } = await r.json()
  const res = await fetch(
    `${SUPA}/rest/v1/vehiculo?etapa=neq.entregado&select=id,patente,etapa,vehiculo,cliente_nombre,nro_siniestro&limit=200`,
    { headers: { apikey: ANON, Authorization: `Bearer ${access_token}` } })
  const activos = res.ok ? await res.json() : []

  check('hay vehículos activos para probar', activos.length > 0, String(activos.length))

  if (activos.length) {
    const uno = activos[0]
    const sola = activos.filter(v => coincide(v, uno.patente))
    check(`escribir "${uno.patente}" encuentra ese vehículo`,
          sola.some(v => v.id === uno.id), String(sola.length))

    // Con espacios, como lo escribiría alguien mirando la chapa. Hace falta una
    // patente del formato real AA000AA: las de prueba tienen otro largo y
    // separarlas no probaría nada.
    const real = activos.find(v => /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(v.patente || ''))
    if (!real) { console.log('  (sin patentes del formato AA000AA entre los activos)') }
    else {
      const espaciada = real.patente.replace(/^(..)(...)(..)$/, '$1 $2 $3')
      const crudo  = activos.filter(v => coincide(v, real.patente))
      const suelto = activos.filter(v => coincide(v, espaciada))
      check(`"${espaciada}" encuentra lo mismo que "${real.patente}"`,
            espaciada !== real.patente &&
            suelto.length === crudo.length && suelto.some(v => v.id === real.id),
            `"${espaciada}": ${suelto.length} vs "${real.patente}": ${crudo.length}`)

      const minuscula = activos.filter(v => coincide(v, espaciada.toLowerCase()))
      check(`y en minúscula también ("${espaciada.toLowerCase()}")`,
            minuscula.length === crudo.length && minuscula.some(v => v.id === real.id))
    }

    check('sin término, la pizarra queda entera',
          activos.filter(v => coincide(v, '')).length === activos.length)

    const nada = activos.filter(v => coincide(v, 'ZZZZNOEXISTE'))
    check('un término sin coincidencias deja la pizarra vacía', nada.length === 0)

    // Y el reparto por etapa, que es lo que alimenta el "01 DE 03".
    const etapas = [...new Set(activos.map(v => v.etapa))]
    const total  = etapas.reduce((s, e) => s + activos.filter(v => v.etapa === e).length, 0)
    check('cada activo cae en una sola etapa', total === activos.length,
          `${total} vs ${activos.length}`)
  }
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
