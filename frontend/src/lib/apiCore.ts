// Shared HTTP helpers for the API adapter modules.

import type { ApiResponse } from '@/types';

export class ApiError<E = unknown> extends Error {
  constructor(
    message: string,
    public status?: number,
    public errorData?: E,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const makeRequest = async (
  url: string,
  options: RequestInit = {},
): Promise<Response> => {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
};

export const handleApiResponse = async <T, E = T>(
  response: Response,
): Promise<T> => {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let errorData: E | undefined;
    try {
      const body: Partial<ApiResponse<T, E>> & {
        error?: E;
        error_data?: E | null;
      } = await response.json();
      if (body?.message) message = body.message;
      errorData = body.error_data ?? body.error ?? undefined;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError<E>(message, response.status, errorData);
  }

  if (response.status === 204) return undefined as T;

  const result: ApiResponse<T, E> = await response.json();
  if (!result.success) {
    throw new ApiError<E>(
      result.message || 'API request failed',
      response.status,
      result.error_data ?? undefined,
    );
  }
  return result.data as T;
};

export const qs = (
  params: Record<string, string | number | boolean | null | undefined>,
): string => {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined,
  );
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
};

export const jsonBody = (data: unknown): string =>
  JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? Number(value) : value,
  );
