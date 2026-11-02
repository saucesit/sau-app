/**
 * SAU IA: las herramientas y el guard del chat del taller (0053 + chat-taller).
 *
 * Lo que se prueba acá es TODO lo que tiene respuesta determinista: qué puede
 * consultar cada herramienta, qué devuelve cuando no hay datos, y sobre todo
 * qué NO puede hacer. Lo que conteste Claude con esos datos se revisa a mano:
 * no tiene asserts y no tiene por qué tenerlos.
 *
 * Las herramientas corren adentro de la Edge Function, así que acá se prueban
 * por el mismo camino que usan: consultas con el JWT del usuario, donde la RLS
 * es la que decide. Si una consulta pasa acá con un usuario, pasa igual
 * adentro de la función con ese usuario.
 *
 * Escribe únicamente sobre TALLER SAN MARTÍN. Los vehículos ZZIA los crea
 * scripts/seed-chat-ia.sql y los borra el seed general.
 *
 *   node scripts/pruebas-chat-ia.mjs
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
const rpc = (u, fn, args) => rest(u, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

/** Llama a la Edge Function como la llamaría el navegador. */
async function chat(u, cuerpo) {
  const r = await fetch(`${SUPA}/functions/v1/chat-taller`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const t = await r.text()
  let body = null
  try { body = t ? JSON.parse(t) : null } catch { body = t }
  return { status: r.status, body }
}

/* Las mismas consultas que arman las herramientas, con el cliente del
 * usuario. Si cambian en tools-taller.ts hay que cambiarlas acá. */
const CAMPOS = 'patente, vehiculo, cliente_nombre, compania, productor, etapa, ' +
               'fecha_ingreso, fecha_entrega, excepcion, anulado_en'

async function buscar(u, { texto, desde, hasta, etapa, compania, productor, excepcion,
                           incluirEntregados = true, limite = 50 } = {}) {
  let q = `vehiculo?select=${encodeURIComponent(CAMPOS)}&anulado_en=is.null`
  if (texto) {
    const plano = texto.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    q += `&or=(vehiculo.ilike.*${texto}*,cliente_nombre.ilike.*${texto}*,patente.ilike.*${plano}*)`
  }
  if (desde) q += `&fecha_ingreso=gte.${desde}`
  if (hasta) q += `&fecha_ingreso=lte.${hasta}`
  if (etapa) q += `&etapa=eq.${etapa}`
  if (excepcion) q += `&excepcion=eq.${excepcion}`
  if (compania) q += `&compania=ilike.*${compania}*`
  if (productor) q += `&productor=ilike.*${productor}*`
  if (!incluirEntregados) q += `&etapa=neq.entregado`
  q += `&order=fecha_ingreso.desc&limit=${limite + 1}`
  const r = await rest(u, q)
  return { ...r, filas: Array.isArray(r.body) ? r.body : [] }
}

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)

// ──────────────────────────────────────────────────────────────────
const admin       = await login('taller-a-completo@prueba.sau')       // el habilitado
const sinMontos   = await login('taller-a-coordinador@prueba.sau')    // sin taller.montos
const operario    = await login('taller-a-operario@prueba.sau')
const otraEmpresa = await login('taller-b-admin@prueba.sau')          // empresa B

// ── 1. El guard: solo un usuario y una empresa ───────────────────
console.log(`${BR}1. EL GUARD DEL EXPERIMENTO`)
{
  const sin = await chat({ token: 'inventado' }, { pregunta: 'hola' })
  check('sin un JWT válido no se entra', sin.status === 401, `status ${sin.status}`)

  const noAutorizado = await chat(sinMontos, { pregunta: '¿Cuántos autos hay?' })
  check('un usuario de la misma empresa pero no habilitado → 403',
        noAutorizado.status === 403, `status ${noAutorizado.status}`)
  check('y el mensaje explica que está en prueba',
        /prueba/i.test(noAutorizado.body?.error || ''), noAutorizado.body?.error)

  const op = await chat(operario, { pregunta: '¿Cuántos autos hay?' })
  check('el operario tampoco entra', op.status === 403)

  const otra = await chat(otraEmpresa, { pregunta: '¿Cuántos autos hay?' })
  check('un admin de otra empresa tampoco', otra.status === 403, `status ${otra.status}`)

  const vacia = await chat(admin, { pregunta: '   ' })
  check('el habilitado sí entra, y una pregunta vacía se rechaza con 400',
        vacia.status === 400, `status ${vacia.status}`)

  const larga = await chat(admin, { pregunta: 'a'.repeat(2100) })
  check('una pregunta desmedida se rechaza', larga.status === 400)

  const get = await fetch(`${SUPA}/functions/v1/chat-taller`, {
    method: 'GET', headers: { Authorization: `Bearer ${admin.token}` } })
  check('solo acepta POST', get.status === 405, `status ${get.status}`)
}

// ── 2. buscar_vehiculos ──────────────────────────────────────────
console.log(`${BR}2. BUSCAR VEHÍCULOS`)
{
  // Se afirma la regla, no la cantidad: la empresa de prueba acumula autos de
  // corridas anteriores y una cuenta exacta se rompe sola la semana que viene.
  const amarok = await buscar(admin, { texto: 'Amarok' })
  check('encuentra las tres Amarok del seed',
        ['ZZIA001', 'ZZIA002', 'ZZIA003'].every(p => amarok.filas.some(v => v.patente === p)),
        JSON.stringify(amarok.filas.map(v => v.patente)))
  check('y todo lo que devuelve es realmente una Amarok',
        amarok.filas.every(v => /amarok/i.test(v.vehiculo + ' ' + v.cliente_nombre)),
        JSON.stringify(amarok.filas.map(v => v.vehiculo)))
  check('no se cuela ninguna Hilux en la búsqueda de Amarok',
        !amarok.filas.some(v => /hilux/i.test(v.vehiculo)))

  const hilux = await buscar(admin, { texto: 'Hilux' })
  check('encuentra Hilux y distingue del resto', hilux.filas.length >= 2
        && hilux.filas.every(v => /hilux/i.test(v.vehiculo)),
        JSON.stringify(hilux.filas.map(v => v.vehiculo)))

  // Rango de fechas: ZZIA001 ingresó hace 400 días, a propósito.
  const seisMeses = await buscar(admin, { texto: 'Amarok', desde: hace(180) })
  check('el filtro de fechas deja afuera la Amarok de hace 400 días',
        !seisMeses.filas.some(v => v.patente === 'ZZIA001'),
        JSON.stringify(seisMeses.filas.map(v => v.patente)))
  check('y deja adentro las dos recientes',
        ['ZZIA002', 'ZZIA003'].every(p => seisMeses.filas.some(v => v.patente === p)))
  check('ninguna de las devueltas ingresó antes del corte',
        seisMeses.filas.every(v => v.fecha_ingreso >= hace(180)),
        JSON.stringify(seisMeses.filas.map(v => v.fecha_ingreso)))

  const rango = await buscar(admin, { texto: 'Amarok', desde: hace(120), hasta: hace(30) })
  check('un rango cerrado respeta los dos extremos',
        rango.filas.every(v => v.fecha_ingreso >= hace(120) && v.fecha_ingreso <= hace(30)),
        JSON.stringify(rango.filas.map(v => v.fecha_ingreso)))
  check('y adentro del rango está la que corresponde',
        rango.filas.some(v => v.patente === 'ZZIA002'),
        JSON.stringify(rango.filas.map(v => v.patente)))

  const porEtapa = await buscar(admin, { texto: 'ZZIA', etapa: 'pintura' })
  check('filtra por etapa', porEtapa.filas.every(v => v.etapa === 'pintura')
        && porEtapa.filas.some(v => v.patente === 'ZZIA003'))

  const porCompania = await buscar(admin, { texto: 'ZZIA', compania: 'Zurich' })
  check('filtra por compañía', porCompania.filas.length === 4
        && porCompania.filas.every(v => v.compania === 'Zurich'),
        JSON.stringify(porCompania.filas.map(v => v.patente)))

  const porProductor = await buscar(admin, { texto: 'ZZIA', productor: 'Pérez' })
  check('filtra por productor', porProductor.filas.length === 4,
        JSON.stringify(porProductor.filas.map(v => v.patente)))

  const detenidos = await buscar(admin, { texto: 'ZZIA', excepcion: 'detenido' })
  check('filtra por excepción', detenidos.filas.some(v => v.patente === 'ZZIA010'))

  const soloAdentro = await buscar(admin, { texto: 'Amarok', incluirEntregados: false })
  check('se puede excluir a los entregados',
        soloAdentro.filas.length > 0 && soloAdentro.filas.every(v => v.etapa !== 'entregado'),
        JSON.stringify(soloAdentro.filas.map(v => v.etapa)))
  check('y la Amarok que está en pintura sigue apareciendo',
        soloAdentro.filas.some(v => v.patente === 'ZZIA003'))

  const nada = await buscar(admin, { texto: 'Lamborghini' })
  check('cero resultados devuelve cero, no un error', nada.ok && nada.filas.length === 0)

  const tope = await buscar(admin, { limite: 5 })
  check('respeta el límite y permite detectar que hay más',
        tope.filas.length === 6, `${tope.filas.length}`)

  // Un anulado no aparece nunca. Se afirma sobre el resultado y no sobre una
  // patente puntual: la misma patente puede tener una orden anulada y otra
  // viva, y en ese caso lo correcto es que aparezca solo la viva.
  const anchas = await buscar(admin, { limite: 50 })
  check('ninguna búsqueda devuelve un ingreso anulado',
        anchas.filas.every(v => v.anulado_en === null),
        JSON.stringify(anchas.filas.filter(v => v.anulado_en).map(v => v.patente)))

  const { body: anulados } = await rest(admin,
    `vehiculo?empresa_id=eq.${EMPRESA_A}&anulado_en=not.is.null&select=patente&limit=1`)
  if (anulados?.length) {
    const r = await buscar(admin, { texto: anulados[0].patente })
    check('buscando la patente de uno anulado, no vuelve la orden anulada',
          r.filas.every(v => v.anulado_en === null),
          JSON.stringify(r.filas.map(v => [v.patente, v.anulado_en])))
  } else {
    check('buscando la patente de uno anulado, no vuelve la orden anulada',
          true, '(no hay anulados en este momento)')
  }
}

// ── 3. contar_por ────────────────────────────────────────────────
console.log(`${BR}3. CONTAR POR (la agregación la hace Postgres)`)
{
  const porCompania = await rpc(admin, 'taller_ia_contar_por', { p_campo: 'compania' })
  check('agrupa por compañía', porCompania.ok && porCompania.body.length > 0,
        JSON.stringify(porCompania.body?.slice(0, 3)))
  check('viene ordenado de mayor a menor',
        porCompania.body.every((g, i, a) => i === 0 || a[i - 1].cantidad >= g.cantidad))

  const porProductor = await rpc(admin, 'taller_ia_contar_por', { p_campo: 'productor' })
  const perez = porProductor.body?.find(g => /Pérez/.test(g.valor))
  const gomez = porProductor.body?.find(g => /Gómez/.test(g.valor))
  check('agrupa por productor con los del seed (Pérez 4, Gómez 4)',
        Number(perez?.cantidad) === 4 && Number(gomez?.cantidad) === 4,
        JSON.stringify({ perez, gomez }))
  check('los vehículos sin productor caen en "(sin dato)"',
        porProductor.body.some(g => g.valor === '(sin dato)'))

  const porModelo = await rpc(admin, 'taller_ia_contar_por',
    { p_campo: 'vehiculo', p_desde: hace(180) })
  check('agrupa por modelo con rango de fechas', porModelo.ok && porModelo.body.length > 0)

  const porEtapa = await rpc(admin, 'taller_ia_contar_por',
    { p_campo: 'etapa', p_incluir_entregados: false })
  check('excluyendo entregados, no aparece la etapa entregado',
        !porEtapa.body.some(g => g.valor === 'entregado'),
        JSON.stringify(porEtapa.body?.map(g => g.valor)))

  // Lo que no se puede agrupar, no se agrupa.
  const prohibido = await rpc(admin, 'taller_ia_contar_por', { p_campo: 'cliente_nombre' })
  check('un campo fuera de la lista devuelve vacío, no datos',
        prohibido.ok && prohibido.body.length === 0, JSON.stringify(prohibido.body))

  const inyeccion = await rpc(admin, 'taller_ia_contar_por',
    { p_campo: "patente from vehiculo; drop table vehiculo--" })
  check('no hay forma de inyectar un campo', inyeccion.ok && inyeccion.body.length === 0)

  const { body: siguenLosVehiculos } = await rest(admin, `vehiculo?select=id&limit=1`)
  check('y la tabla sigue entera', Array.isArray(siguenLosVehiculos))

  // Rango sin datos.
  const futuro = await rpc(admin, 'taller_ia_contar_por',
    { p_campo: 'compania', p_desde: '2099-01-01' })
  check('un período sin vehículos devuelve cero grupos', futuro.ok && futuro.body.length === 0)
}

// ── 4. Aislamiento entre empresas ────────────────────────────────
console.log(`${BR}4. CADA EMPRESA CUENTA LO SUYO`)
{
  // Misma función, otro usuario: la RLS hace todo el trabajo.
  const mio   = await rpc(admin,       'taller_ia_contar_por', { p_campo: 'compania' })
  const ajeno = await rpc(otraEmpresa, 'taller_ia_contar_por', { p_campo: 'compania' })
  const totalMio   = mio.body.reduce((s, g) => s + Number(g.cantidad), 0)
  const totalAjeno = (ajeno.body || []).reduce((s, g) => s + Number(g.cantidad), 0)
  check('el admin de A cuenta vehículos', totalMio > 0, `${totalMio}`)
  check('el admin de B NO cuenta los de A', totalAjeno < totalMio, `B=${totalAjeno} A=${totalMio}`)

  const busca = await buscar(otraEmpresa, { texto: 'Amarok' })
  check('la empresa B no encuentra las Amarok de A', busca.filas.length === 0,
        JSON.stringify(busca.filas.map(v => v.patente)))

  const detalle = await rest(otraEmpresa, `vehiculo?patente=eq.ZZIA003&select=patente`)
  check('ni abriendo la patente exacta', (detalle.body || []).length === 0)
}

// ── 5. detalle_vehiculo y los importes ───────────────────────────
console.log(`${BR}5. DETALLE, Y LA PLATA SOLO PARA QUIEN LA VE`)
{
  const { body: v } = await rest(admin, `vehiculo?patente=eq.ZZIA003&select=id,patente,vehiculo`)
  check('encuentra el vehículo por patente', v?.length === 1, JSON.stringify(v))
  const id = v[0].id

  await rpc(admin, 'taller_registrar_monto',
    { p_vehiculo: id, p_rubro: 'compania', p_monto: 555000 })

  const conMontos = await rest(admin, `vehiculo_monto?vehiculo_id=eq.${id}&select=monto_compania`)
  check('quien tiene taller.montos ve el importe',
        Number(conMontos.body?.[0]?.monto_compania) === 555000,
        JSON.stringify(conMontos.body))

  const sinPermiso = await rest(sinMontos, `vehiculo_monto?vehiculo_id=eq.${id}&select=monto_compania`)
  check('quien NO tiene taller.montos recibe cero filas, no un cero',
        Array.isArray(sinPermiso.body) && sinPermiso.body.length === 0,
        JSON.stringify(sinPermiso.body))
  check('pero sí ve el vehículo',
        (await rest(sinMontos, `vehiculo?patente=eq.ZZIA003&select=patente`)).body?.length === 1)

  const inexistente = await rest(admin, `vehiculo?patente=eq.NOEXISTE1&select=patente`)
  check('una patente inexistente devuelve vacío', (inexistente.body || []).length === 0)
}

// ── 6. movimientos_de ────────────────────────────────────────────
console.log(`${BR}6. MOVIMIENTOS DE UN VEHÍCULO`)
{
  const { body: v } = await rest(admin, `vehiculo?patente=eq.ZZIA010&select=id`)
  const { body: evs } = await rest(admin,
    `vehiculo_evento?vehiculo_id=eq.${v[0].id}&select=tipo,texto&order=created_at.desc`)
  check('trae el historial', (evs || []).length > 0, `${evs?.length}`)
  check('incluye la nota del reporte diario',
        evs.some(e => e.tipo === 'nota' && /paragolpes/i.test(e.texto)),
        JSON.stringify(evs.map(e => e.tipo)))

  const { body: sinEventos } = await rest(admin,
    `vehiculo_evento?vehiculo_id=eq.00000000-0000-0000-0000-000000000000&select=tipo`)
  check('un vehículo sin movimientos devuelve lista vacía',
        Array.isArray(sinEventos) && sinEventos.length === 0)
}

// ── 7. Ninguna herramienta puede escribir ────────────────────────
console.log(`${BR}7. SOLO LECTURA, DE VERDAD`)
{
  // La función de agregación es STABLE: Postgres no la deja escribir aunque
  // alguien la modifique mal en el futuro.
  const { body: vol } = await rest(admin,
    `rpc/taller_ia_contar_por?select=*`, { method: 'GET' })
  void vol

  const { body: meta } = await rest(admin,
    'rpc/taller_ia_contar_por', { method: 'POST', body: JSON.stringify({ p_campo: 'etapa' }) })
  check('contar_por responde por POST de solo lectura', Array.isArray(meta))

  // Y el camino que importa: el chat no expone ninguna herramienta de
  // escritura. Se comprueba que las cuatro declaradas son las cuatro.
  const fs2 = await import('node:fs')
  const tools = fs2.readFileSync(
    new URL('../supabase/functions/_compartido/tools-taller.ts', import.meta.url), 'utf8')
  const nombres = [...tools.matchAll(/name: '([a-z_]+)'/g)].map(m => m[1])
  check('hay exactamente cuatro herramientas', nombres.length === 4, JSON.stringify(nombres))
  check('y son las cuatro acordadas',
        ['buscar_vehiculos', 'contar_por', 'detalle_vehiculo', 'movimientos_de']
          .every(n => nombres.includes(n)), JSON.stringify(nombres))
  check('ninguna herramienta usa insert, update ni delete',
        !/\.(insert|update|upsert|delete)\(/.test(tools),
        (tools.match(/\.(insert|update|upsert|delete)\(/g) || []).join(' '))
  check('ninguna herramienta usa service_role',
        !/SERVICE_ROLE/.test(tools))
}

// ── 8. La conversación ───────────────────────────────────────────
console.log(`${BR}8. DÓNDE SE GUARDA LA CHARLA`)
{
  const { body: canal } = await rest(admin, 'caso?canal=eq.chat_taller&select=id&limit=1')
  check('el canal chat_taller es válido en la base', Array.isArray(canal), JSON.stringify(canal))

  // Un caso de otra empresa no se lee ni conociendo el id.
  const { body: casosA } = await rest(admin, `caso?empresa_id=eq.${EMPRESA_A}&select=id&limit=1`)
  if (casosA?.length) {
    const { body: ajeno } = await rest(otraEmpresa, `caso?id=eq.${casosA[0].id}&select=id`)
    check('la empresa B no lee una conversación de A', (ajeno || []).length === 0)
  } else {
    check('la empresa B no lee una conversación de A', true, '(sin casos todavía)')
  }
}

// ── 9. A quién está habilitada SAU IA ────────────────────────────
// Desde que hay un taller de verdad en la lista, esto deja de ser una
// constante de laboratorio: decide si el dueño de un negocio ve o no sus
// datos a través de un modelo. Se comprueban las dos copias de la lista y la
// regla de pares, usuario por usuario de Forani.
console.log(`${BR}9. QUIÉN TIENE SAU IA`)
{
  const fs3 = await import('node:fs')
  const leer = (p) => fs3.readFileSync(new URL(p, import.meta.url), 'utf8')

  /** Saca la lista de pares de cualquiera de los dos archivos. */
  const extraer = (texto) => {
    const bloque = texto.slice(texto.indexOf('const HABILITADOS'))
    const hasta = bloque.indexOf(BR + ']')
    const cuerpo = bloque.slice(0, hasta)
    const pares = []
    const re = /empresa:\s*'([0-9a-f-]+)',\s*usuarios:\s*\[([^\]]*)\]/g
    let m
    while ((m = re.exec(cuerpo)) !== null) {
      pares.push({
        empresa: m[1],
        usuarios: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]),
      })
    }
    return pares
  }

  const front = extraer(leer('../src/pages/taller/ChatIA.jsx'))
  const server = extraer(leer('../supabase/functions/chat-taller/index.ts'))

  check('la lista del navegador se pudo leer', front.length > 0, JSON.stringify(front))
  check('la del servidor también', server.length > 0, JSON.stringify(server))
  check('y las dos dicen exactamente lo mismo',
        JSON.stringify(front) === JSON.stringify(server),
        `front=${JSON.stringify(front)} server=${JSON.stringify(server)}`)

  // La regla, tal como está escrita en los dos lados.
  const habilitada = (correo, empresas) => {
    const email = (correo || '').trim().toLowerCase()
    if (!email) return null
    const par = server.find(h => h.usuarios.includes(email) && empresas.includes(h.empresa))
    return par ? par.empresa : null
  }

  const FORANI = 'bdd20f9b-1030-434a-96de-2418afb53760'
  const TEFO   = 'estefano.forani@outlook.com'

  check('Tefo queda habilitado en Forani', habilitada(TEFO, [FORANI]) === FORANI)
  check('y su mail no distingue mayúsculas', habilitada('Estefano.Forani@Outlook.com', [FORANI]) === FORANI)

  // Los otros cuatro de Forani, nombrados uno por uno. Dos de ellos son
  // `dueno`, que es justamente lo que NO alcanza.
  for (const otro of ['foranigrupo@gmail.com', 'tommyalvarado88@gmail.com',
                      'esteffanofo@gmail.com', 'administracion@grupoforani.com.ar']) {
    check(`${otro} NO tiene SAU IA`, habilitada(otro, [FORANI]) === null)
  }

  // Nadie entra a un taller del que no es miembro, aunque esté en la lista.
  check('Tefo no entra a San Martín', habilitada(TEFO, [EMPRESA_A]) === null)
  check('el usuario de prueba no entra a Forani',
        habilitada('taller-a-completo@prueba.sau', [FORANI]) === null)
  check('sin membresías no entra nadie', habilitada(TEFO, []) === null)
  check('un mail vacío tampoco', habilitada('', [FORANI, EMPRESA_A]) === null)

  // Y el entorno de prueba sigue funcionando.
  check('San Martín sigue habilitado para el usuario de prueba',
        habilitada('taller-a-completo@prueba.sau', [EMPRESA_A]) === EMPRESA_A)

  check('solo hay dos talleres habilitados', server.length === 2, JSON.stringify(server.map(h => h.empresa)))
  check('y una sola persona por taller',
        server.every(h => h.usuarios.length === 1), JSON.stringify(server))
}

// ── 10. El endpoint rechaza de verdad ────────────────────────────
// La lista es datos; esto comprueba que el servidor la aplica. No se puede
// probar con las cuentas de Forani —no tenemos sus contraseñas ni corresponde
// usarlas— así que se prueba con un usuario de San Martín que NO está en la
// lista: mismo camino de código, mismo rechazo.
console.log(`${BR}10. EL SERVIDOR APLICA LA LISTA`)
{
  const noListado = await chat(operario, { pregunta: '¿Cuántos autos hay?' })
  check('un usuario de un taller habilitado, pero no listado → 403',
        noListado.status === 403, `status ${noListado.status}`)
  check('el rechazo no cuenta dónde sí hay gente habilitada',
        !/forani|san mart/i.test(JSON.stringify(noListado.body || '')),
        JSON.stringify(noListado.body))

  const coord = await chat(sinMontos, { pregunta: '¿Cuántos autos hay?' })
  check('otro no listado, mismo rechazo', coord.status === 403)

  const otra = await chat(otraEmpresa, { pregunta: '¿Cuántos autos hay?' })
  check('y un usuario de una empresa sin SAU IA también', otra.status === 403)
}

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
