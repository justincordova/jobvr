import { SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { NativeSelect } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { TIER_FILTERS, type Company } from '@/lib/types'
import { activeFilterCount, type Age, type FeedSearch, type View } from './search'

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-line bg-panel p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-md px-2.5 py-1 text-sm text-dim transition-colors hover:text-paper',
            value === o.id && 'bg-raised text-paper shadow-sm ring-1 ring-line-strong',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

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
              'rounded-full border px-2.5 py-0.5 text-[0.8rem] transition-colors',
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
  const [open, setOpen] = useState(false)
  const view = search.view ?? 'feed'
  const age = search.age ?? (view === 'feed' ? '3d' : 'all')
  const active = activeFilterCount(search)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={view}
          options={VIEW_OPTIONS}
          onChange={(v) => onChange({ view: v })}
        />
        <Segmented
          label="Age"
          value={age}
          options={AGE_OPTIONS}
          onChange={(a) => onChange({ age: a })}
        />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'inline-flex h-[2.15rem] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
            open || active
              ? 'border-line-strong bg-raised text-paper'
              : 'border-line text-dim hover:text-paper',
          )}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {active > 0 && (
            <span className="rounded bg-signal px-1 font-mono text-[0.65rem] font-semibold text-signal-ink">
              {active}
            </span>
          )}
        </button>
        {active > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                location: undefined,
                tier: undefined,
                source: undefined,
                company: undefined,
              })
            }
            className="inline-flex items-center gap-1 text-sm text-faint hover:text-paper"
          >
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>

      {open && (
        <div className="grid animate-rise gap-4 rounded-xl border border-line bg-panel/70 p-4 sm:grid-cols-2">
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
              onChange={(e) => onChange({ company: e.target.value ? [e.target.value] : undefined })}
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
      )}
    </div>
  )
}
