import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROLES_LABEL = {
  empleado: 'Empleado',
  dueno: 'Dueño',
  contadora: 'Contadora',
  admin: 'Admin',
}

const TITULOS = {
  '/vender':    'Nueva venta',
  '/caja':      'Caja',
  '/historial': 'Historial',
  '/compras':   'Compras y Gastos',
  '/equipo':    'Mi equipo',
  '/contadora': 'Mis clientes',
  '/perfil':    'Mi negocio',
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
  { to: '/fiado',     icon: '📒', label: 'Fiado',     end: false, permiso: 'ventas.crear',      modulo: 'fiado' },
  { to: '/contadora', icon: '📊', label: 'Clientes',  end: false, permiso: 'contadora.panel',  modulo: null },
]

// En estas rutas mostramos botón volver (pantallas de acción o detalle)
const RUTAS_CON_VOLVER = ['/vender', '/caja']

function TabBar({ tabs }) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] bg-white/90 backdrop-blur border-t border-slate-100 flex z-50">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-semibold transition-all ${
              isActive ? 'text-indigo-600 scale-105' : 'text-slate-400'
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

  // Mostrar tab solo si el módulo está activo en la empresa Y el usuario tiene permiso
  const tabs = TODAS_LAS_TABS.filter(t =>
    (t.modulo === null || tieneModulo(t.modulo)) &&
    (t.permiso === null || tienePermiso(t.permiso))
  )

  const esInicio         = location.pathname === '/'
  const esDetalleCliente = location.pathname.startsWith('/contadora/') && location.pathname !== '/contadora'
  const esDetalleTareas  = location.pathname.startsWith('/equipo/tareas/')
  const conVolver        = RUTAS_CON_VOLVER.includes(location.pathname) || esDetalleCliente || esDetalleTareas || location.pathname === '/perfil'
  const volverA          = esDetalleCliente ? '/contadora' : esDetalleTareas ? '/equipo' : '/'
  const labelVolver      = esDetalleCliente ? '← Clientes' : esDetalleTareas ? '← Equipo' : '← Inicio'
  const titulo           = TITULOS[location.pathname] || (esDetalleCliente ? 'Detalle cliente' : esDetalleTareas ? 'Configurar tareas' : '')

  return (
    <div className="max-w-[500px] mx-auto min-h-screen bg-slate-50 pb-24">

      {/* Header */}
      <header className="bg-indigo-600 text-white px-5 pt-5 pb-6 rounded-b-[2rem] shadow-xl sticky top-0 z-40">
        {esInicio ? (
          <div className="flex justify-between items-center">
            <div>
              <p className="text-[0.65rem] uppercase tracking-widest text-indigo-300 mb-0.5">
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
                  className="bg-white text-indigo-600 font-bold text-sm px-4 py-2 rounded-2xl shadow-md active:scale-95 transition-all"
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
