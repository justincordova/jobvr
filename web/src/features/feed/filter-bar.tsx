import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/cn'
import { TIER_FILTERS, type Company } from '@/lib/types'
import {
  activeFilterCount,
  type Age,
  CLEARED_FILTERS,
  DEFAULT_AGE,
  type FeedSearch,
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
              'rounded-full border px-2.5 py-0.5 text-[0.8rem] transition-[color,background-color,border-color,scale] duration-150 active:scale-95',
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

const VIEW_OPTIONS: { id: View; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'hidden', label: 'Hidden' },
]

const AGE_OPTIONS: { id: Age; label: string }[] = [
  { id: '1h', label: '1h' },
  { id: 'today', label: 'Today' },
  { id: '3d', label: '3 days' },
  { id: 'all', label: 'All' },
]

interface FilterBarProps {
  search: FeedSearch
  onChange: (next: Partial<FeedSearch>) => void
  locations: string[]
  sources: { id: string; label: string }[]
  companies: Company[]
}

export function FilterBar({ search, onChange, locations, sources, companies }: FilterBarProps) {
  const active = activeFilterCount(search)
  const [open, setOpen] = useState(active > 0)
  const view = search.view ?? 'feed'
  const age = search.age ?? DEFAULT_AGE

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={view}
          options={VIEW_OPTIONS}
          onChange={(v) => onChange({ view: v === 'feed' ? undefined : v })}
        />
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
            'inline-flex h-[2.15rem] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors duration-200',
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
        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange(CLEARED_FILTERS)}
            className="inline-flex animate-fade-in items-center gap-1 rounded-md px-1.5 py-1 text-sm text-faint transition-colors hover:text-paper"
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
            <label className="flex cursor-pointer items-center justify-between gap-4 sm:col-span-2">
              <span>
                <span className="block text-sm font-medium">Entry level only</span>
                <span className="block text-xs text-dim">
                  Titles that say new grad, junior, I, and so on, plus everything from SimplifyJobs.
                  Hides plain “Software Engineer” board roles.
                </span>
              </span>
              <Switch
                checked={search.level === 'entry'}
                onCheckedChange={(on) => onChange({ level: on ? 'entry' : undefined })}
                aria-label="Entry level only"
              />
            </label>
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
              hint={view === 'feed' ? 'tracked tiers' : 'any'}
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
