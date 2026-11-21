import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Reveal } from '@/components/ui/reveal'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/cn'
import { TIER_BADGE, TIER_DOT } from '@/lib/tier-style'
import { type Settings, TIER_FILTERS, type TierFilter } from '@/lib/types'
import { ChipsInput } from './chips-input'
import { numberProblem } from './draft'

/** A settings group: a title, one line on what it's for, then its rows. */
export function Card({
  id,
  title,
  description,
  dirty,
  children,
}: {
  id: string
  title: string
  description: ReactNode
  dirty: boolean
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'scroll-mt-24 rounded-xl border bg-panel/60 transition-colors duration-300',
        dirty ? 'border-signal/40' : 'border-line',
      )}
    >
      <header className="px-5 pt-4 pb-3">
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-semibold tracking-tight">
          {title}
          <span
            aria-hidden={!dirty}
            className={cn(
              'size-1.5 rounded-full bg-signal transition-[opacity,scale] duration-300',
              dirty ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
            )}
          />
          {dirty && <span className="sr-only">(unsaved)</span>}
        </h2>
        <p className="mt-0.5 text-sm text-dim">{description}</p>
      </header>
      <div className="divide-y divide-line/70 border-t border-line/70">{children}</div>
    </section>
  )
}

/** One setting: label and a short hint on the left, its control on the right (below on phones when wide). */
export function Field({
  label,
  hint,
  htmlFor,
  error,
  errorId = htmlFor && `${htmlFor}-error`,
  stack,
  children,
}: {
  label: string
  hint?: ReactNode
  htmlFor?: string
  /** What to fix before saving. */
  error?: string
  /** For the control to point at (`aria-describedby`); from `htmlFor` by default. */
  errorId?: string
  /** The control takes the full width under the label (chips, lists). */
  stack?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'px-5 py-3.5',
        stack ? 'space-y-2.5' : 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5',
      )}
    >
      <div className="min-w-0 flex-1 basis-56">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {hint && <p className="mt-0.5 text-xs text-dim">{hint}</p>}
        {error && (
          <p id={errorId} className="mt-0.5 animate-fade-in text-xs text-stop">
            {error}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

export function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  )
}

export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  suffix,
  label,
}: {
  id: string
  /** When no visible label points at it. */
  label?: string
  value: number
  onChange: (n: number) => void
  min: number
  max?: number
  suffix: string
}) {
  const invalid = numberProblem(value, { min, max }) !== undefined
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="w-20 text-right font-mono tabular-nums aria-invalid:border-stop/60"
      />
      <span className="w-14 text-sm text-dim">{suffix}</span>
    </div>
  )
}

/** Tier toggles, each in its tier's color when on. */
export function TierPicker({
  value,
  onChange,
}: {
  value: TierFilter[]
  onChange: (next: TierFilter[]) => void
}) {
  const on = new Set(value)
  return (
    <div role="group" aria-label="Tiers to track" className="flex flex-wrap gap-2">
      {TIER_FILTERS.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={on.has(t)}
          onClick={() => {
            const next = new Set(on)
            if (on.has(t)) next.delete(t)
            else next.add(t)
            // In tier order, so switching one off and on again isn't an unsaved change
            onChange(TIER_FILTERS.filter((x) => next.has(x)))
          }}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm ring-1 transition-[color,background-color,box-shadow,scale] duration-200 active:scale-95 pointer-coarse:h-11 pointer-coarse:px-4',
            on.has(t)
              ? TIER_BADGE[t]
              : 'text-faint ring-line hover:text-paper hover:ring-line-strong',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full transition-colors duration-200',
              on.has(t) ? TIER_DOT[t] : 'bg-line-strong',
            )}
          />
          {t}
        </button>
      ))}
    </div>
  )
}

type Location = Settings['locations'][number]

/** Places: one line each (on/off, name, its aliases), aliases edited in place. */
export function LocationsEditor({
  value,
  onChange,
}: {
  value: Location[]
  onChange: (next: Location[]) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const inputId = useId()
  const label = newLabel.trim()
  const duplicate = value.some((l) => l.label.toLowerCase() === label.toLowerCase())
  const update = (i: number, patch: Partial<Location>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <>
      <ul className="divide-y divide-line/70">
        {value.map((loc, i) => {
          const editing = open === loc.label
          return (
            <li key={loc.label} className="animate-rise px-5 py-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={loc.enabled}
                  onCheckedChange={(enabled) => update(i, { enabled })}
                  aria-label={`Match ${loc.label}`}
                />
                <div
                  className={cn(
                    'min-w-0 flex-1 transition-opacity duration-200',
                    !loc.enabled && 'opacity-50',
                  )}
                >
                  <p className="text-sm font-medium">{loc.label}</p>
                  <p className="truncate text-xs text-faint">
                    {loc.builtin
                      ? '“Remote”, “Remote - US”, “United States (Remote)”; not “Remote in UK”'
                      : loc.aliases.join(', ') || 'No other names'}
                  </p>
                </div>
                {!loc.builtin && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={editing}
                      onClick={() => setOpen(editing ? null : loc.label)}
                    >
                      {editing ? 'Done' : 'Edit'}
                      <ChevronDown
                        className={cn(
                          'transition-transform duration-300 ease-(--ease-out)',
                          editing && 'rotate-180',
                        )}
                      />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${loc.label}`}
                      className="hover:text-stop"
                      onClick={() => onChange(value.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
              {!loc.builtin && (
                <Reveal open={editing} className="mt-3">
                  <ChipsInput
                    label="Also matches"
                    value={loc.aliases}
                    onChange={(aliases) => update(i, { aliases })}
                    placeholder="A city or another name, then Enter"
                  />
                </Reveal>
              )}
            </li>
          )
        })}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2 px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!label || duplicate) return
          onChange([
            ...value.filter((l) => !l.builtin),
            { label, aliases: [label.toLowerCase()], enabled: true },
            ...value.filter((l) => l.builtin),
          ])
          setNewLabel('')
          setOpen(label)
        }}
      >
        <Input
          id={inputId}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add a place, e.g. Boston"
          aria-label="New place"
          aria-invalid={duplicate}
          className="max-w-64 flex-1 aria-invalid:border-stop/60"
        />
        <Button type="submit" size="md" disabled={!label || duplicate}>
          <Plus /> Add
        </Button>
        {duplicate && (
          <p className="w-full animate-fade-in text-xs text-stop">{label} is already a place.</p>
        )}
      </form>
    </>
  )
}
