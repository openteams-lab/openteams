import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LoginForm } from '@/components/auth/login-form'
import { Navbar } from '@/components/layout/navbar'
import { HomePage } from '@/pages/home'
import { Projects } from '@/pages/projects'
import { Users } from '@/pages/users'
import { isAuthenticated } from '@/lib/auth'

function AppContent() {
  const location = useLocation()
  const [authenticated, setAuthenticated] = useState(false)
  const showNavbar = location.pathname !== '/' || authenticated

  useEffect(() => {
    setAuthenticated(isAuthenticated())
  }, [])

  const handleLogin = () => {
    setAuthenticated(true)
  }

  const handleLogout = () => {
    setAuthenticated(false)
  }

  if (!authenticated) {
    return <LoginForm onSuccess={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-background">
      {showNavbar && <Navbar onLogout={handleLogout} />}
      <div className={showNavbar && location.pathname !== '/' ? "max-w-7xl mx-auto p-6 sm:p-8" : ""}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Projects />} />
          <Route path="/users" element={<Users />} />
        </Routes>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export default App
