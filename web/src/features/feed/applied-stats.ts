import { toDateInput } from '@/lib/format'
import { TIER_FILTERS, type TierFilter } from '@/lib/types'

export interface HeatDay {
  /** Local date, YYYY-MM-DD. */
  date: string
  count: number
  /** 0 (none) to 4 (the busiest day in the range). */
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

export interface AppliedStats {
  total: number
  /** Applied before jobvr recorded the date. */
  undated: number
  today: number
  yesterday: number
  thisWeek: number
  lastWeek: number
  /** Since the 1st of this month. */
  thisMonth: number
  /**
   * Per day over the last 30 days, or since the first dated application when
   * that's more recent (so a new user's average isn't diluted). Null with no dates.
   */
  perDay: number | null
  /** Days in a row with an application, up to today (or yesterday, if none yet today). */
  streak: number
  /** The busiest day in the range (null when nothing is dated). */
  bestDay: { date: string; count: number } | null
  /** One column per week, Monday first; the last column is this week. */
  weeks: HeatDay[][]
  tiers: { tier: TierFilter; count: number }[]
}

const DAY = 86_400_000

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** Monday of the week `d` is in. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))

export function appliedStats(
  jobs: readonly { appliedAt: string | null; tier: TierFilter }[],
  now = new Date(),
  weekCount = 16,
): AppliedStats {
  const byDay = new Map<string, number>()
  let undated = 0
  let firstApplied: Date | null = null
  for (const j of jobs) {
    if (!j.appliedAt) {
      undated++
      continue
    }
    const key = toDateInput(j.appliedAt)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
    const at = new Date(j.appliedAt)
    if (!firstApplied || at < firstApplied) firstApplied = at
  }
  const countOn = (d: Date) => byDay.get(toDateInput(d.toISOString())) ?? 0

  const today = startOfDay(now)
  const monday = startOfWeek(now)
  const sumDays = (from: Date, days: number) =>
    Array.from({ length: days }, (_, i) => countOn(addDays(from, i))).reduce((a, b) => a + b, 0)

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const span = firstApplied
    ? Math.min(30, Math.round((today.getTime() - startOfDay(firstApplied).getTime()) / DAY) + 1)
    : 0

  let streak = 0
  let day = countOn(today) > 0 ? today : addDays(today, -1)
  while (countOn(day) > 0) {
    streak++
    day = addDays(day, -1)
  }

  const first = addDays(monday, -7 * (weekCount - 1))
  const days = Array.from({ length: weekCount * 7 }, (_, i) => addDays(first, i))
  const max = Math.max(1, ...days.map(countOn))
  const weeks = Array.from({ length: weekCount }, (_, w) =>
    days.slice(w * 7, w * 7 + 7).map((d): HeatDay => {
      const count = countOn(d)
      return {
        date: toDateInput(d.toISOString()),
        count,
        level: count === 0 ? 0 : (Math.min(4, Math.ceil((count / max) * 4)) as HeatDay['level']),
        future: d.getTime() > today.getTime() + DAY - 1,
      }
    }),
  )

  // Ties go to the latest day
  const busiest = weeks
    .flat()
    .reduce<HeatDay | null>((b, d) => (d.count > 0 && d.count >= (b?.count ?? 0) ? d : b), null)

  return {
    total: jobs.length,
    undated,
    today: countOn(today),
    yesterday: countOn(addDays(today, -1)),
    thisWeek: sumDays(monday, 7),
    lastWeek: sumDays(addDays(monday, -7), 7),
    thisMonth: sumDays(monthStart, today.getDate()),
    perDay: span > 0 ? sumDays(addDays(today, 1 - span), span) / span : null,
    streak,
    bestDay: busiest && { date: busiest.date, count: busiest.count },
    weeks,
    tiers: TIER_FILTERS.map((tier) => ({
      tier,
      count: jobs.filter((j) => j.tier === tier).length,
    })).filter((t) => t.count > 0),
  }
}
