import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Input, NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/cn'
import { TIER_FILTERS, type Company } from '@/lib/types'
import {
  activeFilterCount,
  type Age,
  CLEARED_FILTERS,
  DEFAULT_AGE,
  defaultSort,
  type FeedSearch,
  type Sort,
  type View,
} from './search'

function ChipGroup({
  label,
  options,
  selected,
  onChange,
  hint,
}: {
  label: string
  options: { id: string; label: string }[]
  selected: string[] | undefined
  onChange: (next: string[] | undefined) => void
  hint?: string
}) {
  const set = new Set(selected ?? [])
  const toggle = (id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next.size ? [...next] : undefined)
  }
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 font-mono text-[0.68rem] tracking-wider text-faint uppercase">
        {label}
        {hint && !set.size && <span className="ml-2 tracking-normal normal-case">{hint}</span>}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={set.has(o.id)}
            onClick={() => toggle(o.id)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[0.8rem] transition-[color,background-color,border-color,scale] duration-150 active:scale-95 pointer-coarse:px-3.5 pointer-coarse:py-2.5',
              set.has(o.id)
                ? 'border-signal/60 bg-signal-soft text-signal'
                : 'border-line text-dim hover:border-line-strong hover:text-paper',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

// Applied is its own page
const VIEW_OPTIONS: { id: View; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'saved', label: 'Saved' },
  { id: 'hidden', label: 'Hidden' },
]

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'best', label: 'Best first' },
  { id: 'newest', label: 'Newest first' },
]

const APPLIED_SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'applied', label: 'Latest applied' },
  ...SORT_OPTIONS,
]

const AGE_OPTIONS: { id: Age; label: string }[] = [
  { id: '1h', label: '1h' },
  { id: 'today', label: 'Today' },
  { id: '3d', label: '3 days' },
  { id: 'all', label: 'All' },
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
        placeholder="Search roles"
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

interface FilterBarProps {
  search: FeedSearch
  onChange: (next: Partial<FeedSearch>) => void
  onView: (view: View) => void
  locations: string[]
  sources: { id: string; label: string }[]
  companies: Company[]
}

export function FilterBar({
  search,
  onChange,
  onView,
  locations,
  sources,
  companies,
}: FilterBarProps) {
  const active = activeFilterCount(search)
  const [open, setOpen] = useState(active > 0)
  const view = search.view ?? 'feed'
  const age = search.age ?? DEFAULT_AGE

  return (
    <div>
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
        <button
          type="button"
          aria-expanded={open}
          aria-controls="feed-filters"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'inline-flex h-[2.15rem] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors duration-200 pointer-coarse:h-11',
            open || active
              ? 'border-line-strong bg-raised text-paper'
              : 'border-line text-dim hover:text-paper',
          )}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {active > 0 && (
            <span className="animate-pop-in rounded bg-signal px-1 font-mono text-[0.65rem] font-semibold text-signal-ink">
              {active}
            </span>
          )}
          <ChevronDown
            className={cn(
              'size-3.5 text-faint transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
        <SearchField value={search.q} onChange={(q) => onChange({ q })} />
        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange(CLEARED_FILTERS)}
            className="inline-flex animate-fade-in items-center gap-1 rounded-md px-1.5 py-1 text-sm text-faint transition-colors hover:text-paper pointer-coarse:h-11 pointer-coarse:px-3"
          >
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>

      <div
        id="feed-filters"
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-out)',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-3 grid gap-4 rounded-xl border border-line bg-panel/70 p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span>
                <span className="block text-sm font-medium">Order</span>
                <span className="block text-xs text-dim">
                  Best first weighs freshness, a new-grad title, the company’s tier, and a named
                  place; ties go to the newest.
                </span>
              </span>
              <div className="shrink-0 self-start sm:self-auto">
                <Segmented
                  label="Order"
                  value={search.sort ?? defaultSort(search.view)}
                  options={view === 'applied' ? APPLIED_SORT_OPTIONS : SORT_OPTIONS}
                  onChange={(s) =>
                    onChange({ sort: s === defaultSort(search.view) ? undefined : s })
                  }
                />
              </div>
            </div>
            <ChipGroup
              label="Location"
              options={locations.map((l) => ({ id: l, label: l }))}
              selected={search.location}
              onChange={(location) => onChange({ location })}
              hint="any"
            />
            <ChipGroup
              label="Tier"
              options={TIER_FILTERS.map((t) => ({ id: t, label: t }))}
              selected={search.tier}
              onChange={(tier) => onChange({ tier: tier as FeedSearch['tier'] })}
              hint={view === 'feed' ? 'feed tiers (Settings)' : 'any'}
            />
            <ChipGroup
              label="Source"
              options={sources}
              selected={search.source}
              onChange={(source) => onChange({ source })}
              hint="any"
            />
            <div>
              <label
                htmlFor="company-filter"
                className="mb-1.5 block font-mono text-[0.68rem] tracking-wider text-faint uppercase"
              >
                Company
              </label>
              <NativeSelect
                id="company-filter"
                value={search.company?.[0] ?? ''}
                onChange={(e) =>
                  onChange({ company: e.target.value ? [e.target.value] : undefined })
                }
              >
                <option value="">All companies</option>
                <option value="unlisted">Unlisted (not in your list)</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
