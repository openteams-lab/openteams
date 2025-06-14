// Shared types between frontend and backend
export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
}

export interface HelloResponse {
  message: string
}

export interface HelloQuery {
  name?: string
}

export interface Project {
  id: string
  name: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface CreateProject {
  name: string
}

export interface UpdateProject {
  name?: string
}

export interface User {
  id: string
  email: string
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface CreateUser {
  email: string
  password: string
  is_admin?: boolean
}

export interface UpdateUser {
  email?: string
  password?: string
  is_admin?: boolean
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  user: User
  token: string
}
