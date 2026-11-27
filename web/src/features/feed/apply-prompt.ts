/**
 * The posting last opened from jobvr, so coming back can ask "Did you apply?"
 * with a one-tap Mark applied, instead of finding the row again. Kept in
 * localStorage: an installed app may be reloaded while the posting is open.
 */
const KEY = 'jobvr:opened-posting'
/** Back this soon is a glance or a misclick, not an application. */
export const MIN_AWAY_MS = 20_000
/** Much later, it's another sitting; the question would be out of the blue. */
export const MAX_AWAY_MS = 3 * 60 * 60_000

export function noteOpened(id: string, now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, at: now }))
  } catch {
    // Storage full or blocked: no prompt, nothing else breaks
  }
}

/** The job to ask about on coming back, at most once; null when there's nothing to ask. */
export function takeReturned(now = Date.now()): string | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
    localStorage.removeItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const { id, at } = JSON.parse(raw) as { id?: unknown; at?: unknown }
    if (typeof id !== 'string' || typeof at !== 'number') return null
    const away = now - at
    return away >= MIN_AWAY_MS && away <= MAX_AWAY_MS ? id : null
  } catch {
    return null
  }
}
