import { Search, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/cn'
import { TIER_FILTERS, type TierFilter } from '@/lib/types'
import { type Age, DEFAULT_AGE, defaultSort, type FeedSearch, type Sort, type View } from './search'

// Applied is its own page
const VIEW_OPTIONS: { id: View; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'saved', label: 'Saved' },
  { id: 'hidden', label: 'Hidden' },
]

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'best', label: 'Best' },
  { id: 'newest', label: 'Newest' },
]

const APPLIED_SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'applied', label: 'Applied' },
  ...SORT_OPTIONS,
]

const AGE_OPTIONS: { id: Age; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: '1h', label: '1h' },
  { id: '3d', label: '3 days' },
  { id: '1w', label: '1 week' },
]

export const SEARCH_INPUT_ID = 'feed-search'

/** Writes to the URL after a short pause, so typing doesn't refetch per key. */
function SearchField({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (q: string | undefined) => void
}) {
  const [text, setText] = useState(value ?? '')
  const [synced, setSynced] = useState(value)
  // Cleared or changed elsewhere (Back, "Clear filters"): follow it
  if (value !== synced) {
    setSynced(value)
    setText(value ?? '')
  }
  const timer = useRef<number | undefined>(undefined)
  const commit = (next: string, delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onChange(next.trim() || undefined), delay)
  }
  return (
    <div className="relative order-first w-full sm:order-none sm:ml-auto sm:w-60">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <Input
        id={SEARCH_INPUT_ID}
        type="search"
        value={text}
        aria-label="Search roles, companies and places"
        placeholder="Search roles, companies, places"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          commit(e.target.value, 200)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('')
            commit('', 0)
            e.currentTarget.blur()
          }
        }}
        className="h-[2.15rem] pr-8 pl-9 pointer-coarse:h-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {!text && (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-line px-1 font-mono text-[0.65rem] text-faint pointer-fine:block">
          /
        </kbd>
      )}
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText('')
            commit('', 0)
          }}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-faint transition-colors after:absolute after:-inset-2 hover:text-paper"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Multi-select tiers in the same pill as the segmented controls. None picked
 * means the default: your tracked tiers in the feed, every tier elsewhere.
 */
function TierToggle({
  selected,
  onChange,
  fallback,
}: {
  selected: TierFilter[] | undefined
  onChange: (next: TierFilter[] | undefined) => void
  fallback: string
}) {
  const on = new Set(selected ?? [])
  const toggle = (t: TierFilter) => {
    const next = new Set(on)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    onChange(next.size ? TIER_FILTERS.filter((x) => next.has(x)) : undefined)
  }
  return (
    <div className="flex max-w-full items-center gap-1">
      <div
        role="group"
        aria-label="Tiers"
        title={on.size ? undefined : `No tier picked: ${fallback}`}
        className="inline-flex max-w-full scrollbar-none overflow-x-auto rounded-lg border border-line bg-panel p-0.5"
      >
        {TIER_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={on.has(t)}
            onClick={() => toggle(t)}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-[color,background-color,box-shadow] duration-200 pointer-coarse:py-2.5',
              on.has(t)
                ? 'bg-signal-soft text-signal ring-1 ring-signal/40'
                : 'text-dim hover:text-paper',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {on.size > 0 && (
        <button
          type="button"
          aria-label="Clear tiers"
          title="Clear tiers"
          onClick={() => onChange(undefined)}
          className="grid size-7 shrink-0 animate-fade-in place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-paper pointer-coarse:size-11"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

interface FilterBarProps {
  search: FeedSearch
  onChange: (next: Partial<FeedSearch>) => void
  onView: (view: View) => void
}

/** One compact row: view, age, tiers, order, search. Places, sources and companies are for search. */
export function FilterBar({ search, onChange, onView }: FilterBarProps) {
  const view = search.view ?? 'feed'
  const age = search.age ?? DEFAULT_AGE
  const sort = search.sort ?? defaultSort(search.view)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {view !== 'applied' && (
        <Segmented label="View" value={view} options={VIEW_OPTIONS} onChange={onView} />
      )}
      <Segmented
        label="Age"
        value={age}
        options={AGE_OPTIONS}
        onChange={(a) => onChange({ age: a === DEFAULT_AGE ? undefined : a })}
      />
      <TierToggle
        selected={search.tier}
        onChange={(tier) => onChange({ tier })}
        fallback={view === 'feed' ? 'your tracked tiers' : 'every tier'}
      />
      <span title="Best weighs freshness, a new-grad title, the company's tier and a named place; ties go to the newest">
        <Segmented
          label="Order"
          value={sort}
          options={view === 'applied' ? APPLIED_SORT_OPTIONS : SORT_OPTIONS}
          onChange={(s) => onChange({ sort: s === defaultSort(search.view) ? undefined : s })}
        />
      </span>
      <SearchField value={search.q} onChange={(q) => onChange({ q })} />
    </div>
  )
}
