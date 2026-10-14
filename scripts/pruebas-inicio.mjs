/**
 * A dónde entra cada usuario, y qué rutas puede abrir (migración 0049).
 *
 * Lo que fija: que la pantalla de entrada salga de la configuración de la
 * empresa y no de un email; que el fallback de un único módulo funcione; que
 * nadie quede encerrado en una pantalla que no puede usar; y —lo más
 * importante— que nada de esto toque permisos.
 *
 * Las dos primeras partes son función pura: no tocan la base. La tercera lee
 * las empresas reales para comprobar que el reparto es el esperado.
 *
 *   node scripts/pruebas-inicio.mjs
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
console.log(local ? 'Base local' : `Proyecto autorizado: ${ref} (solo lectura)`)

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

const { rutaDeInicio, moduloDeRuta, RUTA_MODULO, PERMISO_MODULO } =
  await import('../src/lib/inicio.js')

// Un "tienePermiso" de mentira, a partir de una lista
const con = (...permisos) => (p) => permisos.includes(p)
const todo = () => true

// ── 1. La configuración manda ─────────────────────────────────────
console.log('\n1. modulo_inicio DECIDE')
{
  const forani = { modulos_activos: ['taller'], modulo_inicio: 'taller' }
  check('una empresa con taller configurado entra al taller',
        rutaDeInicio(forani, todo) === '/taller', rutaDeInicio(forani, todo))

  const multi = { modulos_activos: ['ventas','caja','stock'], modulo_inicio: 'caja' }
  check('una multimódulo con inicio configurado entra ahí',
        rutaDeInicio(multi, todo) === '/caja', rutaDeInicio(multi, todo))

  // Configurado pero sin permiso: no se lo manda a una pantalla que no puede usar
  check('sin permiso del módulo configurado, va al inicio general',
        rutaDeInicio(multi, con('ventas.crear')) === '/',
        rutaDeInicio(multi, con('ventas.crear')))

  // Configurado pero el módulo ya no está activo
  const incoherente = { modulos_activos: ['ventas'], modulo_inicio: 'taller' }
  check('si el módulo configurado ya no está activo, no se usa',
        rutaDeInicio(incoherente, todo) === '/vender', rutaDeInicio(incoherente, todo))
}

// ── 2. El fallback de un solo módulo ──────────────────────────────
console.log('\n2. UN SOLO MÓDULO, SIN CONFIGURAR')
{
  check('solo taller → /taller',
        rutaDeInicio({ modulos_activos: ['taller'] }, todo) === '/taller')
  check('solo presupuestos → /presupuestos',
        rutaDeInicio({ modulos_activos: ['presupuestos'] }, todo) === '/presupuestos')
  check('solo fiado → /fiado',
        rutaDeInicio({ modulos_activos: ['fiado'] }, todo) === '/fiado')

  check('dos módulos → inicio general',
        rutaDeInicio({ modulos_activos: ['ventas','stock'] }, todo) === '/')
  check('ninguno → inicio general',
        rutaDeInicio({ modulos_activos: [] }, todo) === '/')
  check('empresa nula no rompe', rutaDeInicio(null, todo) === '/')
  check('sin permiso del único módulo, inicio general',
        rutaDeInicio({ modulos_activos: ['taller'] }, con('ventas.ver')) === '/')

  // 'agente' no tiene pantalla: no puede ser inicio
  check('un módulo sin ruta no es inicio',
        rutaDeInicio({ modulos_activos: ['agente'] }, todo) === '/')
  check('y si está con otro, manda el que tiene ruta',
        rutaDeInicio({ modulos_activos: ['agente','taller'] }, todo) === '/taller')
}

// ── 3. Qué módulo gobierna cada ruta ──────────────────────────────
console.log('\n3. LA GUARDIA DE NAVEGACIÓN')
{
  check('/taller es del taller',        moduloDeRuta('/taller') === 'taller')
  check('/taller/nuevo también',        moduloDeRuta('/taller/nuevo') === 'taller')
  check('una ficha también',            moduloDeRuta('/taller/abc-123') === 'taller')
  check('/stock es de stock',           moduloDeRuta('/stock') === 'stock')
  check('/caja es de caja',             moduloDeRuta('/caja') === 'caja')
  check('/compras es de compras',       moduloDeRuta('/compras') === 'compras')
  check('/vender es de ventas',         moduloDeRuta('/vender') === 'ventas')
  check('/historial también',           moduloDeRuta('/historial') === 'ventas')

  // Las que no son de ningún módulo quedan abiertas: si no, alguien se queda
  // sin poder llegar a su propio perfil.
  check('/ no es de ningún módulo',       moduloDeRuta('/') === null)
  check('/perfil tampoco',                moduloDeRuta('/perfil') === null)
  check('/contadora tampoco',             moduloDeRuta('/contadora') === null)

  // El prefijo arrastra lo que cuelga: configurar tareas es parte de Equipo.
  check('/equipo es del módulo equipo',   moduloDeRuta('/equipo') === 'equipo')
  check('/equipo/tareas/x también',       moduloDeRuta('/equipo/tareas/x') === 'equipo')

  // Y no se confunde un prefijo con otro
  check('/tallerista no es del taller',   moduloDeRuta('/tallerista') === null)
  check('/stockeo no es de stock',        moduloDeRuta('/stockeo') === null)
}

// ── 4. Coherencia de los mapas ────────────────────────────────────
console.log('\n4. LOS MAPAS NO SE DESINCRONIZAN')
{
  const { MODULOS } = await import('../src/lib/modulos.js')
  const ids = MODULOS.map(m => m.id)
  check('toda ruta de módulo apunta a un módulo que existe',
        Object.keys(RUTA_MODULO).every(m => ids.includes(m)),
        JSON.stringify(Object.keys(RUTA_MODULO).filter(m => !ids.includes(m))))
  check('todo módulo con ruta tiene permiso declarado',
        Object.keys(RUTA_MODULO).every(m => PERMISO_MODULO[m]),
        JSON.stringify(Object.keys(RUTA_MODULO).filter(m => !PERMISO_MODULO[m])))
}

// ── 5. Las empresas reales ────────────────────────────────────────
console.log('\n5. CONTRA LAS EMPRESAS REALES (lectura)')
{
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: local ? 'duena@local.test' : 'taller-a-completo@prueba.sau', password: PASS }) })
  const { access_token } = await r.json()
  const res = await fetch(`${SUPA}/rest/v1/empresa?select=nombre_fantasia,modulos_activos,modulo_inicio`,
    { headers: { apikey: ANON, Authorization: `Bearer ${access_token}` } })
  const empresas = res.ok ? await res.json() : []

  check('se leyó al menos la empresa propia', empresas.length > 0, String(empresas.length))
  for (const e of empresas) {
    const destino = rutaDeInicio(e, todo)
    const esperado = e.modulo_inicio ? RUTA_MODULO[e.modulo_inicio]
      : (e.modulos_activos || []).filter(m => RUTA_MODULO[m]).length === 1
        ? RUTA_MODULO[(e.modulos_activos || []).find(m => RUTA_MODULO[m])]
        : '/'
    check(`${e.nombre_fantasia} → ${destino}`, destino === esperado,
          `esperaba ${esperado}`)
  }
}

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
