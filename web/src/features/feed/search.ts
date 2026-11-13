import { TIER_FILTERS, type TierFilter } from '@/lib/types'

export const VIEWS = ['feed', 'saved', 'applied', 'hidden'] as const
export const AGES = ['1h', 'today', '3d', 'all'] as const
export type View = (typeof VIEWS)[number]
export type Age = (typeof AGES)[number]

export interface FeedSearch {
  view?: View
  age?: Age
  location?: string[]
  tier?: TierFilter[]
  source?: string[]
  company?: string[]
}

const strings = (v: unknown): string[] | undefined => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const out = list.filter((x): x is string => typeof x === 'string' && x.length > 0)
  return out.length ? out : undefined
}

const oneOf = <T extends string>(values: readonly T[], v: unknown): T | undefined =>
  values.includes(v as T) ? (v as T) : undefined

export function parseFeedSearch(raw: Record<string, unknown>): FeedSearch {
  const tiers = strings(raw.tier)?.filter((t): t is TierFilter =>
    TIER_FILTERS.includes(t as TierFilter),
  )
  return {
    view: oneOf(VIEWS, raw.view),
    age: oneOf(AGES, raw.age),
    location: strings(raw.location),
    tier: tiers?.length ? tiers : undefined,
    source: strings(raw.source),
    company: strings(raw.company),
  }
}

/** API query: lists become comma-separated strings; empty values are omitted. */
export function toJobQuery(s: FeedSearch) {
  const csv = (v?: string[]) => (v?.length ? v.join(',') : undefined)
  const q = {
    view: s.view,
    age: s.age,
    location: csv(s.location),
    tier: csv(s.tier),
    source: csv(s.source),
    company: csv(s.company),
  }
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as {
    view?: View
    age?: Age
    location?: string
    tier?: string
    source?: string
    company?: string
  }
}

export const defaultAge = (view: View): Age => (view === 'feed' ? '3d' : 'all')

export const CLEARED_FILTERS = {
  location: undefined,
  tier: undefined,
  source: undefined,
  company: undefined,
} satisfies Partial<FeedSearch>

export const activeFilterCount = (s: FeedSearch) =>
  [s.location, s.tier, s.source, s.company].filter((v) => v?.length).length
