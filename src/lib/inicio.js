/**
 * A qué pantalla entra cada usuario después del login.
 *
 * SAU es una plataforma de varios módulos, pero la mayoría de los clientes usa
 * uno solo: Forani el taller, Fede presupuestos, el kiosco el fiado. Para ellos
 * el Inicio general no agrega nada — y en el caso del taller directamente
 * mentía, porque el Dashboard no conocía ese módulo y mostraba "Todavía no hay
 * módulos activos".
 *
 * ESTO ES NAVEGACIÓN, NO AUTORIZACIÓN. Decide a dónde se manda a alguien y qué
 * pantallas tiene sentido que abra. Lo que puede HACER lo siguen decidiendo sus
 * permisos y las policies de la base, que no se tocan desde acá.
 */

/** Dónde vive cada módulo. Un módulo sin ruta no puede ser pantalla de entrada. */
export const RUTA_MODULO = {
  ventas:       '/vender',
  caja:         '/caja',
  compras:      '/compras',
  equipo:       '/equipo',
  stock:        '/stock',
  fiado:        '/fiado',
  presupuestos: '/presupuestos',
  taller:       '/taller',
  // 'agente' no tiene pantalla propia todavía: queda fuera a propósito.
}

/**
 * Qué módulo gobierna cada ruta, para la guardia de navegación.
 *
 * El prefijo cubre la ruta y todo lo que cuelga de ella: `/equipo` alcanza
 * también a `/equipo/tareas/:id`, que es parte del mismo módulo.
 *
 * Las rutas que no están acá no pertenecen a ningún módulo —Inicio, Perfil, el
 * panel de la contadora, Importar— y se dejan pasar: cerrarlas dejaría a
 * alguien sin forma de llegar a su propio perfil.
 */
export const MODULO_DE_RUTA = [
  { prefijo: '/vender',       modulo: 'ventas'       },
  { prefijo: '/historial',    modulo: 'ventas'       },
  { prefijo: '/caja',         modulo: 'caja'         },
  { prefijo: '/compras',      modulo: 'compras'      },
  { prefijo: '/stock',        modulo: 'stock'        },
  { prefijo: '/fiado',        modulo: 'fiado'        },
  { prefijo: '/presupuestos', modulo: 'presupuestos' },
  { prefijo: '/equipo',       modulo: 'equipo'       },
  { prefijo: '/taller',       modulo: 'taller'       },
]

/** El módulo al que pertenece una ruta, o null si no es de ningún módulo. */
export function moduloDeRuta(pathname) {
  const hit = MODULO_DE_RUTA.find(r =>
    pathname === r.prefijo || pathname.startsWith(r.prefijo + '/'))
  return hit?.modulo || null
}

/**
 * Qué permiso hace falta para que la pantalla de un módulo sirva de algo.
 * Son los mismos que ya filtran las pestañas en el Layout: si cambia uno, hay
 * que cambiar el otro, o alguien va a entrar a una pantalla que no puede usar.
 */
export const PERMISO_MODULO = {
  ventas:       'ventas.crear',
  caja:         'caja.ver',
  compras:      'compras.crear',
  equipo:       'empresa.admin',
  stock:        'ventas.ver',
  fiado:        'ventas.crear',
  presupuestos: 'ventas.crear',
  taller:       'taller.ver',
}

/**
 * La pantalla de entrada de una empresa.
 *
 * 1. Lo que diga `modulo_inicio`, si el usuario tiene el permiso de ese
 *    módulo. Esa comprobación evita el peor caso: mandar a alguien a una
 *    pantalla que no puede usar y dejarlo sin salida.
 * 2. Si no está configurado y hay exactamente un módulo activo con ruta, ese.
 * 3. Si no, el Inicio general.
 *
 * `tienePermiso` es opcional: sin ella se resuelve solo por configuración, que
 * es lo que sirve mientras los permisos todavía no se cargaron.
 */
export function rutaDeInicio(empresa, tienePermiso) {
  const modulos = empresa?.modulos_activos || []
  const sirve = (m) => {
    if (!RUTA_MODULO[m] || !modulos.includes(m)) return false
    const permiso = PERMISO_MODULO[m]
    return !tienePermiso || !permiso || tienePermiso(permiso)
  }

  if (empresa?.modulo_inicio && sirve(empresa.modulo_inicio)) {
    return RUTA_MODULO[empresa.modulo_inicio]
  }

  const conRuta = modulos.filter(m => RUTA_MODULO[m])
  if (conRuta.length === 1 && sirve(conRuta[0])) return RUTA_MODULO[conRuta[0]]

  return '/'
}
