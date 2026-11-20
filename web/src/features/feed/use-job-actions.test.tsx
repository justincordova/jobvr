import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/toast'
import { queryKeys } from '@/lib/api'
import type { Job, JobList } from '@/lib/types'
import { useJobActions } from './use-job-actions'

const APPLIED_AT = '2026-11-02T15:00:00.000Z'
const KEY = queryKeys.jobs({ view: 'applied' })

const list = (job: Partial<Job>) =>
  ({ jobs: [{ id: 'gh:1', state: 'applied', appliedAt: APPLIED_AT, ...job }], total: 1 }) as JobList

const appliedAt = (qc: QueryClient) => qc.getQueryData<JobList>(KEY)?.jobs[0]?.appliedAt

describe('useJobActions', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, data: {} })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('puts the original applied date back on Undo of Not applied', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    qc.setQueryData(KEY, list({}))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useJobActions(), { wrapper })

    act(() => result.current.setState.mutate({ id: 'gh:1', state: 'new' }))
    await waitFor(() => expect(result.current.setState.isSuccess).toBe(true))
    expect(appliedAt(qc)).toBeNull()

    act(() => void toast.undoLatest())
    await waitFor(() => expect(qc.getQueryData<JobList>(KEY)?.jobs[0]?.state).toBe('applied'))
    expect(appliedAt(qc)).toBe(APPLIED_AT)
  })
})
