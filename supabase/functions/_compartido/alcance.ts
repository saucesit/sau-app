/**
 * Hasta dónde llega un cliente administrando su propio equipo.
 *
 * Las mismas dos listas que hace cumplir el trigger sau_guardia_membresia en
 * la base (migración 0038). Se repiten acá porque las edge functions corren con
 * service_role y el trigger no las alcanza: si cambia una, cambian las dos.
 */

export const PERMISOS_RESERVADOS_SAU = [
  'empresa.admin',    // el perfil Completo
  'empresa.rrhh',
  'taller.eliminar',  // borrar un vehículo se lleva su historial
  'taller.anular',    // va con el perfil Completo, que asigna SAU
]

export const PERMISOS_ASIGNABLES_POR_CLIENTE = [
  'ventas.ver', 'ventas.crear', 'ventas.confirmar',
  'caja.ver', 'caja.crear', 'caja.operar',
  'compras.ver', 'compras.crear',
  'stock.ver',
  'fiado.ver', 'fiado.crear',
  'reportes.ver',
  'equipo.ver',
  'taller.ver', 'taller.cargar', 'taller.trabajar', 'taller.validar', 'taller.montos',
]

export const ROLES_ASIGNABLES_POR_CLIENTE = ['empleado', 'dueno']
export const ETAPAS_VALIDAS = ['chapa', 'preparacion', 'pintura', 'terminacion']

/**
 * Revisa lo que pide quien llama. Devuelve un mensaje si algo no corresponde,
 * o null si está todo bien.
 *
 * NO limpia la solicitud en silencio: si alguien pide algo que no puede, se le
 * dice. Un filtrado mudo que devuelve éxito deja a quien administra creyendo
 * que asignó algo que en realidad no asignó.
 */
export function revisarAlcance(
  datos: { permisos?: string[]; rol?: string; taller_etapas?: string[] },
  esSau: boolean,
): string | null {
  if (esSau) return null

  const pedidos = datos.permisos || []

  const reservados = pedidos.filter((p) => PERMISOS_RESERVADOS_SAU.includes(p))
  if (reservados.length) {
    return `Estos permisos los asigna SAU: ${reservados.join(', ')}. ` +
      'Si hace falta, pedínoslo y lo hacemos nosotros.'
  }

  const desconocidos = pedidos.filter((p) => !PERMISOS_ASIGNABLES_POR_CLIENTE.includes(p))
  if (desconocidos.length) {
    return `Permisos no autorizados: ${desconocidos.join(', ')}.`
  }

  if (datos.rol && !ROLES_ASIGNABLES_POR_CLIENTE.includes(datos.rol)) {
    return `El rol "${datos.rol}" lo asigna SAU.`
  }

  const etapasMal = (datos.taller_etapas || []).filter((e) => !ETAPAS_VALIDAS.includes(e))
  if (etapasMal.length) {
    return `Etapas inválidas: ${etapasMal.join(', ')}.`
  }

  return null
}

/** ¿Quien llama es administrador global de SAU? */
export async function esAdminSau(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin.from('profile').select('es_sau_admin').eq('id', userId).maybeSingle()
  return data?.es_sau_admin === true
}

/**
 * ¿Esta persona puede gestionar el equipo de ESTA empresa, ahora?
 *
 * Se consulta siempre contra la base, nunca contra lo que diga el pedido, y se
 * vuelve a consultar en cada llamada: una invitación emitida hace un mes no
 * prueba que quien la emitió siga autorizado hoy.
 */
export async function puedeGestionarEquipo(admin: any, userId: string, empresaId: string) {
  if (await esAdminSau(admin, userId)) return { ok: true, esSau: true }

  const { data: mem } = await admin
    .from('membresia')
    .select('rol, permisos, activa')
    .eq('empresa_id', empresaId)
    .eq('usuario_id', userId)
    .eq('activa', true)
    .maybeSingle()

  const puede = !!mem && (
    ['admin', 'contadora'].includes(mem.rol) || mem.permisos?.includes('empresa.admin')
  )
  return { ok: puede, esSau: false }
}
