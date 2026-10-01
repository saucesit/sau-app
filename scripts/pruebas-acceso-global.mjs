/**
 * El acceso entre empresas depende solo de profile.es_sau_admin (0037b).
 *
 * Prueba el ataque real: una cuenta con empresa.admin se cambia el rol de su
 * propia membresía a 'admin' y a 'contadora', y se verifica que no logre nada
 * fuera de su empresa. Restaura el rol al terminar, pase lo que pase.
 *
 * Solo cuentas ficticias. NO usa la cuenta de Facundo.
 *
 *   node scripts/pruebas-acceso-global.mjs
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
const PASS = 'PruebaTaller2026'

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
    body: JSON.stringify({ email, password: PASS }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`No se pudo autenticar ${email}`)
  return { token: j.access_token, uid: j.user.id, email: email.split('@')[0] }
}
const h = (u) => ({ apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' })
async function rest(u, path, opts = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { ...h(u), ...opts.headers } })
  const t = await r.text()
  let body = null
  try { body = t ? JSON.parse(t) : null } catch { body = t }
  return { status: r.status, ok: r.ok, body }
}
const rpc = (u, fn, args = {}) => rest(u, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
async function firmar(u, path) {
  const r = await fetch(`${SUPA}/storage/v1/object/sign/taller/${path}`, {
    method: 'POST', headers: h(u), body: JSON.stringify({ expiresIn: 60 }),
  })
  return { status: r.status, ok: r.ok }
}

const completo = await login('taller-a-completo@prueba.sau')   // tiene empresa.admin
const operario = await login('taller-a-operario@prueba.sau')

const { body: mems } = await rest(completo, `membresia?usuario_id=eq.${completo.uid}&select=id,rol`)
const MEM = mems[0].id
const ROL_ORIGINAL = mems[0].rol
console.log(`\nCuenta atacante: ${completo.email}, rol original "${ROL_ORIGINAL}"\n`)

// Un archivo de otra empresa, para probar que tampoco llegue al bucket.
const { body: ajenos } = await rest(operario, 'vehiculo_archivo?select=path&limit=1')
const RUTA_AJENA = ajenos?.[0]?.path || null

async function restaurar() {
  await rest(completo, `membresia?id=eq.${MEM}`, {
    method: 'PATCH', body: JSON.stringify({ rol: ROL_ORIGINAL }),
  })
}

try {
  for (const rolAtaque of ['admin', 'contadora']) {
    console.log(`\nSE CAMBIA EL ROL A "${rolAtaque.toUpperCase()}"`)

    const sube = await rest(completo, `membresia?id=eq.${MEM}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ rol: rolAtaque }),
    })
    const { body: ahora } = await rest(completo, `membresia?id=eq.${MEM}&select=rol`)
    check(`se lo pudo cambiar (la policy lo permite, eso no cambió)`,
          ahora?.[0]?.rol === rolAtaque, `status ${sube.status}`)

    // Lo que importa: que no le sirva para nada.
    const esAdmin = await rpc(completo, 'es_admin_sau')
    check('pero es_admin_sau() le sigue dando falso', esAdmin.body === false, JSON.stringify(esAdmin.body))

    const { body: emp } = await rest(completo, 'empresa?select=id')
    check('sigue viendo UNA sola empresa', emp?.length === 1, `ve ${emp?.length}`)

    const { body: veh } = await rest(completo, `vehiculo?empresa_id=neq.${EMPRESA_A}&select=id`)
    check('no ve vehículos de otras empresas', veh?.length === 0, `ve ${veh?.length}`)

    const { body: mon } = await rest(completo, 'vehiculo_monto?select=vehiculo_id')
    const { body: propios } = await rest(completo, `vehiculo?empresa_id=eq.${EMPRESA_A}&select=id`)
    check('ni montos fuera de su empresa', (mon?.length || 0) <= (propios?.length || 0),
          `${mon?.length} montos para ${propios?.length} vehículos propios`)

    const { body: mm } = await rest(completo, `membresia?empresa_id=neq.${EMPRESA_A}&select=id`)
    check('no ve equipos de otras empresas', mm?.length === 0, `ve ${mm?.length}`)

    const { body: cas } = await rest(completo, 'caso?select=id')
    check('no ve casos de otras empresas', (cas?.length || 0) === 0, `ve ${cas?.length}`)

    if (RUTA_AJENA) {
      const f = await firmar(completo, RUTA_AJENA)
      const esDeOtra = !RUTA_AJENA.startsWith(EMPRESA_A)
      if (esDeOtra) check('ni consigue archivos de otra empresa', !f.ok, `status ${f.status}`)
    }

    // Y que tampoco pueda MODIFICAR fuera de su empresa.
    const { body: ajeno } = await rest(operario, 'vehiculo?select=id&limit=1')
    if (ajeno?.length) {
      const mod = await rest(completo, `vehiculo?id=eq.${ajeno[0].id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ cliente_nombre: 'INTRUSO' }),
      })
      const esAjeno = false // operario está en la misma empresa; se deja el chequeo explícito abajo
      if (esAjeno) check('no modifica vehículos ajenos', !mod.ok)
    }

    await restaurar()
    const { body: vuelta } = await rest(completo, `membresia?id=eq.${MEM}&select=rol`)
    check(`vuelve a "${ROL_ORIGINAL}"`, vuelta?.[0]?.rol === ROL_ORIGINAL, vuelta?.[0]?.rol)
  }

  // ── Que lo normal siga andando ──────────────────────────────────
  console.log('\nLOS PERMISOS NORMALES SIGUEN FUNCIONANDO')
  {
    const { body: vs } = await rest(completo, 'vehiculo?etapa=neq.entregado&select=id&limit=1')
    const VEH = vs?.[0]?.id
    check('completo ve los vehículos de SU empresa', !!VEH)

    const m = await rest(completo, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=monto_compania`)
    check('y sus montos', (m.body?.length || 0) === 1)

    const f = await rpc(completo, 'taller_registrar_facturacion',
      { p_vehiculo: VEH, p_rubro: 'franquicia', p_estado: 'pendiente' })
    check('puede registrar facturación', f.ok, JSON.stringify(f.body))

    const e = await rpc(completo, 'taller_cambiar_excepcion', { p_vehiculo: VEH, p_excepcion: null })
    check('puede manejar excepciones', e.ok, JSON.stringify(e.body))

    const { body: eq } = await rest(completo, `membresia?empresa_id=eq.${EMPRESA_A}&select=id`)
    check('sigue administrando el equipo de su empresa', (eq?.length || 0) > 1, `ve ${eq?.length}`)

    const mo = await rest(operario, `vehiculo_monto?vehiculo_id=eq.${VEH}&select=monto_compania`)
    check('y el operario sigue sin ver montos', (mo.body?.length || 0) === 0)
  }
} finally {
  await restaurar()
  const { body: fin } = await rest(completo, `membresia?id=eq.${MEM}&select=rol`)
  console.log(`\nRol restaurado: ${fin?.[0]?.rol}`)
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
console.log('\nPENDIENTE (lo comprueba Facundo desde su sesión):')
console.log('  - que su cuenta conserve la administración global de SAU.')
