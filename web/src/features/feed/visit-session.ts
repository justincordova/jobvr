import type { Job, JobList } from '@/lib/types'

/**
 * "New since last visit" is captured from the first feed response of a page
 * load, then the visit is recorded. Later refetches don't clear highlights.
 */
const session = {
  captured: false,
  count: 0,
  ids: new Set<string>(),
  jobs: [] as Job[],
  dismissed: false,
}

export function captureFirstResponse(list: JobList): boolean {
  if (session.captured) return false
  session.captured = true
  session.count = list.newSinceLastVisit
  session.jobs = list.newJobs
  for (const j of list.jobs) if (j.isNew) session.ids.add(j.id)
  for (const j of list.newJobs) session.ids.add(j.id)
  return true
}

export const isSessionNew = (id: string, isNew: boolean) => {
  if (isNew) session.ids.add(id)
  return session.ids.has(id)
}

export const sessionNewCount = () => session.count

/** The new jobs themselves (newest first), whatever the list's filters. */
export const sessionNewJobs = (): readonly Job[] => session.jobs

/** The banner stays closed for the rest of this visit, across pages. */
export const bannerDismissed = () => session.dismissed
export const dismissBanner = () => {
  session.dismissed = true
}

/** Test helper. */
export function resetVisitSession() {
  session.captured = false
  session.count = 0
  session.ids.clear()
  session.jobs = []
  session.dismissed = false
}
