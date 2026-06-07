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
import Landing from './pages/Landing'
import KioscoFiado from './App' // prototipo de fiado (Kiosco de Carlitos), se conserva intacto

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
  if (loading || !perfilCargado) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (!profile?.es_sau_admin) return <Navigate to="/" replace />
  return children
}

// Requiere auth + empresa configurada. Sin empresa → onboarding.
function Protegido({ children }) {
  const { user, loading, perfilCargado, membresias, isSupabaseConfigured } = useAuth()
  if (!isSupabaseConfigured) return <Navigate to="/login" replace />
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (!perfilCargado) return <Splash />
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

          <Route
            element={
              <Protegido>
                <Layout />
              </Protegido>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/vender" element={<VentaNueva />} />
            <Route path="/caja" element={<Caja />} />
            <Route path="/historial" element={<Historial />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/equipo" element={<Equipo />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/fiado" element={<Fiado />} />
            <Route path="/equipo/tareas/:membresiaId" element={<EquipoTareas />} />
            <Route path="/contadora" element={<Contadora />} />
            <Route path="/contadora/:empresaId" element={<ContadoraEmpresa />} />
            <Route path="/perfil" element={<Perfil />} />
          </Route>

          <Route path="/sau-admin" element={<ProtegidoAdmin><AdminSAU /></ProtegidoAdmin>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
