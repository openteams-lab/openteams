import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ApiResponse } from 'shared/types'
import { authStorage, makeAuthenticatedRequest } from '@/lib/auth'
import { Heart, Activity, FolderOpen, Users, CheckCircle, AlertCircle, Zap, Shield, Code } from 'lucide-react'

export function HomePage() {
  const [message, setMessage] = useState<string>('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [loading, setLoading] = useState(false)
  
  const currentUser = authStorage.getUser()

  const fetchHello = async () => {
    setLoading(true)
    try {
      const response = await makeAuthenticatedRequest('/api/hello?name=Bloop')
      const data = await response.json()
      setMessage(data.message)
      setMessageType('success')
    } catch (error) {
      setMessage('Error connecting to backend')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const checkHealth = async () => {
    setLoading(true)
    try {
      const response = await makeAuthenticatedRequest('/api/health')
      const data: ApiResponse<string> = await response.json()
      setMessage(data.message || 'Health check completed')
      setMessageType('success')
    } catch (error) {
      setMessage('Backend health check failed')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl"></div>
                <div className="relative rounded-full bg-primary/10 p-4 border">
                  <Heart className="h-8 w-8 text-primary" />
                </div>
              </div>
            </div>
            <Badge variant="secondary" className="mb-4">
              <Zap className="mr-1 h-3 w-3" />
              Mission Control Dashboard
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight mb-4 bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
              Welcome to Bloop
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              A modern full-stack monorepo built with Rust backend and React frontend.
              Get started by exploring our features below.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Badge variant="outline" className="text-xs">
                <Shield className="mr-1 h-3 w-3" />
                Secure
              </Badge>
              <Badge variant="outline" className="text-xs">
                <Code className="mr-1 h-3 w-3" />
                Type-Safe
              </Badge>
              <Badge variant="outline" className="text-xs">
                <Activity className="mr-1 h-3 w-3" />
                Real-time
              </Badge>
            </div>
          </div>

          {/* Feature Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
            <Card className="group hover:shadow-lg transition-all duration-200 border-muted/50 hover:border-muted">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="rounded-lg bg-primary/10 p-2 mr-3 group-hover:bg-primary/20 transition-colors">
                      <Heart className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">API Test</CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-xs">Test</Badge>
                </div>
                <CardDescription>
                  Test the connection between frontend and backend
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={fetchHello} 
                  disabled={loading}
                  className="w-full group-hover:shadow-sm transition-shadow"
                  size="sm"
                >
                  <Heart className="mr-2 h-4 w-4" />
                  {loading ? 'Testing...' : 'Say Hello'}
                </Button>
              </CardContent>
            </Card>

            <Card className="group hover:shadow-lg transition-all duration-200 border-muted/50 hover:border-muted">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="rounded-lg bg-emerald-500/10 p-2 mr-3 group-hover:bg-emerald-500/20 transition-colors">
                      <Activity className="h-5 w-5 text-emerald-600" />
                    </div>
                    <CardTitle className="text-lg">Health Check</CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-xs">Monitor</Badge>
                </div>
                <CardDescription>
                  Monitor the health status of your backend services
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={checkHealth} 
                  variant="outline" 
                  disabled={loading}
                  className="w-full group-hover:shadow-sm transition-shadow"
                  size="sm"
                >
                  <Activity className="mr-2 h-4 w-4" />
                  {loading ? 'Checking...' : 'Check Health'}
                </Button>
              </CardContent>
            </Card>

            <Card className="group hover:shadow-lg transition-all duration-200 border-muted/50 hover:border-muted">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="rounded-lg bg-violet-500/10 p-2 mr-3 group-hover:bg-violet-500/20 transition-colors">
                      <FolderOpen className="h-5 w-5 text-violet-600" />
                    </div>
                    <CardTitle className="text-lg">Projects</CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-xs">CRUD</Badge>
                </div>
                <CardDescription>
                  Manage your projects with full CRUD operations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full group-hover:shadow-sm transition-shadow" size="sm">
                  <Link to="/projects">
                    <FolderOpen className="mr-2 h-4 w-4" />
                    View Projects
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {currentUser?.is_admin && (
              <Card className="group hover:shadow-lg transition-all duration-200 border-muted/50 hover:border-muted lg:col-span-2">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="rounded-lg bg-amber-500/10 p-2 mr-3 group-hover:bg-amber-500/20 transition-colors">
                        <Users className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          Users
                          <Badge variant="outline" className="text-xs">
                            <Shield className="mr-1 h-3 w-3" />
                            Admin Only
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Manage user accounts and permissions
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button asChild className="group-hover:shadow-sm transition-shadow" size="sm">
                    <Link to="/users">
                      <Users className="mr-2 h-4 w-4" />
                      Manage Users
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Status Alert */}
          {message && (
            <div className="max-w-2xl mx-auto mb-8">
              <Alert variant={messageType === 'error' ? 'destructive' : 'default'} className="border-muted/50">
                {messageType === 'error' ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                <AlertDescription className="font-medium">
                  {message}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Footer */}
          <Separator className="my-12 max-w-2xl mx-auto" />
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Built with ❤️ using modern technologies
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">Rust</Badge>
              <Badge variant="outline" className="text-xs">React</Badge>
              <Badge variant="outline" className="text-xs">TypeScript</Badge>
              <Badge variant="outline" className="text-xs">Tailwind CSS</Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
