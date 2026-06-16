import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROLES_LABEL = {
  empleado: 'Empleado',
  dueno: 'Dueño',
  contadora: 'Contadora',
  admin: 'Admin',
}

const TITULOS = {
  '/vender':              'Nueva venta',
  '/caja':                'Caja',
  '/historial':           'Historial',
  '/compras':             'Compras y Gastos',
  '/equipo':              'Mi equipo',
  '/contadora':           'Mis clientes',
  '/perfil':              'Mi negocio',
  '/presupuestos':        'Presupuestos',
  '/presupuestos/nuevo':  'Nuevo presupuesto',
}

// Todas las pestañas posibles.
// permiso: null → siempre visible si el módulo está activo
// modulo:  null → no depende de módulo (Inicio, Clientes)
const TODAS_LAS_TABS = [
  { to: '/',          icon: '🏠', label: 'Inicio',    end: true,  permiso: null,                modulo: null },
  { to: '/vender',    icon: '🛒', label: 'Vender',    end: false, permiso: 'ventas.crear',      modulo: 'ventas' },
  { to: '/caja',      icon: '💵', label: 'Caja',      end: false, permiso: 'caja.ver',          modulo: 'caja' },
  { to: '/historial', icon: '📋', label: 'Historial', end: false, permiso: 'ventas.ver',        modulo: 'ventas' },
  { to: '/compras',   icon: '🛍️', label: 'Compras',   end: false, permiso: 'compras.crear',    modulo: 'compras' },
  { to: '/equipo',    icon: '👥', label: 'Equipo',    end: false, permiso: 'empresa.admin',     modulo: 'equipo' },
  { to: '/stock',     icon: '📦', label: 'Stock',     end: false, permiso: 'ventas.ver',        modulo: 'stock' },
  { to: '/fiado',         icon: '📒', label: 'Fiado',        end: false, permiso: 'ventas.crear',     modulo: 'fiado'        },
  { to: '/presupuestos', icon: '📄', label: 'Presupuestos', end: false, permiso: 'ventas.crear',  modulo: 'presupuestos' },
  { to: '/contadora',    icon: '📊', label: 'Clientes',     end: false, permiso: 'contadora.panel', modulo: null },
  { to: '/importar',  icon: '🔄', label: 'Importar',  end: false, permiso: 'empresa.admin',     modulo: ['ventas', 'stock'] },
]

// En estas rutas mostramos botón volver (pantallas de acción o detalle)
const RUTAS_CON_VOLVER = ['/vender', '/caja']

function TabBar({ tabs }) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] bg-zinc-900/95 backdrop-blur border-t border-zinc-800 flex z-50">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-semibold transition-all ${
              isActive ? 'text-emerald-400 scale-105' : 'text-zinc-500'
            }`
          }
        >
          <span className="text-xl leading-none">{t.icon}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { empresaActiva, profile, rol, tienePermiso, tieneModulo, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Mostrar tab solo si el módulo está activo en la empresa Y el usuario tiene permiso.
  // t.modulo puede ser null (siempre visible), un string, o un array (basta con uno activo).
  const moduloActivo = (m) =>
    m === null || (Array.isArray(m) ? m.some(x => tieneModulo(x)) : tieneModulo(m))
  const tabs = TODAS_LAS_TABS.filter(t =>
    moduloActivo(t.modulo) &&
    (t.permiso === null || tienePermiso(t.permiso))
  )

  const esInicio         = location.pathname === '/'
  const esDetalleCliente  = location.pathname.startsWith('/contadora/') && location.pathname !== '/contadora'
  const esDetalleTareas   = location.pathname.startsWith('/equipo/tareas/')
  const esDetallePresup   = /^\/presupuestos\/[^/]+$/.test(location.pathname) && location.pathname !== '/presupuestos/nuevo'
  const conVolver         = RUTAS_CON_VOLVER.includes(location.pathname) || esDetalleCliente || esDetalleTareas || esDetallePresup || location.pathname === '/perfil' || location.pathname === '/presupuestos/nuevo'
  const volverA           = esDetalleCliente ? '/contadora' : esDetalleTareas ? '/equipo' : esDetallePresup ? '/presupuestos' : location.pathname === '/presupuestos/nuevo' ? '/presupuestos' : '/'
  const labelVolver       = esDetalleCliente ? '← Clientes' : esDetalleTareas ? '← Equipo' : (esDetallePresup || location.pathname === '/presupuestos/nuevo') ? '← Presupuestos' : '← Inicio'
  const titulo            = TITULOS[location.pathname] || (esDetalleCliente ? 'Detalle cliente' : esDetalleTareas ? 'Configurar tareas' : esDetallePresup ? 'Presupuesto' : '')

  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-zinc-950 pb-24">

      {/* Header */}
      <header className="bg-zinc-900 text-white px-5 pt-5 pb-6 rounded-b-[2rem] border-b border-zinc-800 shadow-xl sticky top-0 z-40">
        {esInicio ? (
          <div className="flex justify-between items-center">
            <div>
              <p className="text-[0.65rem] uppercase tracking-widest text-emerald-400 mb-0.5">
                {empresaActiva ? empresaActiva.nombre_fantasia || empresaActiva.razon_social : 'Sin empresa'}
              </p>
              <h1 className="text-xl font-extrabold leading-tight">
                Hola{profile?.nombre ? `, ${profile.nombre}` : ''} 👋
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {rol && (
                <span className="text-[0.65rem] bg-white/20 px-2.5 py-1 rounded-full font-semibold">
                  {ROLES_LABEL[rol] || rol}
                </span>
              )}
              {tienePermiso('empresa.admin') && (
                <Link
                  to="/perfil"
                  className="text-lg bg-white/20 hover:bg-white/30 active:scale-95 px-2.5 py-1 rounded-full transition-all"
                  title="Configuración del negocio"
                >
                  ⚙️
                </Link>
              )}
              <button
                onClick={signOut}
                className="text-[0.65rem] bg-white/20 hover:bg-white/30 active:scale-95 px-2.5 py-1 rounded-full font-semibold transition-all"
              >
                Salir
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {conVolver && (
                <button
                  onClick={() => navigate(volverA)}
                  className="bg-zinc-800 text-zinc-200 border border-zinc-700 font-bold text-sm px-4 py-2 rounded-2xl active:scale-95 transition-all"
                >
                  {labelVolver}
                </button>
              )}
              <h1 className="text-xl font-extrabold">{titulo}</h1>
            </div>
            <button
              onClick={signOut}
              className="text-[0.65rem] bg-white/20 hover:bg-white/30 active:scale-95 px-2.5 py-1 rounded-full font-semibold transition-all"
            >
              Salir
            </button>
          </div>
        )}
      </header>

      {/* Banner modo práctica */}
      {empresaActiva?.modo_simulacion && (
        <div className="bg-amber-400 text-amber-900 text-xs font-bold text-center py-2 px-4 flex items-center justify-center gap-2">
          <span>🟡</span>
          MODO PRÁCTICA — estos datos no afectan tus declaraciones fiscales
        </div>
      )}

      <main className="px-4 pt-5">
        <Outlet />
      </main>

      <TabBar tabs={tabs} />
    </div>
  )
}
