import { ChevronDown, Layers, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/cn'
import { TIER_DOT } from '@/lib/tier-style'
import { TIER_FILTERS, type TierFilter } from '@/lib/types'
import { type Age, DEFAULT_AGE, defaultSort, type FeedSearch, type Sort, type View } from './search'

const VIEW_OPTIONS: { id: View; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'hidden', label: 'Hidden' },
]

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'best', label: 'Best' },
  { id: 'newest', label: 'Newest' },
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
    <div className="relative order-first w-full sm:order-none sm:ml-auto sm:w-56">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <Input
        id={SEARCH_INPUT_ID}
        type="search"
        value={text}
        aria-label="Search roles, companies and places"
        placeholder="Search jobs"
        title="Search titles, companies and places"
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

/** "Mid, Startup" for two, "Mid +3" for more. */
const tierSummary = (tiers: TierFilter[]) =>
  tiers.length <= 2 ? tiers.join(', ') : `${tiers[0]} +${tiers.length - 1}`

/**
 * One button that opens a checklist of tiers (like GitHub's or Linear's
 * filter menus). None picked means the default: your tracked tiers in the
 * feed, every tier elsewhere.
 */
function TierMenu({
  selected,
  onChange,
  fallback,
}: {
  selected: TierFilter[] | undefined
  onChange: (next: TierFilter[] | undefined) => void
  fallback: string
}) {
  const on = new Set(selected ?? [])
  const toggle = (t: TierFilter, checked: boolean) => {
    const next = new Set(on)
    if (checked) next.add(t)
    else next.delete(t)
    onChange(next.size ? TIER_FILTERS.filter((x) => next.has(x)) : undefined)
  }
  const active = on.size > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={active ? `Tiers: ${[...on].join(', ')}` : `Tiers: ${fallback}`}
          className={cn(
            'inline-flex h-[2.15rem] items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors duration-200 pointer-coarse:h-11 data-[state=open]:bg-raised',
            active
              ? 'border-signal/50 bg-signal-soft text-signal'
              : 'border-line bg-panel text-dim hover:text-paper',
          )}
        >
          <Layers className="size-4" />
          {active ? tierSummary(TIER_FILTERS.filter((t) => on.has(t))) : 'Tiers'}
          <ChevronDown className="size-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>Show tiers</DropdownMenuLabel>
        {TIER_FILTERS.map((t) => (
          <DropdownMenuCheckboxItem
            key={t}
            checked={on.has(t)}
            onCheckedChange={(checked) => toggle(t, checked === true)}
          >
            <span aria-hidden className={cn('size-2 rounded-full', TIER_DOT[t])} />
            {t}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!active}
          onSelect={() => onChange(undefined)}
          className="text-dim"
        >
          <X /> Clear: show {fallback}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface FilterBarProps {
  search: FeedSearch
  onChange: (next: Partial<FeedSearch>) => void
  onView: (view: View) => void
}

/** One compact row: view, age, order (not on Applied), tiers, search. Places, sources and companies are for search. */
export function FilterBar({ search, onChange, onView }: FilterBarProps) {
  const view = search.view ?? 'feed'
  const age = search.age ?? DEFAULT_AGE
  const sort = search.sort ?? defaultSort(search.view)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="View" value={view} options={VIEW_OPTIONS} onChange={onView} />
      <Segmented
        label="Age"
        value={age}
        options={AGE_OPTIONS}
        onChange={(a) => onChange({ age: a === DEFAULT_AGE ? undefined : a })}
      />
      {/* Applied is always latest application first */}
      {view !== 'applied' && (
        <span title="Best weighs freshness, a new-grad title, the company's tier and a named place; ties go to the newest">
          <Segmented
            label="Order"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(s) => onChange({ sort: s === defaultSort(search.view) ? undefined : s })}
          />
        </span>
      )}
      <TierMenu
        selected={search.tier}
        onChange={(tier) => onChange({ tier })}
        fallback={view === 'feed' ? 'tracked tiers' : 'all tiers'}
      />
      <SearchField value={search.q} onChange={(q) => onChange({ q })} />
    </div>
  )
}
