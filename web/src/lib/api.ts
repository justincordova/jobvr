import { createClient } from '@jobvr/api/client'

export const api = createClient(window.location.origin)

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type JsonOf<R> = R extends { json(): Promise<infer J> } ? J : never
export type DataOf<R> = Extract<JsonOf<R>, { success: true }> extends { data: infer D } ? D : never

/** Awaits an RPC call and returns `data`, throwing ApiError for error envelopes. */
export async function unwrap<R extends { json(): Promise<unknown>; status: number }>(
  call: Promise<R>,
): Promise<DataOf<R>> {
  const res = await call
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ApiError(res.status, `Unexpected response (${res.status})`)
  }
  if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true) {
    const b = (body ?? {}) as { message?: string; error?: string }
    throw new ApiError(res.status, b.message ?? b.error ?? `Request failed (${res.status})`)
  }
  return (body as unknown as { data: DataOf<R> }).data
}

export const queryKeys = {
  jobs: (params: object) => ['jobs', params] as const,
  allJobs: ['jobs'] as const,
  applications: ['applications'] as const,
  companies: ['companies'] as const,
  suggestions: ['suggestions'] as const,
  settings: ['settings'] as const,
}
