import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { User, ApiResponse } from 'shared/types'
import { UserForm } from '@/components/users/user-form'
import { makeAuthenticatedRequest, authStorage } from '@/lib/auth'
import { Plus, Edit, Trash2, Calendar, AlertCircle, Loader2, Shield, User as UserIcon } from 'lucide-react'

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const currentUser = authStorage.getUser()

  const fetchUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await makeAuthenticatedRequest('/api/users')
      const data: ApiResponse<User[]> = await response.json()
      if (data.success && data.data) {
        setUsers(data.data)
      } else {
        setError('Failed to load users')
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to delete user "${email}"? This action cannot be undone.`)) return

    try {
      const response = await makeAuthenticatedRequest(`/api/users/${id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchUsers()
      } else if (response.status === 403) {
        setError('You cannot delete this user')
      } else {
        setError('Failed to delete user')
      }
    } catch (error) {
      console.error('Failed to delete user:', error)
      setError('Failed to delete user')
    }
  }

  const handleEdit = (user: User) => {
    setEditingUser(user)
    setShowForm(true)
  }

  const handleFormSuccess = () => {
    setShowForm(false)
    setEditingUser(null)
    fetchUsers()
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        {currentUser?.is_admin && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <UserIcon className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No users found</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Get started by creating the first user account.
            </p>
            {currentUser?.is_admin && (
              <Button
                className="mt-4"
                onClick={() => setShowForm(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add your first user
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {users.map((user) => (
            <Card key={user.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg flex items-center">
                    {user.is_admin ? (
                      <Shield className="mr-2 h-4 w-4 text-orange-500" />
                    ) : (
                      <UserIcon className="mr-2 h-4 w-4 text-blue-500" />
                    )}
                    {user.email}
                  </CardTitle>
                  <Badge variant={user.is_admin ? "default" : "secondary"}>
                    {user.is_admin ? "Admin" : "User"}
                  </Badge>
                </div>
                <CardDescription className="flex items-center">
                  <Calendar className="mr-1 h-3 w-3" />
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(user)}
                    className="h-8"
                  >
                    <Edit className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  {currentUser?.is_admin && currentUser.id !== user.id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(user.id, user.email)}
                      className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <UserForm
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingUser(null)
        }}
        onSuccess={handleFormSuccess}
        user={editingUser}
      />
    </div>
  )
}
