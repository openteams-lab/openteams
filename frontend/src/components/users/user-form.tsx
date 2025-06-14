import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { User, CreateUser, UpdateUser } from 'shared/types'
import { makeAuthenticatedRequest, authStorage } from '@/lib/auth'
import { AlertCircle } from 'lucide-react'

interface UserFormProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  user?: User | null
}

export function UserForm({ open, onClose, onSuccess, user }: UserFormProps) {
  const [email, setEmail] = useState(user?.email || '')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(user?.is_admin || false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const currentUser = authStorage.getUser()
  const isEditing = !!user
  const canEditAdminStatus = currentUser?.is_admin && currentUser.id !== user?.id

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isEditing) {
        const updateData: UpdateUser = { 
          email: email !== user.email ? email : null,
          password: password ? password : null,
          is_admin: canEditAdminStatus && isAdmin !== user.is_admin ? isAdmin : null
        }
        
        // Remove null values
        Object.keys(updateData).forEach(key => {
          if (updateData[key as keyof UpdateUser] === null) {
            delete updateData[key as keyof UpdateUser]
          }
        })

        const response = await makeAuthenticatedRequest(`/api/users/${user.id}`, {
          method: 'PUT',
          body: JSON.stringify(updateData),
        })
        
        if (!response.ok) {
          throw new Error('Failed to update user')
        }
      } else {
        if (!password) {
          throw new Error('Password is required for new users')
        }

        const createData: CreateUser = { 
          email, 
          password,
          is_admin: currentUser?.is_admin ? isAdmin : false
        }
        
        const response = await makeAuthenticatedRequest('/api/users', {
          method: 'POST',
          body: JSON.stringify(createData),
        })
        
        if (!response.ok) {
          if (response.status === 409) {
            throw new Error('A user with this email already exists')
          }
          throw new Error('Failed to create user')
        }
      }

      onSuccess()
      resetForm()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setEmail(user?.email || '')
    setPassword('')
    setIsAdmin(user?.is_admin || false)
    setError('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit User' : 'Create New User'}
          </DialogTitle>
          <DialogDescription>
            {isEditing 
              ? 'Make changes to the user account here. Click save when you\'re done.'
              : 'Add a new user to the system. They will be able to log in with these credentials.'
            }
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email address"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">
              {isEditing ? 'New Password (leave blank to keep current)' : 'Password'}
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEditing ? "Enter new password" : "Enter password"}
              required={!isEditing}
            />
          </div>

          {canEditAdminStatus && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isAdmin"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="rounded border-gray-300"
              />
              <Label htmlFor="isAdmin" className="text-sm font-medium">
                Administrator privileges
              </Label>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !email.trim()}>
              {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
