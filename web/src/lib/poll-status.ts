import type { SettingsPayload } from '@/lib/types'

/** A poll takes at most its 5-minute budget plus saving; one started longer ago than this died. */
const POLL_MAX_MS = 10 * 60_000

/**
 * Whether a poll is running now (started after the last one finished), and
 * when the last one finished: "polled" means finished, not started.
 */
export function pollStatus(
  p: Pick<SettingsPayload, 'lastPollAt' | 'lastPollOkAt'>,
  now = Date.now(),
): { polling: boolean; finishedAt: string | null } {
  const started = p.lastPollAt ? new Date(p.lastPollAt).getTime() : null
  const finished = p.lastPollOkAt ? new Date(p.lastPollOkAt).getTime() : null
  const polling =
    started !== null && (finished === null || finished < started) && now - started < POLL_MAX_MS
  return { polling, finishedAt: p.lastPollOkAt ?? (polling ? null : p.lastPollAt) }
}
