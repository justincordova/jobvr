import { TIER_FILTERS, type TierFilter } from '@/lib/types'

export const VIEWS = ['feed', 'saved', 'applied', 'hidden'] as const
export const AGES = ['1h', 'today', '3d', '1w', 'all'] as const
export const SORTS = ['best', 'newest', 'applied'] as const
export type View = (typeof VIEWS)[number]
export type Age = (typeof AGES)[number]
export type Sort = (typeof SORTS)[number]

export interface FeedSearch {
  view?: View
  age?: Age
  tier?: TierFilter[]
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

const STORAGE_KEY = 'jobvr.filters'

/** Filters saved in this browser; text searches are left out (they're one-off). */
function loadSaved(): Map<View, FeedSearch> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object') return new Map()
    return new Map(
      Object.entries(raw)
        .filter((e): e is [View, Record<string, unknown>] => VIEWS.includes(e[0] as View))
        .map(([view, s]) => [view, withoutView(parseFeedSearch(s ?? {}))]),
    )
  } catch {
    return new Map()
  }
}

/**
 * Each view keeps its own filters: narrowing the feed to Mid and Startup
 * doesn't narrow Applied, and coming back restores them. They're kept in this
 * browser too, so a reload or the home-screen app opens with them.
 */
let remembered: Map<View, FeedSearch> | null = null
// Loaded on first use: the parsers below aren't defined yet when this module starts
const store = () => (remembered ??= loadSaved())

export function rememberSearch(view: View, search: FeedSearch) {
  store().set(view, search)
  try {
    const saved = Object.fromEntries(
      [...store()].map(([v, s]) => [v, { ...withoutView(s), q: undefined }]),
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Private mode or full storage: the filters still last for this session
  }
}

/** The search to open a view with: its last filters, or none. */
export function recallSearch(view: View): FeedSearch {
  return searchFor(view, store().get(view) ?? {})
}

/** No filters, search, age or order (the view itself doesn't count). */
export function isBlankSearch(s: FeedSearch): boolean {
  return Object.values(withoutView(s)).every(
    (v) => v === undefined || (Array.isArray(v) && v.length === 0),
  )
}

/** Test helper: drops the in-memory copy, as a reload would (the browser copy stays). */
export function forgetSearches() {
  remembered = null
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
    tier: tiers?.length ? tiers : undefined,
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
    tier: csv(s.tier),
    sort: s.sort,
    q: s.q,
  }
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as {
    view?: View
    age?: Age
    tier?: string
    sort?: Sort
    q?: string
  }
}

export const DEFAULT_AGE: Age = 'all'

export const CLEARED_FILTERS = { tier: undefined } satisfies Partial<FeedSearch>

export const activeFilterCount = (s: FeedSearch) => (s.tier?.length ? 1 : 0)
