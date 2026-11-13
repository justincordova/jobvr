import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/toast'
import { api, queryKeys, unwrap } from '@/lib/api'
import type { JobList } from '@/lib/types'

type NextState = 'saved' | 'hidden' | 'new'

const LABELS: Record<NextState, string> = {
  saved: 'Saved',
  hidden: 'Hidden',
  new: 'Moved back to the feed',
}

/** Save / hide / unsave / unhide (optimistic) and Applied. */
export function useJobActions() {
  const qc = useQueryClient()
  const toast = useToast()

  const setState = useMutation({
    mutationFn: ({ id, state }: { id: string; state: NextState }) =>
      unwrap(api.api.jobs[':id'].$patch({ param: { id }, json: { state } })),
    onMutate: async ({ id, state }) => {
      await qc.cancelQueries({ queryKey: queryKeys.allJobs })
      const snapshot = qc.getQueriesData<JobList>({ queryKey: queryKeys.allJobs })
      qc.setQueriesData<JobList>({ queryKey: queryKeys.allJobs }, (list) =>
        list ? { ...list, jobs: list.jobs.map((j) => (j.id === id ? { ...j, state } : j)) } : list,
      )
      return { snapshot }
    },
    onError: (err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
      toast(err.message, 'error')
    },
    onSuccess: (_d, { state }) => toast(LABELS[state]),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.allJobs }),
  })

  const apply = useMutation({
    mutationFn: (id: string) => unwrap(api.api.jobs[':id'].apply.$post({ param: { id } })),
    onSuccess: () => {
      toast('Added to Applications')
      void qc.invalidateQueries({ queryKey: queryKeys.applications })
    },
    onError: (err) => toast(err.message, 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.allJobs }),
  })

  return { setState, apply }
}
