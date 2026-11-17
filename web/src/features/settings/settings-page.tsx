import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { ErrorState, PageHeader, Section, Skeleton } from '@/components/page'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relative } from '@/lib/format'
import { type Settings, type SettingsPayload, TIER_FILTERS } from '@/lib/types'
import { ChipsInput } from './chips-input'

type Key = keyof Settings

/** Sections report unsaved drafts so the page can guard navigation. */
const DirtyContext = createContext<(section: string, dirty: boolean) => void>(() => {})

/** Local draft of some settings fields, saved together with one PATCH. */
function useDraft<K extends Key>(section: string, settings: Settings, keys: readonly K[]) {
  const pick = () => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>
  const [draft, setDraft] = useState(pick)
  const [baseline, setBaseline] = useState(settings)
  // Server data changed (another section saved): reset this draft only if it was clean
  if (baseline !== settings) {
    const wasDirty = keys.some((k) => JSON.stringify(draft[k]) !== JSON.stringify(baseline[k]))
    setBaseline(settings)
    if (!wasDirty) setDraft(pick())
  }
  const dirty = keys.some((k) => JSON.stringify(draft[k]) !== JSON.stringify(settings[k]))
  const set = <F extends K>(field: F, value: Settings[F]) =>
    setDraft((d) => ({ ...d, [field]: value }))
  const report = useContext(DirtyContext)
  useEffect(() => {
    report(section, dirty)
    return () => report(section, false)
  }, [report, section, dirty])
  // Empty number inputs are NaN; block saving until they're filled in
  const valid = keys.every((k) => typeof draft[k] !== 'number' || Number.isFinite(draft[k]))
  return { draft, set, dirty, valid, reset: () => setDraft(pick()) }
}

function SaveBar({
  dirty,
  valid = true,
  onSave,
  onReset,
  pending,
  error,
}: {
  dirty: boolean
  valid?: boolean
  onSave: () => void
  onReset: () => void
  pending: boolean
  error: string | null
}) {
  return (
    <>
      {(error || !valid) && (
        <p className="mr-auto animate-fade-in text-sm text-stop">
          {error ?? 'Fill in every number first.'}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        className={cn('transition-opacity', !dirty && 'pointer-events-none opacity-0')}
        tabIndex={dirty ? 0 : -1}
        aria-hidden={!dirty}
      >
        Discard
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={onSave}
        disabled={!dirty || !valid}
        pending={pending}
      >
        Save
      </Button>
    </>
  )
}

function useSave(section: string) {
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (json: Partial<Settings>) => unwrap(api.api.settings.$patch({ json })),
    onMutate: () => setError(null),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.settings, data)
      void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
      toast(`${section} saved`)
    },
    onError: (err) => setError(err.message),
  })
  return { save: mutation.mutate, pending: mutation.isPending, error }
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-dim">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  id: string
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max?: number
  suffix: string
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          aria-invalid={!Number.isFinite(value)}
          className="w-28 font-mono aria-invalid:border-stop/60"
        />
        <span className="text-sm text-dim">{suffix}</span>
      </div>
    </div>
  )
}

const WINDOW_PRESETS = [30, 60] as const

/** 30 / 60 days in one tap, or any number of days. */
function StoreWindowField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const preset = WINDOW_PRESETS.find((d) => d === value)
  const [custom, setCustom] = useState(preset === undefined)
  const mode = custom || preset === undefined ? 'custom' : String(preset)
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium" id="storeWindowLabel">
        Keep jobs posted within
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Keep jobs posted within"
          value={mode}
          options={[
            ...WINDOW_PRESETS.map((d) => ({ id: String(d), label: `${d} days` })),
            { id: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => {
            setCustom(v === 'custom')
            if (v !== 'custom') onChange(Number(v))
          }}
        />
        {mode === 'custom' && (
          <div className="flex animate-fade-in items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={7}
              max={120}
              value={Number.isFinite(value) ? value : ''}
              onChange={(e) => onChange(e.target.valueAsNumber)}
              aria-labelledby="storeWindowLabel"
              aria-invalid={!Number.isFinite(value)}
              className="w-20 font-mono aria-invalid:border-stop/60"
            />
            <span className="text-sm text-dim">days (7 to 120)</span>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-dim">
        Older roles that are still open show up further down the feed. New-grad roles on company
        boards are kept for up to 180 days, since firms post them months ahead. Pushes only cover
        jobs within max job age.
      </p>
    </div>
  )
}

function MatchingSection({ settings }: { settings: Settings }) {
  const { draft, set, dirty, valid, reset } = useDraft('Matching', settings, [
    'locations',
    'roleKeywords',
    'levelKeywords',
    'excludeKeywords',
    'minSalaryUsd',
    'requireLevelOnBoards',
    'experienceCutoffYears',
  ] as const)
  const { save, pending, error } = useSave('Matching')
  const [newLabel, setNewLabel] = useState('')
  const duplicate = draft.locations.some(
    (l) => l.label.toLowerCase() === newLabel.trim().toLowerCase(),
  )

  const updateLoc = (i: number, patch: Partial<Settings['locations'][number]>) =>
    set(
      'locations',
      draft.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    )

  return (
    <Section
      title="Matching"
      dirty={dirty}
      description="Company-board titles need a role keyword and nothing senior (exclude keywords, or levels like II or 3). SimplifyJobs is new-grad only, so its titles just need to avoid excludes."
      footer={
        <SaveBar
          dirty={dirty}
          valid={valid}
          onSave={() => save(draft)}
          onReset={reset}
          pending={pending}
          error={error}
        />
      }
    >
      <div>
        <p className="mb-2 font-mono text-[0.7rem] tracking-wider text-dim uppercase">Locations</p>
        <ul className="space-y-2">
          {draft.locations.map((loc, i) => (
            <li
              key={loc.label}
              className={cn(
                'animate-rise rounded-lg border border-line bg-ink/40 p-3 transition-opacity duration-200',
                !loc.enabled && 'opacity-60',
              )}
            >
              <div className="mb-2 flex items-center gap-3">
                <Switch
                  checked={loc.enabled}
                  onCheckedChange={(enabled) => updateLoc(i, { enabled })}
                  aria-label={`Enable ${loc.label}`}
                />
                <span className="font-semibold">{loc.label}</span>
                {loc.builtin && <Badge tone="info">built-in rule</Badge>}
                {!loc.builtin && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-7"
                    aria-label={`Remove ${loc.label}`}
                    onClick={() =>
                      set(
                        'locations',
                        draft.locations.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              {loc.builtin ? (
                <p className="text-xs text-dim">
                  Matches “Remote”, “Remote - US”, “Remote in USA”, “United States (Remote)”; not
                  “Remote in UK”.
                </p>
              ) : (
                <ChipsInput
                  label="Aliases"
                  value={loc.aliases}
                  onChange={(aliases) => updateLoc(i, { aliases })}
                />
              )}
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const label = newLabel.trim()
            if (!label || duplicate) return
            set('locations', [
              ...draft.locations.filter((l) => !l.builtin),
              { label, aliases: [label.toLowerCase()], enabled: true },
              ...draft.locations.filter((l) => l.builtin),
            ])
            setNewLabel('')
          }}
        >
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New location, e.g. Boston"
            aria-label="New location label"
            aria-invalid={duplicate}
            className="max-w-xs aria-invalid:border-stop/60"
          />
          <Button type="submit" size="md" disabled={!newLabel.trim() || duplicate}>
            <Plus /> Add
          </Button>
        </form>
        {duplicate && (
          <p className="mt-1.5 animate-fade-in text-xs text-stop">
            {newLabel.trim()} is already in the list.
          </p>
        )}
      </div>
      <ChipsInput
        label="Role keywords (any)"
        value={draft.roleKeywords}
        onChange={(v) => set('roleKeywords', v)}
      />
      <ChipsInput
        label="Level keywords (any)"
        value={draft.levelKeywords}
        onChange={(v) => set('levelKeywords', v)}
      />
      <ChipsInput
        label="Exclude keywords"
        tone="stop"
        value={draft.excludeKeywords}
        onChange={(v) => set('excludeKeywords', v)}
      />
      <Row
        label="Require a level keyword on company boards"
        hint="Off: plain titles like “Software Engineer” count too. On: only titles that say new grad, junior, I, and so on."
      >
        <Switch
          checked={draft.requireLevelOnBoards}
          onCheckedChange={(v) => set('requireLevelOnBoards', v)}
          aria-label="Require a level keyword on company boards"
        />
      </Row>
      <div>
        <NumberField
          id="experienceCutoff"
          label="Hide board jobs asking for"
          value={draft.experienceCutoffYears}
          onChange={(n) => set('experienceCutoffYears', n)}
          min={0}
          max={20}
          suffix="+ years of experience (0 = off)"
        />
        <p className="mt-1.5 text-xs text-dim">
          Read from the job description. Titles that say new grad, junior, and so on always stay.
        </p>
      </div>
      <NumberField
        id="minSalary"
        label="Min salary (when listed)"
        value={draft.minSalaryUsd}
        onChange={(n) => set('minSalaryUsd', n)}
        min={0}
        suffix="USD / year (0 = any)"
      />
    </Section>
  )
}

function TiersSection({ settings }: { settings: Settings }) {
  const { draft, set, dirty, reset } = useDraft('Tiers', settings, ['tiersToTrack'] as const)
  const { save, pending, error } = useSave('Tiers')
  const on = new Set(draft.tiersToTrack)
  return (
    <Section
      title="Tiers to track"
      dirty={dirty}
      description="Decides which companies are polled, which jobs push, and the feed’s default tier filter. Unlisted = SimplifyJobs roles at companies not in your list."
      footer={
        <SaveBar
          dirty={dirty}
          onSave={() => save(draft)}
          onReset={reset}
          pending={pending}
          error={error}
        />
      }
    >
      <div className="flex flex-wrap gap-2">
        {TIER_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={on.has(t)}
            onClick={() =>
              set(
                'tiersToTrack',
                on.has(t) ? draft.tiersToTrack.filter((x) => x !== t) : [...draft.tiersToTrack, t],
              )
            }
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-[color,background-color,border-color,scale] duration-150 active:scale-95',
              on.has(t)
                ? 'border-signal/60 bg-signal-soft text-signal'
                : 'border-line text-dim hover:text-paper',
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </Section>
  )
}

function SimplifySection({ payload }: { payload: SettingsPayload }) {
  const { draft, set, dirty, reset } = useDraft('SimplifyJobs', payload.settings, [
    'simplifyCategories',
    'applyLevelToSimplify',
    'showSimplifyJobs',
    'suggestCompanies',
  ] as const)
  const { save, pending, error } = useSave('SimplifyJobs')
  const health = payload.sourceHealth.find((h) => h.source === 'simplify')
  return (
    <Section
      title="SimplifyJobs"
      dirty={dirty}
      description={
        health && (
          <>
            Last good fetch {relative(health.lastSuccessAt)}
            {health.consecutiveFailures > 0 && (
              <span className="text-stop">
                {' '}
                · {health.consecutiveFailures} failed
                {health.lastError ? `: ${health.lastError}` : ''}
              </span>
            )}
          </>
        )
      }
      footer={
        <SaveBar
          dirty={dirty}
          onSave={() => save(draft)}
          onReset={reset}
          pending={pending}
          error={error}
        />
      }
    >
      <ChipsInput
        label="Trusted categories (other categories need a role keyword)"
        value={draft.simplifyCategories}
        onChange={(v) => set('simplifyCategories', v)}
      />
      <Row label="Apply level keywords" hint="Also require a level keyword in Simplify titles.">
        <Switch
          checked={draft.applyLevelToSimplify}
          onCheckedChange={(v) => set('applyLevelToSimplify', v)}
          aria-label="Apply level keywords to Simplify"
        />
      </Row>
      <Row
        label="Show SimplifyJobs-only roles"
        hint="Roles also found on a company board always show."
      >
        <Switch
          checked={draft.showSimplifyJobs}
          onCheckedChange={(v) => set('showSimplifyJobs', v)}
          aria-label="Show SimplifyJobs jobs"
        />
      </Row>
      <Row
        label="Suggest companies"
        hint="List unlisted companies with matching roles under Suggested."
      >
        <Switch
          checked={draft.suggestCompanies}
          onCheckedChange={(v) => set('suggestCompanies', v)}
          aria-label="Suggest companies from SimplifyJobs"
        />
      </Row>
    </Section>
  )
}

function ScheduleSection({ payload }: { payload: SettingsPayload }) {
  const { draft, set, dirty, valid, reset } = useDraft('Schedule', payload.settings, [
    'maxJobAgeHours',
    'pollEveryMinutes',
    'pushEveryMinutes',
    'quietHours',
    'emailDigest',
    'storeWindowDays',
  ] as const)
  const { save, pending, error } = useSave('Schedule')
  return (
    <Section
      title="Schedule & notifications"
      dirty={dirty}
      description={
        <>
          Last poll {relative(payload.lastPollAt)} · last push {relative(payload.lastPushAt)}
          {payload.backup.lastBackupAt && !payload.backup.problem && (
            <> · last backup {relative(payload.backup.lastBackupAt)}</>
          )}
          {payload.backup.problem && (
            <span className="block text-stop">Backups: {payload.backup.problem}</span>
          )}
        </>
      }
      footer={
        <SaveBar
          dirty={dirty}
          valid={valid}
          onSave={() => save(draft)}
          onReset={reset}
          pending={pending}
          error={error}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          id="pollEvery"
          label="Poll every"
          value={draft.pollEveryMinutes}
          onChange={(n) => set('pollEveryMinutes', n)}
          min={5}
          max={1440}
          suffix="min"
        />
        <NumberField
          id="pushEvery"
          label="Push every"
          value={draft.pushEveryMinutes}
          onChange={(n) => set('pushEveryMinutes', n)}
          min={5}
          max={1440}
          suffix="min"
        />
        <NumberField
          id="maxAge"
          label="Max job age"
          value={draft.maxJobAgeHours}
          onChange={(n) => set('maxJobAgeHours', n)}
          min={1}
          max={168}
          suffix="hours"
        />
      </div>
      <StoreWindowField value={draft.storeWindowDays} onChange={(n) => set('storeWindowDays', n)} />
      <div>
        <p className="mb-1.5 font-mono text-[0.7rem] tracking-wider text-dim uppercase">
          Quiet hours (Eastern)
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="time"
            aria-label="Quiet hours start"
            value={draft.quietHours.start}
            onChange={(e) => set('quietHours', { ...draft.quietHours, start: e.target.value })}
            className="w-32 font-mono"
          />
          <span className="text-dim">to</span>
          <Input
            type="time"
            aria-label="Quiet hours end"
            value={draft.quietHours.end}
            onChange={(e) => set('quietHours', { ...draft.quietHours, end: e.target.value })}
            className="w-32 font-mono"
          />
          <span className="text-xs text-faint">same time = off</span>
        </div>
      </div>
      <Row label="Email digest" hint="Not built yet.">
        <Switch checked={draft.emailDigest} disabled aria-label="Email digest" />
      </Row>
    </Section>
  )
}

function SourcesSection({ payload }: { payload: SettingsPayload }) {
  const { draft, set, dirty, reset } = useDraft('Sources', payload.settings, [
    'disabledSources',
  ] as const)
  const { save, pending, error } = useSave('Sources')
  const off = new Set(draft.disabledSources)
  return (
    <Section
      title="Sources"
      dirty={dirty}
      description="Turning a source off stops polling it; jobs already found stay."
      footer={
        <SaveBar
          dirty={dirty}
          onSave={() => save(draft)}
          onReset={reset}
          pending={pending}
          error={error}
        />
      }
    >
      {payload.sources.map((s) => (
        <Row
          key={s.id}
          label={s.label}
          hint={s.kind === 'ats' ? 'Company job boards' : 'Aggregated list'}
        >
          <Switch
            checked={!off.has(s.id)}
            aria-label={`Poll ${s.label}`}
            onCheckedChange={(v) =>
              set(
                'disabledSources',
                v
                  ? draft.disabledSources.filter((x) => x !== s.id)
                  : [...draft.disabledSources, s.id],
              )
            }
          />
        </Row>
      ))}
    </Section>
  )
}

function SettingsSkeleton() {
  return (
    <div aria-hidden className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Skeleton className="h-[34rem] rounded-xl bg-panel" />
      <div className="space-y-4">
        <Skeleton className="h-64 rounded-xl bg-panel" />
        <Skeleton className="h-32 rounded-xl bg-panel" />
      </div>
    </div>
  )
}

export function SettingsPage() {
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const [dirtySections, setDirtySections] = useState<string[]>([])
  const report = useCallback((section: string, dirty: boolean) => {
    setDirtySections((list) =>
      dirty === list.includes(section)
        ? list
        : dirty
          ? [...list, section]
          : list.filter((s) => s !== section),
    )
  }, [])
  const blocker = useBlocker({
    shouldBlockFn: () => dirtySections.length > 0,
    enableBeforeUnload: () => dirtySections.length > 0,
    withResolver: true,
  })

  return (
    <DirtyContext.Provider value={report}>
      <section>
        <PageHeader
          title="Settings"
          description="Changes apply from the next poll. Each section saves on its own."
        />
        {settings.isError && !settings.data ? (
          <ErrorState
            error={settings.error}
            onRetry={() => settings.refetch()}
            retrying={settings.isFetching}
          />
        ) : !settings.data ? (
          <SettingsSkeleton />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] 2xl:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <MatchingSection settings={settings.data.settings} />
            </div>
            <div className="space-y-4">
              <ScheduleSection payload={settings.data} />
              <TiersSection settings={settings.data.settings} />
              <SimplifySection payload={settings.data} />
              <SourcesSection payload={settings.data} />
            </div>
          </div>
        )}
      </section>

      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent
          title="Leave without saving?"
          description={`Unsaved changes in ${dirtySections.join(', ')} will be lost.`}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => blocker.reset?.()} autoFocus>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Discard and leave
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DirtyContext.Provider>
  )
}
