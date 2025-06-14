import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Project, ApiResponse } from 'shared/types'
import { ProjectForm } from './project-form'
import { Plus, Edit, Trash2, Calendar, AlertCircle, Loader2, CheckSquare } from 'lucide-react'

export function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [error, setError] = useState('')

  const fetchProjects = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/projects')
      const data: ApiResponse<Project[]> = await response.json()
      if (data.success && data.data) {
        setProjects(data.data)
      } else {
        setError('Failed to load projects')
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) return

    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchProjects()
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
      setError('Failed to delete project')
    }
  }

  const handleEdit = (project: Project) => {
    setEditingProject(project)
    setShowForm(true)
  }

  const handleFormSuccess = () => {
    setShowForm(false)
    setEditingProject(null)
    fetchProjects()
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage your projects and track their progress
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Project
        </Button>
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
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Plus className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No projects yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Get started by creating your first project.
            </p>
            <Button
              className="mt-4"
              onClick={() => setShowForm(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create your first project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle 
                    className="text-lg cursor-pointer hover:text-primary"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    {project.name}
                  </CardTitle>
                  <Badge variant="secondary" className="ml-2">
                    Active
                  </Badge>
                </div>
                <CardDescription className="flex items-center">
                  <Calendar className="mr-1 h-3 w-3" />
                  Created {new Date(project.created_at).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/projects/${project.id}/tasks`)}
                    className="h-8"
                  >
                    <CheckSquare className="mr-1 h-3 w-3" />
                    Tasks
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(project)}
                    className="h-8"
                  >
                    <Edit className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(project.id, project.name)}
                    className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProjectForm
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingProject(null)
        }}
        onSuccess={handleFormSuccess}
        project={editingProject}
      />
    </div>
  )
}
