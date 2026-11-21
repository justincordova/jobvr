import { useState } from 'react'
import type { Settings } from '@/lib/types'

type Key = keyof Settings

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The server's limits (core/src/settings.ts), so a bad value is caught before Save. */
export const LIMITS = {
  experienceCutoffYears: { min: 0, max: 20 },
  minSalaryUsd: { min: 0 },
  pushEveryMinutes: { min: 5, max: 1440 },
  maxJobAgeHours: { min: 1, max: 168 },
  pollEveryMinutes: { min: 5, max: 1440 },
  storeWindowDays: { min: 7, max: 120 },
} satisfies Partial<Record<Key, { min: number; max?: number }>>

const MAX_PLACES = 30
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** What's wrong with a number, if anything (an empty input is NaN). */
export function numberProblem(value: number, { min, max }: { min: number; max?: number }) {
  if (!Number.isFinite(value)) return 'Enter a number'
  if (!Number.isInteger(value)) return 'Use a whole number'
  if (max === undefined) return value < min ? `Use ${min} or more` : undefined
  return value < min || value > max ? `Use ${min} to ${max}` : undefined
}

/** The settings that can't be saved as they are, each with what to fix. */
export function settingsProblems(s: Settings): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {}
  for (const [key, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, { min: number }][]) {
    const problem = numberProblem(s[key], limit)
    if (problem) out[key] = problem
  }
  const { start, end } = s.quietHours
  if (!HHMM.test(start) || !HHMM.test(end)) out.quietHours = 'Set both a start and an end time'
  // Custom places match by their names; the built-in Remote-US has its own rule
  const unnamed = s.locations.find((l) => !l.builtin && l.aliases.length === 0)
  if (unnamed) out.locations = `${unnamed.label} needs at least one name to match`
  else if (!s.locations.some((l) => l.enabled)) out.locations = 'Turn on at least one place'
  else if (s.locations.length > MAX_PLACES) out.locations = `Keep it to ${MAX_PLACES} places`
  // None would empty the feed and stop every board's checks
  if (s.tiersToTrack.length === 0) out.tiersToTrack = 'Pick at least one tier'
  if (s.roleKeywords.length === 0) out.roleKeywords = 'Add at least one role keyword'
  if (s.levelKeywords.length === 0) out.levelKeywords = 'Add at least one level keyword'
  return out
}

/** Names for the save bar, which says what to fix wherever it is on the page. */
export const PROBLEM_LABELS: Partial<Record<Key, string>> = {
  tiersToTrack: 'Tiers to track',
  experienceCutoffYears: 'Years of experience',
  minSalaryUsd: 'Minimum salary',
  pushEveryMinutes: 'Push every',
  maxJobAgeHours: 'Push roles newer than',
  pollEveryMinutes: 'Check every',
  storeWindowDays: 'Keep roles',
  quietHours: 'Quiet hours',
  locations: 'Places',
  roleKeywords: 'Role keywords',
  levelKeywords: 'Level keywords',
}

/**
 * One draft for the whole page, saved together from the bar that slides up
 * once something changes. When the saved settings change underneath (another
 * tab), settings not being edited here follow them; edits in progress stay.
 */
export function useDraft(settings: Settings) {
  const [draft, setDraft] = useState(settings)
  const [baseline, setBaseline] = useState(settings)
  if (baseline !== settings) {
    const untouched = (Object.keys(settings) as Key[]).filter((k) => same(draft[k], baseline[k]))
    setBaseline(settings)
    setDraft({ ...draft, ...Object.fromEntries(untouched.map((k) => [k, settings[k]])) })
  }
  const changed = (Object.keys(draft) as Key[]).filter((k) => !same(draft[k], settings[k]))
  const set = <K extends Key>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const problems = settingsProblems(draft)
  // Bumped on Discard, so fields with their own state (Custom days) start over too
  const [version, setVersion] = useState(0)
  const reset = () => {
    setDraft(settings)
    setVersion((v) => v + 1)
  }
  /**
   * After a save: what the server kept (trimmed, de-duplicated) becomes the
   * draft, except settings edited again while the save was on its way.
   */
  const commit = (saved: Settings, sent: Settings) => {
    setBaseline(saved)
    setDraft((d) => ({
      ...d,
      ...Object.fromEntries(
        (Object.keys(saved) as Key[]).filter((k) => same(d[k], sent[k])).map((k) => [k, saved[k]]),
      ),
    }))
  }
  return { draft, set, changed, problems, reset, commit, version }
}
