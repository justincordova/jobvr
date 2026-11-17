import { api, queryKeys, unwrap } from './api'

/** Companies deleted in the UI whose Undo window is still open (the DELETE hasn't run). */
export const pendingDeletes = new Set<string>()

/** The companies list; a refetch during an Undo window must not bring a deleted row back. */
export const companiesQuery = {
  queryKey: queryKeys.companies,
  queryFn: async () =>
    (await unwrap(api.api.companies.$get())).filter((c) => !pendingDeletes.has(c.id)),
}
