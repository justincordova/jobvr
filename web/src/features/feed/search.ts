import { TIER_FILTERS, type TierFilter } from '@/lib/types'

export const VIEWS = ['feed', 'saved', 'applied', 'hidden'] as const
export const AGES = ['1h', 'today', '3d', 'all'] as const
export const SORTS = ['best', 'newest', 'applied'] as const
export type View = (typeof VIEWS)[number]
export type Age = (typeof AGES)[number]
export type Sort = (typeof SORTS)[number]

export interface FeedSearch {
  view?: View
  age?: Age
  location?: string[]
  tier?: TierFilter[]
  source?: string[]
  company?: string[]
  /** Only jobs flagged entry level. */
  level?: 'entry'
  /** Unset: best first in the feed, latest applied first in Applied, else newest first. */
  sort?: Sort
  /** Text search (title, company, places). */
  q?: string
}

export const defaultSort = (view: View | undefined): Sort =>
  (view ?? 'feed') === 'feed' ? 'best' : view === 'applied' ? 'applied' : 'newest'

/** Applied is its own page (`/applied`), so `view` there is implied. */
export function parseAppliedSearch(raw: Record<string, unknown>): FeedSearch {
  return withoutView(parseFeedSearch(raw))
}

export function withoutView(s: FeedSearch): FeedSearch {
  const out = { ...s }
  delete out.view
  return out
}

/** The URL search for a view's page: Saved and Hidden are views of `/`. */
export const searchFor = (view: View, s: FeedSearch): FeedSearch =>
  view === 'saved' || view === 'hidden' ? { ...withoutView(s), view } : withoutView(s)

/**
 * Each view keeps its own filters for the session: narrowing the feed to Mid
 * and Startup doesn't narrow Applied, and coming back restores them.
 */
const remembered = new Map<View, FeedSearch>()

export function rememberSearch(view: View, search: FeedSearch) {
  remembered.set(view, search)
}

/** The search to open a view with: its last filters, or none. */
export function recallSearch(view: View): FeedSearch {
  return searchFor(view, remembered.get(view) ?? {})
}

/** Test helper. */
export function forgetSearches() {
  remembered.clear()
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
    level: raw.level === 'entry' ? 'entry' : undefined,
    sort: oneOf(SORTS, raw.sort),
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim().slice(0, 200) : undefined,
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
    level: s.level,
    sort: s.sort,
    q: s.q,
  }
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as {
    view?: View
    age?: Age
    location?: string
    tier?: string
    source?: string
    company?: string
    level?: 'entry'
    sort?: Sort
    q?: string
  }
}

export const DEFAULT_AGE: Age = 'all'

export const CLEARED_FILTERS = {
  location: undefined,
  tier: undefined,
  source: undefined,
  company: undefined,
  level: undefined,
} satisfies Partial<FeedSearch>

export const activeFilterCount = (s: FeedSearch) =>
  [s.location, s.tier, s.source, s.company, s.level].filter((v) => v?.length).length
