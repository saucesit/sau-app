import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Registro from './pages/Registro'
import Dashboard from './pages/Dashboard'
import VentaNueva from './pages/VentaNueva'
import Caja from './pages/Caja'
import Historial from './pages/Historial'
import Compras from './pages/Compras'
import Equipo from './pages/Equipo'
import EquipoTareas from './pages/EquipoTareas'
import Stock from './pages/Stock'
import Fiado from './pages/Fiado'
import Contadora from './pages/Contadora'
import ContadoraEmpresa from './pages/ContadoraEmpresa'
import Perfil from './pages/Perfil'
import Unirse from './pages/Unirse'
import AdminSAU from './pages/AdminSAU'
import AdminContadora from './pages/AdminContadora'
import Landing from './pages/Landing'
import Respuesta from './pages/Respuesta'
import Importar from './pages/Importar'
import Onboarding from './pages/Onboarding'
import Cuestionario, { preguntasParaModulos } from './pages/Cuestionario'
import Presupuestos from './pages/Presupuestos'
import PresupuestoNuevo from './pages/PresupuestoNuevo'
import PresupuestoNuevoPlantilla from './pages/PresupuestoNuevoPlantilla'
import PresupuestoVer from './pages/PresupuestoVer'
import PedidoPublico from './pages/PedidoPublico'

// Elige el formulario de presupuesto según el modo de la empresa
function PresupuestoNuevoSwitch() {
  const { empresaActiva } = useAuth()
  return empresaActiva?.presupuesto_modo === 'plantillas'
    ? <PresupuestoNuevoPlantilla />
    : <PresupuestoNuevo />
}
import KioscoFiado from './App' // prototipo de fiado (Kiosco de Carlitos), se conserva intacto

// Flujo de primer ingreso:
//  1. Onboarding personalizado (si hay análisis IA)
//  2. Cuestionario de configuración (si no respondió todavía)
//  3. Dashboard normal
function DashboardOOnboarding() {
  const { empresaActiva } = useAuth()
  const ob     = empresaActiva?.onboarding
  const config = empresaActiva?.configuracion
  const mods   = empresaActiva?.modulos_activos || []

  // El cuestionario se arma según los módulos activos de la empresa:
  // cada cliente responde solo sobre lo suyo. Si no hay preguntas para
  // sus módulos, no se muestra.
  const necesitaCuestionario = preguntasParaModulos(mods).length > 0

  if (ob && !ob.completado)  return <Onboarding />
  if (necesitaCuestionario && (config === undefined || config === null)) return <Cuestionario />
  return <Dashboard />
}

function Splash() {
  return (
    <div className="max-w-[500px] mx-auto min-h-screen flex flex-col items-center justify-center bg-black gap-4">
      <img src="/logo.png" alt="SAU" className="w-32 rounded-2xl animate-pulse" />
    </div>
  )
}

// Requiere auth pero no empresa (para /registro)
function RequiereAuth({ children }) {
  const { user, loading, isSupabaseConfigured } = useAuth()
  if (!isSupabaseConfigured) return <Navigate to="/login" replace />
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Requiere ser SAU admin (solo Facundo)
function ProtegidoAdmin({ children }) {
  const { user, loading, perfilCargado, profile } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (!perfilCargado) return <Splash />
  if (!profile?.es_sau_admin) return <Navigate to="/login" replace />
  return children
}

// Requiere ser contadora SAU (Rocío y cualquier contadora futura)
function ProtegidoContadora({ children }) {
  const { user, loading, perfilCargado, profile } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (!perfilCargado) return <Splash />
  if (!profile?.es_sau_contadora && !profile?.es_sau_admin) return <Navigate to="/login" replace />
  return children
}

// Requiere auth + empresa configurada. Admin/contadora van directo a sus paneles.
function Protegido({ children }) {
  const { user, loading, perfilCargado, membresias, isSupabaseConfigured, profile } = useAuth()
  if (!isSupabaseConfigured) return <Navigate to="/login" replace />
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (!perfilCargado) return <Splash />
  if (profile?.es_sau_admin) return <Navigate to="/sau-admin" replace />
  if (profile?.es_sau_contadora) return <Navigate to="/contadora-admin" replace />
  if (membresias.length === 0) return <Navigate to="/registro" replace />
  return children
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<RequiereAuth><Registro /></RequiereAuth>} />
          <Route path="/unirse" element={<Unirse />} />
          <Route path="/prototipo" element={<KioscoFiado />} />
          <Route path="/quejate" element={<Landing />} />
          <Route path="/pedir/:empresaId" element={<PedidoPublico />} />
          <Route path="/r/:id" element={<Respuesta />} />

          <Route
            element={
              <Protegido>
                <Layout />
              </Protegido>
            }
          >
            <Route path="/" element={<DashboardOOnboarding />} />
            <Route path="/vender" element={<VentaNueva />} />
            <Route path="/caja" element={<Caja />} />
            <Route path="/historial" element={<Historial />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/equipo" element={<Equipo />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/fiado" element={<Fiado />} />
            <Route path="/presupuestos" element={<Presupuestos />} />
            <Route path="/presupuestos/nuevo" element={<PresupuestoNuevoSwitch />} />
            <Route path="/presupuestos/:id" element={<PresupuestoVer />} />
            <Route path="/equipo/tareas/:membresiaId" element={<EquipoTareas />} />
            <Route path="/contadora" element={<Contadora />} />
            <Route path="/contadora/:empresaId" element={<ContadoraEmpresa />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/importar" element={<Importar />} />
          </Route>

          <Route path="/sau-admin" element={<ProtegidoAdmin><AdminSAU /></ProtegidoAdmin>} />
          <Route path="/contadora-admin" element={<ProtegidoContadora><AdminContadora /></ProtegidoContadora>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
