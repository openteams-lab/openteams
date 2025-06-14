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
