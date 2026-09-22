import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import '../../styles/taller.css'

/**
 * Armazón propio del módulo Taller.
 *
 * El taller no usa el Layout de SAU a propósito: necesita el ancho completo de
 * la pantalla para mostrar las seis etapas a la vez, y tiene su propia
 * identidad visual. Al vivir fuera, no hay forma de que sus estilos o su ancho
 * toquen Ventas, Caja, Stock, Fiado ni Presupuestos.
 *
 * Solo entran las empresas con el módulo activo. Hoy eso es TALLER FORANI;
 * no está atado a su id para que el segundo taller que entre funcione solo.
 */

function Icono({ d, children }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {children || <path d={d} />}
    </svg>
  )
}

export default function TallerLayout() {
  const { tieneModulo, tienePermiso, empresaActiva } = useAuth()
  const navigate = useNavigate()

  if (!tieneModulo('taller')) return <Navigate to="/" replace />

  const inicial = (empresaActiva?.nombre_fantasia || empresaActiva?.razon_social || 'T')
    .trim().charAt(0).toUpperCase()

  // NavLink ya marca aria-current="page" cuando la ruta está activa, y el CSS
  // se cuelga de ese atributo: no hace falta una clase extra.
  const claseRail = 't-rail-btn'

  return (
    <div className="taller-ui">
      <div className="t-app">

        <nav className="t-rail" aria-label="Secciones del taller">
          <button className="t-mark" onClick={() => navigate('/')} title="Volver a SAU">
            {inicial}
          </button>

          <NavLink to="/taller" end className={claseRail} title="Pizarra"
                   aria-label="Pizarra de producción">
            <Icono>
              <rect x="1.5" y="2" width="4" height="12" />
              <rect x="6.8" y="2" width="4" height="8" />
              <rect x="12.1" y="2" width="2.4" height="5" />
            </Icono>
            <span className="t-rail-label">PIZARRA</span>
          </NavLink>

          <NavLink to="/taller/nuevo" className={claseRail} title="Ingresar vehículo"
                   aria-label="Ingresar vehículo">
            <Icono d="M8 2.5v11M2.5 8h11" />
            <span className="t-rail-label">INGRESO</span>
          </NavLink>

          {/* Administración del taller: solo para el dueño o quien él habilite */}
          {tienePermiso('empresa.admin') && (
            <NavLink to="/taller/admin" className={claseRail} title="Administración"
                     aria-label="Administración del taller">
              <Icono>
                <circle cx="6" cy="5" r="2.4" />
                <path d="M1.8 13.5c0-2.3 1.9-4 4.2-4s4.2 1.7 4.2 4" />
                <circle cx="12" cy="6.5" r="1.7" />
                <path d="M10.6 12.2c.3-1.5 1.5-2.4 2.9-2.2" />
              </Icono>
              <span className="t-rail-label">ADMIN</span>
            </NavLink>
          )}

          <div className="t-rail-foot">SAU<br />01</div>
        </nav>

        <div className="t-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
