import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/toast'
import { api, queryKeys, unwrap } from '@/lib/api'
import { withViewTransition } from '@/lib/motion'
import type { Job, JobList } from '@/lib/types'

export type JobState = Job['state']

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
    mutationFn: ({ id, state }: { id: string; state: JobState; silent?: boolean }) =>
      unwrap(api.api.jobs[':id'].$patch({ param: { id }, json: { state } })),
    // Moves the job in every cached list, animating rows in or out of the current view
    onMutate: async ({ id, state }) => {
      await qc.cancelQueries({ queryKey: queryKeys.allJobs })
      const snapshot = qc.getQueriesData<JobList>({ queryKey: queryKeys.allJobs })
      const prev =
        snapshot.flatMap(([, list]) => list?.jobs ?? []).find((j) => j.id === id)?.state ?? 'new'
      await withViewTransition(() =>
        qc.setQueriesData<JobList>({ queryKey: queryKeys.allJobs }, (list) =>
          list
            ? { ...list, jobs: list.jobs.map((j) => (j.id === id ? { ...j, state } : j)) }
            : list,
        ),
      )
      return { snapshot, prev }
    },
    onError: (err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
      toast.error(err.message)
    },
    onSuccess: (_d, { id, state, silent }, ctx) => {
      if (silent || !ctx) return
      const prev = ctx.prev
      toast.undoable(message(prev, state), {
        undo: () => setState.mutate({ id, state: prev, silent: true }),
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.allJobs }),
  })

  return { setState }
}
