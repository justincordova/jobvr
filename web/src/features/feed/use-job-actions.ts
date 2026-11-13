import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/toast'
import { api, queryKeys, unwrap } from '@/lib/api'
import { withViewTransition } from '@/lib/motion'
import type { Job, JobList } from '@/lib/types'

type JobState = Job['state']
type NextState = Exclude<JobState, 'applied'>

const message = (from: JobState, to: NextState) => {
  if (to === 'saved') return 'Saved for later'
  if (to === 'hidden') return 'Hidden from your feed'
  return from === 'hidden' ? 'Back in your feed' : 'Removed from saved'
}

/** Save / hide / unsave / unhide and Applied, all optimistic with Undo. */
export function useJobActions() {
  const qc = useQueryClient()
  const toast = useToast()

  // Optimistically moves a job to `state` in every cached list, animating rows in or out
  const move = async (id: string, state: JobState) => {
    await qc.cancelQueries({ queryKey: queryKeys.allJobs })
    const snapshot = qc.getQueriesData<JobList>({ queryKey: queryKeys.allJobs })
    const prev =
      snapshot.flatMap(([, list]) => list?.jobs ?? []).find((j) => j.id === id)?.state ?? 'new'
    await withViewTransition(() =>
      qc.setQueriesData<JobList>({ queryKey: queryKeys.allJobs }, (list) =>
        list ? { ...list, jobs: list.jobs.map((j) => (j.id === id ? { ...j, state } : j)) } : list,
      ),
    )
    return { snapshot, prev }
  }
  const rollback = (snapshot: [readonly unknown[], JobList | undefined][] | undefined) => {
    for (const [key, data] of snapshot ?? []) qc.setQueryData(key, data)
  }
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.allJobs })

  const setState = useMutation({
    mutationFn: ({ id, state }: { id: string; state: NextState; silent?: boolean }) =>
      unwrap(api.api.jobs[':id'].$patch({ param: { id }, json: { state } })),
    onMutate: ({ id, state }) => move(id, state),
    onError: (err, _vars, ctx) => {
      rollback(ctx?.snapshot)
      toast.error(err.message)
    },
    onSuccess: (_d, { id, state, silent }, ctx) => {
      if (silent || !ctx || ctx.prev === 'applied') return
      const prev = ctx.prev
      toast.undoable(message(prev, state), {
        undo: () => setState.mutate({ id, state: prev, silent: true }),
      })
    },
    onSettled: refresh,
  })

  const unapply = useMutation({
    mutationFn: async ({ appId, id, prev }: { appId: string; id: string; prev: NextState }) => {
      await unwrap(api.api.applications[':id'].$delete({ param: { id: appId } }))
      // Deleting the application returns the job to `new`; restore saved/hidden on top
      if (prev !== 'new') {
        await unwrap(api.api.jobs[':id'].$patch({ param: { id }, json: { state: prev } }))
      }
    },
    onMutate: ({ id, prev }) => move(id, prev),
    onError: (err, _vars, ctx) => {
      rollback(ctx?.snapshot)
      toast.error(err.message)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.applications })
      return refresh()
    },
  })

  const apply = useMutation({
    mutationFn: (id: string) => unwrap(api.api.jobs[':id'].apply.$post({ param: { id } })),
    onMutate: (id) => move(id, 'applied'),
    onError: (err, _id, ctx) => {
      rollback(ctx?.snapshot)
      toast.error(err.message)
    },
    onSuccess: (app, id, ctx) => {
      void qc.invalidateQueries({ queryKey: queryKeys.applications })
      const prev = ctx?.prev === 'applied' || !ctx ? 'new' : ctx.prev
      toast.undoable(`${app.companyName} added to Applications`, {
        undo: () => unapply.mutate({ appId: app.id, id, prev }),
      })
    },
    onSettled: refresh,
  })

  return { setState, apply }
}
