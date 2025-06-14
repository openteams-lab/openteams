import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { authStorage, logout } from '@/lib/auth'
import { ArrowLeft, FolderOpen, Users, LogOut } from 'lucide-react'

interface NavbarProps {
  onLogout: () => void
}

export function Navbar({ onLogout }: NavbarProps) {
  const location = useLocation()
  const currentUser = authStorage.getUser()
  const isHome = location.pathname === '/'

  const handleLogout = () => {
    logout()
    onLogout()
  }

  return (
    <div className="border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-6">
            <h2 className="text-lg font-semibold">Bloop</h2>
            <div className="flex items-center space-x-1">
              <Button
                asChild
                variant={location.pathname === '/projects' ? 'default' : 'ghost'}
                size="sm"
              >
                <Link to="/projects">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Projects
                </Link>
              </Button>
              {currentUser?.is_admin && (
                <Button
                  asChild
                  variant={location.pathname === '/users' ? 'default' : 'ghost'}
                  size="sm"
                >
                  <Link to="/users">
                    <Users className="mr-2 h-4 w-4" />
                    Users
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-muted-foreground">
              Welcome, {currentUser?.email}
            </div>
            {!isHome && (
              <Button asChild variant="ghost">
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Home
                </Link>
              </Button>
            )}
            <Button variant="ghost" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
