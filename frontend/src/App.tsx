import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LoginForm } from '@/components/auth/login-form'
import { Navbar } from '@/components/layout/navbar'
import { HomePage } from '@/pages/home'
import { Projects } from '@/pages/projects'
import { ProjectTasks } from '@/pages/project-tasks'
import { TaskDetailsPage } from '@/pages/task-details'
import { Users } from '@/pages/users'
import { AuthProvider, useAuth } from '@/contexts/auth-context'

function AppContent() {
  const location = useLocation()
  const { isAuthenticated, isLoading, logout } = useAuth()
  const showNavbar = location.pathname !== '/' || isAuthenticated

  const handleLogin = () => {
    // The actual login logic is handled by the LoginForm component
    // which will call the login method from useAuth()
  }

  // Show loading while checking auth status
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginForm onSuccess={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-background">
      {showNavbar && <Navbar onLogout={logout} />}
      <div className={showNavbar && location.pathname !== '/' ? "max-w-7xl mx-auto p-6 sm:p-8" : ""}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Projects />} />
          <Route path="/projects/:projectId/tasks" element={<ProjectTasks />} />
          <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailsPage />} />
          <Route path="/users" element={<Users />} />
        </Routes>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
