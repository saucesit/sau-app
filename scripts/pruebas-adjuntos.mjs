/**
 * Adjuntos de la ficha, en cualquier etapa y después de entregar (0034).
 *
 * Comprueba cuatro cosas: que se puedan sumar archivos en toda la cadena —de
 * Recepción a Control de Calidad y también en un entregado—, que hacerlo no
 * mueva ni reactive el vehículo, que quede registrado quién y cuándo, y que un
 * operario no llegue a los que muestran plata — ni por la tabla ni por el
 * bucket.
 *
 * Mismo criterio de destino que las otras suites.
 *
 *   node scripts/pruebas-adjuntos.mjs
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

async function subir(u, path, contenido, tipoMime) {
  const r = await fetch(`${SUPA}/storage/v1/object/taller/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': tipoMime },
    body: contenido,
  })
  return { status: r.status, ok: r.ok }
}

async function firmar(u, path) {
  const r = await fetch(`${SUPA}/storage/v1/object/sign/taller/${path}`, {
    method: 'POST', headers: h(u), body: JSON.stringify({ expiresIn: 60 }),
  })
  return { status: r.status, ok: r.ok }
}

// ──────────────────────────────────────────────────────────────────
const U = local
  ? { duena: 'duena@local.test', operario: 'chapista@local.test',
      sinMontos: 'recepcion@local.test' }
  : { duena: 'taller-a-completo@prueba.sau', operario: 'taller-a-operario@prueba.sau',
      sinMontos: 'taller-a-coordinador@prueba.sau',
      contador: 'taller-a-contador@prueba.sau', soloDocs: 'taller-a-docs@prueba.sau' }

const duena     = await login(U.duena)
const operario  = await login(U.operario)
const sinMontos = await login(U.sinMontos)
// El perfil Contador existe solo contra el proyecto autorizado: en la base
// local el seed de usuarios es otro y esta sección se saltea.
const contador  = U.contador ? await login(U.contador) : null
const soloDocs  = U.soloDocs ? await login(U.soloDocs) : null

const { body: ent } = await rest(duena,
  'vehiculo?etapa=eq.entregado&select=id,patente,empresa_id,etapa,fecha_entrega&limit=1')
if (!ent?.length) { console.error('No hay ningún vehículo entregado para probar.'); process.exit(1) }
const V = ent[0]
console.log(`\nVehículo entregado: ${V.patente}\n`)

const marca = Date.now()
const rutaRecibo = `${V.empresa_id}/${V.id}/recibo-${marca}-prueba.pdf`
const rutaFoto   = `${V.empresa_id}/${V.id}/foto_entrega-${marca}-prueba.png`

// ── 1. Lo que ya existía sigue visible ────────────────────────────
console.log('1. NO SE ROMPIÓ LO ANTERIOR')
{
  const d = await rest(duena, `vehiculo_archivo?vehiculo_id=eq.${V.id}&select=id,tipo`)
  check('la dueña sigue viendo los adjuntos de siempre', Array.isArray(d.body), JSON.stringify(d.body))

  const { body: fotos } = await rest(operario, `vehiculo_archivo?tipo=like.foto*&select=id,tipo&limit=5`)
  check('el operario sigue viendo fotos', Array.isArray(fotos), JSON.stringify(fotos))
}

// ── 2. Sumar papeles después de entregar ──────────────────────────
console.log('\n2. DOCUMENTOS POSTERIORES A LA ENTREGA')
{
  const s = await subir(duena, rutaRecibo, '%PDF-1.4', 'application/pdf')
  check('se sube el recibo al bucket', s.ok, `status ${s.status}`)

  const i = await rest(duena, 'vehiculo_archivo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ vehiculo_id: V.id, tipo: 'recibo', path: rutaRecibo, nombre: 'recibo.pdf' }),
  })
  check('queda registrado en la ficha', i.ok, JSON.stringify(i.body))
  check('con autor', !!i.body?.[0]?.autor_id, JSON.stringify(i.body?.[0]?.autor_id))
  check('y con fecha', !!i.body?.[0]?.created_at)

  const f = await subir(duena, rutaFoto, 'x', 'image/png')
  check('también una foto de entrega', f.ok, `status ${f.status}`)

  const fi = await rest(duena, 'vehiculo_archivo', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ vehiculo_id: V.id, tipo: 'foto_entrega', path: rutaFoto, nombre: 'entrega.png' }),
  })
  check('y la foto también queda en la ficha', fi.ok, JSON.stringify(fi.body))
}

// ── 3. No reactiva el vehículo ────────────────────────────────────
console.log('\n3. NO REACTIVA EL VEHÍCULO')
{
  const { body: v2 } = await rest(duena, `vehiculo?id=eq.${V.id}&select=etapa,fecha_entrega`)
  check('sigue entregado', v2[0].etapa === 'entregado', v2[0].etapa)
  check('con la misma fecha de entrega', v2[0].fecha_entrega === V.fecha_entrega)

  const { body: act } = await rest(duena,
    `vehiculo?etapa=neq.entregado&select=id&id=eq.${V.id}`)
  check('no vuelve a la pizarra', Array.isArray(act) && act.length === 0)

  const { totalesAFacturar } = await import('../src/lib/taller.js')
  const { body: m } = await rest(duena, `vehiculo_monto?vehiculo_id=eq.${V.id}&select=*`)
  const unido = { ...v2[0], ...(m?.[0] || {}) }
  const t = totalesAFacturar([unido])
  check('sus importes siguen fuera de los totales',
        t.compania === 0 && t.franquicia === 0 && t.particular === 0, JSON.stringify(t))
}

// ── 4. El operario no llega a la plata ────────────────────────────
console.log('\n4. EL OPERARIO NO VE DOCUMENTOS CON IMPORTES')
{
  const r = await rest(operario, `vehiculo_archivo?vehiculo_id=eq.${V.id}&select=id,tipo`)
  const tipos = (r.body || []).map(x => x.tipo)
  check('no le aparece el recibo en la ficha', !tipos.includes('recibo'), JSON.stringify(tipos))
  check('pero sí la foto de entrega', tipos.includes('foto_entrega'), JSON.stringify(tipos))

  const s = await firmar(operario, rutaRecibo)
  check('no puede pedir la URL firmada del recibo', !s.ok, `status ${s.status}`)

  const sf = await firmar(operario, rutaFoto)
  check('pero sí la de la foto', sf.ok, `status ${sf.status}`)

  const sub = await subir(operario, `${V.empresa_id}/${V.id}/factura-${marca}-intruso.pdf`, 'x', 'application/pdf')
  check('no puede subir una factura', !sub.ok, `status ${sub.status}`)

  const ins = await rest(operario, 'vehiculo_archivo', {
    method: 'POST', body: JSON.stringify({ vehiculo_id: V.id, tipo: 'factura', path: 'x/y/factura-1.pdf' }),
  })
  check('ni registrarla en la ficha', !ins.ok, `status ${ins.status}`)
}

// ── 5. El operario no adjunta nada en un entregado ────────────────
// Ni siquiera una foto: la restricción es del servidor, no de la pantalla.
console.log('\n5. EL OPERARIO NO ADJUNTA EN ENTREGADOS')
{
  const rutaF = `${V.empresa_id}/${V.id}/foto_entrega-${marca}-oper.png`
  const s = await subir(operario, rutaF, 'x', 'image/png')
  check('no puede subir una foto al bucket', !s.ok, `status ${s.status}`)

  const i = await rest(operario, 'vehiculo_archivo', {
    method: 'POST', body: JSON.stringify({ vehiculo_id: V.id, tipo: 'foto_entrega', path: rutaF }),
  })
  check('ni registrarla en la ficha', !i.ok, `status ${i.status}`)
}

// ── 6. Anular un adjunto cargado por error ────────────────────────
console.log('\n6. ANULAR, SIN BORRAR NADA')
{
  const { body: ar } = await rest(duena,
    `vehiculo_archivo?vehiculo_id=eq.${V.id}&tipo=eq.recibo&anulado_en=is.null&select=id,path&limit=1`)
  if (!ar?.length) { console.log('  (sin recibo para anular)') }
  else {
    const A = ar[0]

    const sinMotivo = await rpc(duena, 'taller_anular_archivo', { p_archivo: A.id, p_motivo: '  ' })
    check('exige un motivo', !sinMotivo.ok, JSON.stringify(sinMotivo.body))

    const porOperario = await rpc(operario, 'taller_anular_archivo',
      { p_archivo: A.id, p_motivo: 'quiero borrarlo' })
    check('el operario no puede anular', !porOperario.ok)

    const r = await rpc(duena, 'taller_anular_archivo',
      { p_archivo: A.id, p_motivo: 'Cargado en el vehículo equivocado' })
    check('quien puede eliminar sí anula', r.ok, JSON.stringify(r.body))

    const { body: d } = await rest(duena, `vehiculo_archivo?id=eq.${A.id}&select=*`)
    check('la fila NO se borra', d?.length === 1)
    check('queda el motivo', d?.[0]?.anulado_motivo === 'Cargado en el vehículo equivocado')
    check('queda quién lo anuló', !!d?.[0]?.anulado_por)
    check('y cuándo', !!d?.[0]?.anulado_en)

    const f = await firmar(duena, A.path)
    check('el archivo sigue en el bucket', f.ok, `status ${f.status}`)

    const { body: ev } = await rest(duena,
      `vehiculo_evento?vehiculo_id=eq.${V.id}&tipo=eq.anulacion&select=texto&order=created_at.desc&limit=1`)
    check('queda en la bitácora con el motivo',
          /vehículo equivocado/i.test(ev?.[0]?.texto || ''), ev?.[0]?.texto)

    const otra = await rpc(duena, 'taller_anular_archivo', { p_archivo: A.id, p_motivo: 'de nuevo' })
    check('no se puede anular dos veces', !otra.ok)

    const directo = await rest(duena, `vehiculo_archivo?id=eq.${A.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ anulado_motivo: 'cambiado a mano' }),
    })
    check('no se puede tocar la anulación por API directa',
          !directo.ok || (Array.isArray(directo.body) && directo.body.length === 0),
          `status ${directo.status}`)
  }
}

// ── 7. Adjuntar durante todo el proceso, etapa por etapa ──────────
// Lo que reportó Forani: después de recepcionar el auto no había forma de
// sumar una foto. El servidor nunca lo prohibió —ninguna policy mira la
// etapa— así que esto fija esa garantía para que no se pierda.
console.log('\n7. ADJUNTAR EN CUALQUIER ETAPA')
{
  const CADENA = ['recepcion', 'chapa', 'preparacion', 'pintura',
                  'terminacion', 'control_calidad', 'entregado']

  // Una foto se archiva distinto según dónde esté el auto. La regla la decide
  // la pantalla; acá se comprueba que la base acepte lo que la pantalla manda.
  const { tipoFoto } = await import('../src/lib/taller.js')

  for (const etapa of CADENA) {
    const { body: vs } = await rest(duena,
      `vehiculo?etapa=eq.${etapa}&select=id,patente,empresa_id&limit=1`)
    if (!vs?.length) { console.log(`  (sin vehículo en ${etapa})`); continue }
    const W = vs[0]

    // La foto, con el tipo que le corresponde a esa etapa.
    const tf = tipoFoto(etapa)
    const rf = `${W.empresa_id}/${W.id}/${tf}-${marca}-etapa.png`
    const sf = await subir(duena, rf, 'x', 'image/png')
    const nf = await rest(duena, 'vehiculo_archivo', {
      method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo: tf, path: rf, nombre: 'foto.png' }),
    })
    check(`${etapa}: se suma una ${tf}`, sf.ok && nf.ok,
          `bucket ${sf.status} / ficha ${nf.status}`)

    // Y un papel no económico, que es lo que puede ver cualquiera que cargue.
    const rd = `${W.empresa_id}/${W.id}/orden_interna-${marca}-etapa.pdf`
    const sd = await subir(duena, rd, '%PDF-1.4', 'application/pdf')
    const nd = await rest(duena, 'vehiculo_archivo', {
      method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo: 'orden_interna', path: rd, nombre: 'orden.pdf' }),
    })
    check(`${etapa}: se suma una orden interna`, sd.ok && nd.ok,
          `bucket ${sd.status} / ficha ${nd.status}`)

    // Y el vehículo queda exactamente donde estaba.
    const { body: q } = await rest(duena, `vehiculo?id=eq.${W.id}&select=etapa`)
    check(`${etapa}: adjuntar no mueve al vehículo`, q?.[0]?.etapa === etapa, q?.[0]?.etapa)
  }
}

// ── 8. Permitir adjuntar en proceso no relajó los permisos ────────
console.log('\n8. LOS PERMISOS SIGUEN EN PIE EN PROCESO')
{
  const { body: act } = await rest(duena,
    'vehiculo?etapa=eq.chapa&select=id,empresa_id&limit=1')
  if (!act?.length) { console.log('  (sin vehículo en chapa)') }
  else {
    const W = act[0]

    // Sin taller.cargar no se suben documentos, tampoco en pleno proceso.
    // (La foto del trabajo sí: va aparte, con taller.fotos — ver 9.)
    const s = await subir(operario, `${W.empresa_id}/${W.id}/orden_interna-${marca}-s8.pdf`, 'x', 'application/pdf')
    check('el operario no sube documentos en proceso', !s.ok, `status ${s.status}`)

    const i = await rest(operario, 'vehiculo_archivo', {
      method: 'POST',
      body: JSON.stringify({ vehiculo_id: W.id, tipo: 'orden_interna', path: `${W.empresa_id}/${W.id}/x.pdf` }),
    })
    check('ni los registra en la ficha', !i.ok, `status ${i.status}`)

    // Y los documentos con plata siguen pidiendo taller.montos: quien carga
    // pero no ve importes sube la orden interna y no la factura.
    const sm = await subir(sinMontos,
      `${W.empresa_id}/${W.id}/factura-${marca}-coord.pdf`, 'x', 'application/pdf')
    check('quien no ve montos no sube una factura en proceso', !sm.ok, `status ${sm.status}`)

    const ruta = `${W.empresa_id}/${W.id}/orden_interna-${marca}-coord.pdf`
    const so = await subir(sinMontos, ruta, '%PDF-1.4', 'application/pdf')
    check('pero sí la orden interna', so.ok, `status ${so.status}`)

    const no = await rest(sinMontos, 'vehiculo_archivo', {
      method: 'POST', body: JSON.stringify({
        vehiculo_id: W.id, tipo: 'orden_interna', path: ruta, nombre: 'orden-coord.pdf' }),
    })
    check('y la registra en la ficha', no.ok, `status ${no.status}`)
  }
}

// ── 9. taller.fotos: la foto del trabajo y nada más ───────────────
// Migración 0043. El operario deja la foto de lo que hizo sin ganar
// taller.cargar, que además da de alta vehículos y edita la ficha.
console.log('\n9. EL OPERARIO SUBE LA FOTO DEL TRABAJO')
{
  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.chapa&select=id,patente,empresa_id&limit=1')
  if (!proc?.length) { console.log('  (sin vehículo en chapa)') }
  else {
    const W = proc[0]
    const base = `${W.empresa_id}/${W.id}`

    // Lo que sí: la foto del proceso, en el bucket y en la ficha.
    const rfp = `${base}/foto_proceso-${marca}-trabajo.png`
    const sfp = await subir(operario, rfp, 'x', 'image/png')
    check('sube la foto del proceso al bucket', sfp.ok, `status ${sfp.status}`)

    const ifp = await rest(operario, 'vehiculo_archivo', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ vehiculo_id: W.id, tipo: 'foto_proceso', path: rfp, nombre: 'trabajo.png' }),
    })
    check('y queda en la ficha', ifp.ok, JSON.stringify(ifp.body))
    check('con él como autor', !!ifp.body?.[0]?.autor_id)

    // Lo que no: ningún documento, ni el que no tiene importes.
    for (const tipo of ['orden_interna', 'orden_compania', 'orden_firmada', 'recibo', 'factura']) {
      const s = await subir(operario, `${base}/${tipo}-${marca}-oper.pdf`, 'x', 'application/pdf')
      const i = await rest(operario, 'vehiculo_archivo', {
        method: 'POST',
        body: JSON.stringify({ vehiculo_id: W.id, tipo, path: `${base}/${tipo}-${marca}-oper.pdf` }),
      })
      check(`no sube ${tipo}`, !s.ok && !i.ok, `bucket ${s.status} / ficha ${i.status}`)
    }

    // Ni las fotos administrativas: recibir y entregar no son su trabajo.
    for (const tipo of ['foto_ingreso', 'foto_entrega']) {
      const s = await subir(operario, `${base}/${tipo}-${marca}-oper.png`, 'x', 'image/png')
      const i = await rest(operario, 'vehiculo_archivo', {
        method: 'POST',
        body: JSON.stringify({ vehiculo_id: W.id, tipo, path: `${base}/${tipo}-${marca}-oper.png` }),
      })
      check(`no sube ${tipo}`, !s.ok && !i.ok, `bucket ${s.status} / ficha ${i.status}`)
    }

    // Y no se puede colar un documento disfrazando el nombre del archivo: el
    // bucket mira el prefijo de la ruta, y la tabla mira el tipo.
    const disfraz = await subir(operario, `${base}/foto_proceso-${marca}-factura.pdf`, 'x', 'application/pdf')
    if (disfraz.ok) {
      const i = await rest(operario, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({
          vehiculo_id: W.id, tipo: 'factura',
          path: `${base}/foto_proceso-${marca}-factura.pdf` }),
      })
      check('aunque entre al bucket, no la registra como factura', !i.ok, `status ${i.status}`)
    }

    // El permiso nuevo no trajo nada más de arrastre.
    const an = await rpc(operario, 'taller_anular_archivo',
      { p_archivo: ifp.body?.[0]?.id, p_motivo: 'me arrepentí' })
    check('no anula ni su propio adjunto', !an.ok, JSON.stringify(an.body))

    const ed = await rest(operario, `vehiculo?id=eq.${W.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ cliente_nombre: 'TOCADO POR EL OPERARIO' }),
    })
    check('no edita la ficha del vehículo',
          !ed.ok || (Array.isArray(ed.body) && ed.body.length === 0), `status ${ed.status}`)

    const alta = await rest(operario, 'vehiculo', {
      method: 'POST', body: JSON.stringify({
        empresa_id: W.empresa_id, patente: `ZZOP${marca % 10000}`,
        vehiculo: 'ALTA INDEBIDA', fecha_ingreso: '2026-10-07' }),
    })
    check('no da de alta un vehículo', !alta.ok, `status ${alta.status}`)

    const mo = await rest(operario, `vehiculo_monto?vehiculo_id=eq.${W.id}&select=monto_compania`)
    check('sigue sin ver importes', Array.isArray(mo.body) && mo.body.length === 0,
          JSON.stringify(mo.body))

    // Y no se lo puede autoasignar a sí mismo ni ampliar por su cuenta.
    const { body: mem } = await rest(operario, 'membresia?select=id,permisos')
    if (mem?.[0]?.id) {
      const sube = await rest(operario, `membresia?id=eq.${mem[0].id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ permisos: [...mem[0].permisos, 'taller.cargar'] }),
      })
      const { body: dsp } = await rest(operario, `membresia?id=eq.${mem[0].id}&select=permisos`)
      check('no se agrega taller.cargar a sí mismo',
            !dsp?.[0]?.permisos?.includes('taller.cargar'), JSON.stringify(dsp?.[0]?.permisos))
      void sube
    }
  }
}

// ── 10. Quien ya cargaba no cambió ────────────────────────────────
console.log('\n10. taller.cargar SIGUE IGUAL')
{
  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.pintura&select=id,empresa_id&limit=1')
  if (!proc?.length) { console.log('  (sin vehículo en pintura)') }
  else {
    const W = proc[0]
    const base = `${W.empresa_id}/${W.id}`

    // La dueña, que no tiene taller.fotos, sigue subiendo de todo.
    for (const tipo of ['foto_proceso', 'orden_interna', 'factura']) {
      const ruta = `${base}/${tipo}-${marca}-full.${tipo.startsWith('foto') ? 'png' : 'pdf'}`
      const s = await subir(duena, ruta, 'x', tipo.startsWith('foto') ? 'image/png' : 'application/pdf')
      const i = await rest(duena, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo, path: ruta }),
      })
      check(`quien carga sigue subiendo ${tipo}`, s.ok && i.ok,
            `bucket ${s.status} / ficha ${i.status}`)
    }

    // Y taller.montos sigue haciendo falta para los que llevan importes.
    const ruta = `${base}/factura-${marca}-coord2.pdf`
    const s = await subir(sinMontos, ruta, 'x', 'application/pdf')
    check('sin taller.montos no se sube una factura', !s.ok, `status ${s.status}`)
  }

  // El permiso nuevo es asignable por el cliente, no reservado.
  const { body: asg } = await rpc(duena, 'sau_permisos_asignables_por_cliente', {})
  check('taller.fotos está en la lista de asignables',
        Array.isArray(asg) && asg.includes('taller.fotos'), JSON.stringify(asg))

  const { body: res } = await rpc(duena, 'sau_permisos_reservados', {})
  check('y no entró en la de reservados de SAU',
        Array.isArray(res) && !res.includes('taller.fotos'), JSON.stringify(res))
}

// ── 11. taller.documentos: el contador sube facturas ──────────────
// Migración 0047. El contador tenía que poder adjuntar la facturación sin que
// eso le diera de alta vehículos ni edición de ficha, que es lo que arrastra
// taller.cargar.
console.log('\n11. EL CONTADOR ADJUNTA DOCUMENTACIÓN')
if (!contador) { console.log('  (perfil Contador solo contra el proyecto autorizado)') }
else {
  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.pintura&select=id,patente,empresa_id&limit=1')
  if (!proc?.length) { console.log('  (sin vehículo en pintura)') }
  else {
    const W = proc[0]
    const base = `${W.empresa_id}/${W.id}`

    // Lo que sí: los cinco documentos, porque además tiene taller.montos.
    for (const tipo of ['orden_interna', 'orden_compania', 'orden_firmada', 'recibo', 'factura']) {
      const ruta = `${base}/${tipo}-${marca}-conta.pdf`
      const s = await subir(contador, ruta, '%PDF-1.4', 'application/pdf')
      const i = await rest(contador, 'vehiculo_archivo', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ vehiculo_id: W.id, tipo, path: ruta, nombre: `${tipo}.pdf` }),
      })
      check(`sube ${tipo}`, s.ok && i.ok, `bucket ${s.status} / ficha ${i.status}`)
      if (tipo === 'factura') check('y queda con él como autor', !!i.body?.[0]?.autor_id)
    }

    // Una factura fotografiada con el celular también entra: manda el tipo,
    // no la extensión del archivo.
    const foto = `${base}/factura-${marca}-sacada.jpg`
    const sf = await subir(contador, foto, 'x', 'image/jpeg')
    const nf = await rest(contador, 'vehiculo_archivo', {
      method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo: 'factura', path: foto }) })
    check('una factura fotografiada entra igual', sf.ok && nf.ok, `${sf.status} / ${nf.status}`)

    // Lo que no: ninguna foto del proceso.
    for (const tipo of ['foto_ingreso', 'foto_proceso', 'foto_entrega']) {
      const ruta = `${base}/${tipo}-${marca}-conta.png`
      const s = await subir(contador, ruta, 'x', 'image/png')
      const i = await rest(contador, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo, path: ruta }) })
      check(`no sube ${tipo}`, !s.ok && !i.ok, `bucket ${s.status} / ficha ${i.status}`)
    }

    // Y el permiso no trajo nada más de arrastre.
    const alta = await rest(contador, 'vehiculo', {
      method: 'POST', body: JSON.stringify({
        empresa_id: W.empresa_id, patente: `ZZCONTA${marca % 1000}`,
        vehiculo: 'ALTA INDEBIDA', cliente_nombre: 'X', compania: 'Particular',
        fecha_ingreso: '2026-10-13' }) })
    check('no da de alta un vehículo', !alta.ok, `status ${alta.status}`)

    const edita = await rest(contador, `vehiculo?id=eq.${W.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ cliente_nombre: 'TOCADO POR EL CONTADOR' }) })
    check('no edita la ficha',
          !edita.ok || (Array.isArray(edita.body) && edita.body.length === 0), `status ${edita.status}`)

    const avanza = await rpc(contador, 'taller_validar_avance', { p_vehiculo: W.id })
    check('no avanza etapas', !avanza.ok)

    const trabaja = await rpc(contador, 'taller_marcar_trabajo_hecho', { p_vehiculo: W.id })
    check('no marca trabajo', !trabaja.ok)

    const { body: suyo } = await rest(contador,
      `vehiculo_archivo?vehiculo_id=eq.${W.id}&tipo=eq.factura&anulado_en=is.null&select=id&limit=1`)
    if (suyo?.[0]?.id) {
      const an = await rpc(contador, 'taller_anular_archivo',
        { p_archivo: suyo[0].id, p_motivo: 'me equivoqué' })
      check('no anula ni lo que subió él', !an.ok, JSON.stringify(an.body))
    }

    // Lo que sí, porque tiene taller.montos: la facturación.
    const fact = await rpc(contador, 'taller_registrar_facturacion',
      { p_vehiculo: W.id, p_rubro: 'particular', p_estado: 'no_aplica' })
    check('registra facturación', fact.ok, JSON.stringify(fact.body))
    await rpc(duena, 'taller_registrar_facturacion',
      { p_vehiculo: W.id, p_rubro: 'particular', p_estado: 'pendiente' })

    // ── Documentos SIN montos: los económicos siguen vedados ──
    const rutaOi = `${base}/orden_interna-${marca}-docs.pdf`
    const sOi = await subir(soloDocs, rutaOi, '%PDF-1.4', 'application/pdf')
    const iOi = await rest(soloDocs, 'vehiculo_archivo', {
      method: 'POST', body: JSON.stringify({
        vehiculo_id: W.id, tipo: 'orden_interna', path: rutaOi }) })
    check('sin montos sube la orden interna', sOi.ok && iOi.ok, `${sOi.status} / ${iOi.status}`)

    for (const tipo of ['factura', 'recibo', 'orden_compania', 'orden_firmada']) {
      const ruta = `${base}/${tipo}-${marca}-docs.pdf`
      const s = await subir(soloDocs, ruta, 'x', 'application/pdf')
      const i = await rest(soloDocs, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo, path: ruta }) })
      check(`sin montos NO sube ${tipo}`, !s.ok && !i.ok, `bucket ${s.status} / ficha ${i.status}`)
    }

    const { body: ve } = await rest(soloDocs,
      `vehiculo_archivo?vehiculo_id=eq.${W.id}&select=tipo`)
    check('y tampoco ve los documentos con importes',
          !(ve || []).some(x => ['factura','recibo','orden_compania','orden_firmada'].includes(x.tipo)),
          JSON.stringify((ve || []).map(x => x.tipo)))
  }
}

// ── 12. Nadie perdió nada con el permiso nuevo ────────────────────
console.log('\n12. LOS DE SIEMPRE SIGUEN IGUAL')
{
  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.terminacion&select=id,empresa_id&limit=1')
  if (!proc?.length) { console.log('  (sin vehículo en terminación)') }
  else {
    const W = proc[0]
    const base = `${W.empresa_id}/${W.id}`
    for (const [tipo, mime] of [['foto_proceso','image/png'], ['orden_interna','application/pdf'],
                                ['factura','application/pdf']]) {
      const ruta = `${base}/${tipo}-${marca}-sigue.${mime === 'image/png' ? 'png' : 'pdf'}`
      const s = await subir(duena, ruta, 'x', mime)
      const i = await rest(duena, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo, path: ruta }) })
      check(`taller.cargar sigue subiendo ${tipo}`, s.ok && i.ok, `${s.status} / ${i.status}`)
    }
    const op = await subir(operario, `${base}/foto_proceso-${marca}-op2.png`, 'x', 'image/png')
    check('taller.fotos sigue subiendo la foto del proceso', op.ok, `status ${op.status}`)

    const { body: asg } = await rpc(duena, 'sau_permisos_asignables_por_cliente', {})
    check('taller.documentos es asignable por el cliente',
          Array.isArray(asg) && asg.includes('taller.documentos'), JSON.stringify(asg))
    const { body: res } = await rpc(duena, 'sau_permisos_reservados', {})
    check('y no entró en los reservados de SAU',
          Array.isArray(res) && !res.includes('taller.documentos'))
  }
}

// ── 13. Varios archivos del mismo tipo en un vehículo ─────────────
// Lo que pidió Forani: subir más de una orden y más de una factura. No había
// nada que lo impidiera —el índice (vehiculo_id, tipo) no es unique y en
// producción ya hay 28 fotos del mismo tipo en un auto— pero la pantalla
// mandaba los documentos de a uno. Esto fija que varios del mismo tipo son
// filas independientes: autor propio, nombre propio, anulación propia.
console.log('\n13. VARIOS DOCUMENTOS DEL MISMO TIPO')
{
  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.chapa&select=id,patente,empresa_id&limit=1')
  if (!proc?.length) { console.log('  (sin vehículo en chapa)') }
  else {
    const W = proc[0]
    const base = `${W.empresa_id}/${W.id}`
    const NOMBRES = ['factura-A-001.pdf', 'factura-A-002.pdf', 'factura-A-003.pdf']
    const creados = []

    for (const [n, nombre] of NOMBRES.entries()) {
      const ruta = `${base}/factura-${marca}-lote${n}.pdf`
      const s = await subir(duena, ruta, '%PDF-1.4', 'application/pdf')
      const i = await rest(duena, 'vehiculo_archivo', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ vehiculo_id: W.id, tipo: 'factura', path: ruta, nombre }),
      })
      check(`entra la factura ${n + 1} de 3`, s.ok && i.ok, `bucket ${s.status} / ficha ${i.status}`)
      if (i.body?.[0]) creados.push(i.body[0])
    }

    check('quedan tres filas distintas', new Set(creados.map(x => x.id)).size === 3,
          JSON.stringify(creados.map(x => x.id)))
    check('con tres rutas distintas en el bucket',
          new Set(creados.map(x => x.path)).size === 3)
    check('cada una con su nombre de archivo real',
          NOMBRES.every(n => creados.some(x => x.nombre === n)),
          JSON.stringify(creados.map(x => x.nombre)))
    check('y cada una con su autor', creados.every(x => !!x.autor_id))

    // Y la ficha las lista a las tres.
    const { body: enFicha } = await rest(duena,
      `vehiculo_archivo?vehiculo_id=eq.${W.id}&tipo=eq.factura&path=like.*${marca}*&select=id,nombre`)
    check('la ficha lista las tres', enFicha?.length === 3, `${enFicha?.length}`)

    // Anular una no toca a las otras: es lo que permite corregir la que se
    // cargó mal sin volver a subir el lote entero.
    if (creados.length === 3) {
      const an = await rpc(duena, 'taller_anular_archivo',
        { p_archivo: creados[1].id, p_motivo: 'Factura duplicada del lote' })
      check('se anula una sola del lote', an.ok, JSON.stringify(an.body))

      const { body: luego } = await rest(duena,
        `vehiculo_archivo?id=in.(${creados.map(x => x.id).join(',')})&select=id,anulado_en,nombre`)
      const anuladas = (luego || []).filter(x => x.anulado_en)
      check('queda anulada exactamente una', anuladas.length === 1,
            JSON.stringify(anuladas.map(x => x.nombre)))
      check('y es la que se pidió', anuladas[0]?.id === creados[1].id)
      check('las otras dos siguen vigentes',
            (luego || []).filter(x => !x.anulado_en).length === 2)
    }

    // Lo mismo con órdenes, que es el otro caso que pidió Tefo.
    const ordenes = []
    for (const n of [0, 1]) {
      const ruta = `${base}/orden_interna-${marca}-lote${n}.pdf`
      const s = await subir(duena, ruta, '%PDF-1.4', 'application/pdf')
      const i = await rest(duena, 'vehiculo_archivo', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ vehiculo_id: W.id, tipo: 'orden_interna', path: ruta,
                               nombre: `orden-hoja-${n + 1}.pdf` }),
      })
      if (s.ok && i.ok) ordenes.push(i.body?.[0])
    }
    check('también entran dos órdenes internas del mismo auto', ordenes.length === 2)
  }
}

// ── 14. Una tanda con un archivo fallado no corta ─────────────────
// El reclamo concreto: "no quiero que un fallo silencioso deje al usuario
// creyendo que subieron todos". Acá se corre el mismo algoritmo que la ficha
// —seguir con el que viene, juntar el resultado— contra el backend real.
console.log('\n14. CARGA PARCIAL: EL FALLO NO INTERRUMPE LA TANDA')
{
  const { motivoCarga } = await import('../src/lib/taller.js')

  /** Lo que hace adjuntar() en la ficha: no cortar, y contar al final. */
  async function tanda(u, W, lote, sufijo) {
    const subidos = [], fallas = []
    for (const [n, it] of lote.entries()) {
      const ruta = `${W.empresa_id}/${W.id}/${it.ruta || it.tipo}-${marca}-${sufijo}${n}.${it.ext || 'pdf'}`
      const s = await subir(u, ruta, '%PDF-1.4', it.mime || 'application/pdf')
      if (!s.ok) { fallas.push({ nombre: it.nombre, motivo: `bucket ${s.status}` }); continue }
      const i = await rest(u, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({
          vehiculo_id: W.id, tipo: it.tipo, path: ruta, nombre: it.nombre }) })
      if (!i.ok) { fallas.push({ nombre: it.nombre, motivo: `ficha ${i.status}` }); continue }
      subidos.push(it.nombre)
    }
    return { subidos, fallas }
  }

  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.pintura&select=id,empresa_id&limit=1')
  if (!proc?.length || !soloDocs) { console.log('  (sin vehículo en pintura o sin perfil solo-documentos)') }
  else {
    const W = proc[0]

    // El del medio es el que no puede: taller.documentos sin taller.montos.
    // Los otros dos tienen que entrar igual, y el tercero es el que probaba
    // el break: con el corte en el primer error nunca se intentaba.
    const r = await tanda(soloDocs, W, [
      { tipo: 'orden_interna', nombre: 'hoja-1.pdf' },
      { tipo: 'factura',       nombre: 'factura-vedada.pdf' },
      { tipo: 'orden_interna', nombre: 'hoja-3.pdf' },
    ], 'parcial')

    check('entran los dos que sí podía', r.subidos.length === 2, JSON.stringify(r.subidos))
    check('el tercero se intenta igual, aunque el segundo haya fallado',
          r.subidos.includes('hoja-3.pdf'), JSON.stringify(r.subidos))
    check('se reporta exactamente un fallo', r.fallas.length === 1, JSON.stringify(r.fallas))
    check('y se sabe cuál falló por nombre',
          r.fallas[0]?.nombre === 'factura-vedada.pdf', JSON.stringify(r.fallas))

    // Lo que entró, quedó. No hay deshacer del lote.
    const { body: qd } = await rest(soloDocs,
      `vehiculo_archivo?vehiculo_id=eq.${W.id}&path=like.*${marca}-parcial*&select=nombre,tipo`)
    check('lo que subió bien queda guardado', qd?.length === 2, JSON.stringify(qd))
    check('y la que falló no dejó fila',
          !(qd || []).some(x => x.tipo === 'factura'), JSON.stringify(qd))

    // ── Permiso económico archivo por archivo ──
    // Los cinco documentos de una sola vez: solo el no económico entra.
    const cinco = await tanda(soloDocs, W, [
      { tipo: 'orden_interna',  nombre: 'interna.pdf' },
      { tipo: 'orden_compania', nombre: 'compania.pdf' },
      { tipo: 'orden_firmada',  nombre: 'firmada.pdf' },
      { tipo: 'recibo',         nombre: 'recibo.pdf' },
      { tipo: 'factura',        nombre: 'factura.pdf' },
    ], 'econ')
    check('sin taller.montos entra solo el documento sin importes',
          cinco.subidos.length === 1 && cinco.subidos[0] === 'interna.pdf',
          JSON.stringify(cinco.subidos))
    check('y los cuatro económicos se rechazan uno por uno',
          cinco.fallas.length === 4, JSON.stringify(cinco.fallas.map(f => f.nombre)))

    // Con taller.montos, la misma tanda entra completa: el filtro es el
    // permiso de cada archivo, no el tamaño del lote.
    const conMontos = await tanda(contador || duena, W, [
      { tipo: 'orden_compania', nombre: 'compania-ok.pdf' },
      { tipo: 'recibo',         nombre: 'recibo-ok.pdf' },
      { tipo: 'factura',        nombre: 'factura-ok.pdf' },
    ], 'full')
    check('con taller.montos la tanda económica entra completa',
          conMontos.subidos.length === 3 && conMontos.fallas.length === 0,
          JSON.stringify(conMontos.fallas))

    // Un caso que la pantalla no produce pero el loop tiene que aguantar: el
    // bucket acepta la ruta y la tabla rechaza la fila. El coordinador puede
    // escribir una ruta de foto, pero no registrar una factura.
    const rutaMix = `${W.empresa_id}/${W.id}/foto_proceso-${marca}-mix.png`
    const sMix = await subir(sinMontos, rutaMix, 'x', 'image/png')
    if (sMix.ok) {
      const iMix = await rest(sinMontos, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({
          vehiculo_id: W.id, tipo: 'factura', path: rutaMix, nombre: 'disfraz.png' }) })
      check('si el bucket acepta pero la tabla rechaza, no queda la fila', !iMix.ok,
            `status ${iMix.status}`)
    }
  }

  // ── El texto del motivo, sin red ──
  check('motivoCarga traduce el rechazo de la tabla',
        /permiso/.test(motivoCarga({ code: '42501',
          message: 'new row violates row-level security policy for table "vehiculo_archivo"' })),
        motivoCarga({ code: '42501', message: 'new row violates row-level security policy' }))
  check('motivoCarga traduce el rechazo del bucket',
        /permiso/.test(motivoCarga({ statusCode: '403', error: 'Unauthorized',
          message: 'new row violates row-level security policy' })))
  check('motivoCarga avisa cuando el archivo es grande',
        /grande/.test(motivoCarga({ statusCode: '413',
          message: 'The object exceeded the maximum allowed size' })))
  check('motivoCarga avisa cuando se corta la conexión',
        /conexión/.test(motivoCarga(new TypeError('Failed to fetch'))))
  check('motivoCarga nunca devuelve vacío', !!motivoCarga({}) && !!motivoCarga(null),
        `${motivoCarga({})} / ${motivoCarga(null)}`)
  check('motivoCarga no inventa un permiso que no falló',
        !/permiso/.test(motivoCarga({ message: 'algo raro pasó' })),
        motivoCarga({ message: 'algo raro pasó' }))
}

// ── 15. La carga múltiple no relajó nada ──────────────────────────
// El cambio es de pantalla. Las garantías de la base tienen que seguir dando
// exactamente lo mismo que antes, también cuando se manda una tanda.
console.log('\n15. LA TANDA NO ES UNA PUERTA NUEVA')
{
  const { body: proc } = await rest(duena,
    'vehiculo?etapa=eq.terminacion&select=id,empresa_id&limit=1')
  if (!proc?.length) { console.log('  (sin vehículo en terminación)') }
  else {
    const W = proc[0]
    const base = `${W.empresa_id}/${W.id}`

    // Diez facturas de una no hacen que el operario pueda subir ninguna.
    for (const n of [0, 1, 2]) {
      const ruta = `${base}/factura-${marca}-tanda${n}.pdf`
      const s = await subir(operario, ruta, 'x', 'application/pdf')
      const i = await rest(operario, 'vehiculo_archivo', {
        method: 'POST', body: JSON.stringify({ vehiculo_id: W.id, tipo: 'factura', path: ruta }) })
      check(`el operario sigue sin poder subir la factura ${n + 1} de la tanda`,
            !s.ok && !i.ok, `bucket ${s.status} / ficha ${i.status}`)
    }

    // Y adjuntar de a varios tampoco mueve al vehículo.
    const { body: q } = await rest(duena, `vehiculo?id=eq.${W.id}&select=etapa`)
    check('una tanda no mueve al vehículo', q?.[0]?.etapa === 'terminacion', q?.[0]?.etapa)
  }
}

console.log(`\n${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:\n  - ' + fallos.join('\n  - '))
