import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
}

function App() {
  const [message, setMessage] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const fetchHello = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/hello?name=Bloop')
      const data = await response.json()
      setMessage(data.message)
    } catch (error) {
      setMessage('Error connecting to backend')
    } finally {
      setLoading(false)
    }
  }

  const checkHealth = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/health')
      const data: ApiResponse<string> = await response.json()
      setMessage(data.message || 'Health check completed')
    } catch (error) {
      setMessage('Backend health check failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to Bloop</CardTitle>
            <CardDescription>
              A full-stack monorepo with Rust backend and React frontend
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button onClick={fetchHello} disabled={loading}>
                Say Hello
              </Button>
              <Button onClick={checkHealth} variant="outline" disabled={loading}>
                Check Health
              </Button>
            </div>
            {message && (
              <div className="p-4 bg-muted rounded-md">
                <p className="text-sm">{message}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
