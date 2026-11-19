import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/toast'
import { api, queryKeys, unwrap } from '@/lib/api'
import { withViewTransition } from '@/lib/motion'
import type { Job, JobList } from '@/lib/types'

export type JobState = Job['state']

const JOB_STATE_KEY = ['job-state'] as const

const message = (from: JobState, to: JobState) => {
  if (to === 'applied') return 'Marked applied'
  if (to === 'saved') return 'Saved for later'
  if (to === 'hidden') return 'Hidden from your feed'
  return from === 'saved' ? 'Removed from saved' : 'Back in your feed'
}

/** Save / hide / applied and their reversals, all optimistic with Undo. */
export function useJobActions() {
  const qc = useQueryClient()
  const toast = useToast()

  const setState = useMutation({
    mutationKey: JOB_STATE_KEY,
    // One request at a time, in order: a quick Save then Undo can't land reversed.
    // The optimistic update still shows at once (onMutate isn't queued)
    scope: { id: 'job-state' },
    // `also`: reposts of the same role shown on this row; they move together
    mutationFn: ({
      id,
      state,
      also = [],
    }: {
      id: string
      state: JobState
      also?: string[]
      silent?: boolean
    }) =>
      Promise.all(
        [id, ...also].map((jobId) =>
          unwrap(api.api.jobs[':id'].$patch({ param: { id: jobId }, json: { state } })),
        ),
      ),
    // Moves the job in every cached list, animating rows in or out of the current view
    onMutate: async ({ id, state, also = [] }) => {
      await qc.cancelQueries({ queryKey: queryKeys.allJobs })
      const cached = qc
        .getQueriesData<JobList>({ queryKey: queryKeys.allJobs })
        .flatMap(([, list]) => list?.jobs ?? [])
      const ids = [id, ...also]
      // Only these jobs are put back on error, so other quick actions aren't undone too
      const before = new Map<string, Pick<Job, 'state' | 'appliedAt'>>()
      for (const j of cached) {
        if (ids.includes(j.id) && !before.has(j.id)) {
          before.set(j.id, { state: j.state, appliedAt: j.appliedAt })
        }
      }
      const prev = before.get(id)?.state ?? 'new'
      await withViewTransition(() =>
        qc.setQueriesData<JobList>({ queryKey: queryKeys.allJobs }, (list) =>
          list
            ? {
                ...list,
                jobs: list.jobs.map((j) =>
                  j.id === id || also.includes(j.id)
                    ? {
                        ...j,
                        state,
                        appliedAt:
                          state === 'applied' ? (j.appliedAt ?? new Date().toISOString()) : null,
                      }
                    : j,
                ),
              }
            : list,
        ),
      )
      return { before, prev }
    },
    onError: (err, _vars, ctx) => {
      const before = ctx?.before
      if (before) {
        qc.setQueriesData<JobList>({ queryKey: queryKeys.allJobs }, (list) =>
          list
            ? {
                ...list,
                jobs: list.jobs.map((j) => {
                  const was = before.get(j.id)
                  return was ? { ...j, ...was } : j
                }),
              }
            : list,
        )
      }
      toast.error(err.message)
    },
    onSuccess: (_d, { id, state, also, silent }, ctx) => {
      if (silent || !ctx) return
      const prev = ctx.prev
      toast.undoable(message(prev, state), {
        undo: () => setState.mutate({ id, state: prev, also, silent: true }),
      })
    },
    // Refetch once the last of several quick actions settles: an earlier one's
    // refetch would bring back a row hidden after it was sent
    onSettled: () => {
      if (qc.isMutating({ mutationKey: JOB_STATE_KEY }) === 1) {
        return qc.invalidateQueries({ queryKey: queryKeys.allJobs })
      }
    },
  })

  return { setState }
}
