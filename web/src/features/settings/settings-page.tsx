import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ErrorState, PageHeader, Skeleton } from '@/components/page'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Reveal } from '@/components/ui/reveal'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relative } from '@/lib/format'
import type { Settings, SettingsPayload } from '@/lib/types'
import { ChipsInput } from './chips-input'
import { LIMITS, PROBLEM_LABELS, useDraft } from './draft'
import { Card, Field, LocationsEditor, NumberInput, TierPicker, Toggle } from './parts'

type Key = keyof Settings

/** The page's groups, in order, and the settings each one holds. */
const GROUPS = [
  {
    id: 'feed',
    label: 'Feed',
    keys: ['tiersToTrack', 'entryLevelOnly', 'experienceCutoffYears', 'minSalaryUsd'],
  },
  { id: 'places', label: 'Places', keys: ['locations'] },
  {
    id: 'notifications',
    label: 'Notifications',
    keys: ['pushEveryMinutes', 'maxJobAgeHours', 'quietHours'],
  },
  {
    id: 'sources',
    label: 'Sources',
    keys: ['disabledSources', 'suggestCompanies', 'showSimplifyJobs'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    keys: [
      'pollEveryMinutes',
      'storeWindowDays',
      'requireLevelOnBoards',
      'applyLevelToSimplify',
      'roleKeywords',
      'levelKeywords',
      'excludeKeywords',
      'simplifyCategories',
    ],
  },
] as const satisfies readonly { id: string; label: string; keys: readonly Key[] }[]

function SaveBar({
  count,
  problem,
  pending,
  onSave,
  onDiscard,
}: {
  count: number
  /** The first thing to fix before saving, if any. */
  problem?: string
  pending: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  const open = count > 0
  // Lets the scroll buttons step up out of its way
  useEffect(() => {
    document.body.toggleAttribute('data-savebar', open)
    return () => document.body.removeAttribute('data-savebar')
  }, [open])
  return (
    <div
      inert={!open}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-[translate,opacity] duration-300 ease-(--ease-out) sm:pb-5',
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
      )}
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-signal/40 bg-raised/95 py-2 pr-2 pl-4 shadow-2xl shadow-black/50 backdrop-blur-md">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-signal" aria-hidden />
        {/* Only the text is live, and it changes with the count, not every keystroke */}
        <p role="status" className="min-w-0 flex-1 text-sm">
          {problem ? (
            <span className="text-stop">{problem}</span>
          ) : (
            open && (
              <>
                {count} unsaved change{count === 1 ? '' : 's'}
              </>
            )
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={Boolean(problem)}
          pending={pending}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/** Poll, push and backup at a glance, and anything that's down. */
function StatusStrip({ payload }: { payload: SettingsPayload }) {
  const items: { label: string; tone: 'go' | 'stop' | 'dim'; title?: string }[] = [
    { label: `Polled ${relative(payload.lastPollAt)}`, tone: payload.lastPollAt ? 'go' : 'dim' },
    { label: `Pushed ${relative(payload.lastPushAt)}`, tone: 'dim' },
    payload.backup.problem
      ? { label: 'Backups failing', tone: 'stop', title: payload.backup.problem }
      : {
          label: `Backed up ${relative(payload.backup.lastBackupAt)}`,
          tone: payload.backup.lastBackupAt ? 'go' : 'dim',
        },
    ...payload.sourceOutages.map((o) => ({
      label: `${o.label} down`,
      tone: 'stop' as const,
      title: `Since ${relative(o.since)}: ${o.error}`,
    })),
  ]
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Status">
      {items.map((it) => (
        <li
          key={it.label}
          title={it.title}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.7rem]',
            it.tone === 'stop' ? 'border-stop/40 bg-stop/5 text-stop' : 'border-line text-dim',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              it.tone === 'go' ? 'bg-go' : it.tone === 'stop' ? 'bg-stop' : 'bg-faint',
            )}
          />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

/** Desktop: the groups down the side, the one in view lit up; a click glides to it. */
function SideNav({ dirty, onPick }: { dirty: Set<string>; onPick: (id: string) => void }) {
  const [current, setCurrent] = useState<string>(GROUPS[0].id)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        // At the very bottom the last group can't reach the band; it's the one in view
        const atEnd =
          window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
        const first = atEnd ? GROUPS.at(-1) : GROUPS.find((g) => seen.get(g.id))
        if (first) setCurrent(first.id)
      },
      { rootMargin: '-20% 0px -55% 0px' },
    )
    for (const g of GROUPS) {
      const el = document.getElementById(g.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])
  return (
    <nav
      aria-label="Settings sections"
      // Level with the first card, below the title and status
      className="sticky top-24 hidden self-start lg:col-start-1 lg:row-start-1 lg:mt-[7.5rem] lg:block"
    >
      <ul className="space-y-0.5 border-l border-line">
        {GROUPS.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => {
                setCurrent(g.id)
                onPick(g.id)
              }}
              aria-current={current === g.id ? 'true' : undefined}
              className={cn(
                '-ml-px flex w-full items-center gap-2 border-l-2 py-1.5 pl-4 text-left text-sm transition-colors duration-200',
                current === g.id
                  ? 'border-signal text-paper'
                  : 'border-transparent text-dim hover:text-paper',
              )}
            >
              {g.label}
              {dirty.has(g.id) && (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-signal" />
                  <span className="sr-only">(unsaved)</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const WINDOW_PRESETS = [30, 60] as const

function StoreWindow({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const preset = WINDOW_PRESETS.find((d) => d === value)
  const [custom, setCustom] = useState(false)
  const mode = custom || preset === undefined ? 'custom' : String(preset)
  return (
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
        <span className="animate-fade-in">
          <NumberInput
            id="storeWindow"
            label="Days to keep roles"
            value={value}
            onChange={onChange}
            {...LIMITS.storeWindowDays}
            suffix="days"
          />
        </span>
      )}
    </div>
  )
}

function SettingsForm({ payload, header }: { payload: SettingsPayload; header: ReactNode }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { draft, set, changed, problems, reset, commit, version } = useDraft(payload.settings)
  const [advanced, setAdvanced] = useState(false)
  const save = useMutation({
    mutationFn: ({ json }: { json: Partial<Settings>; sent: Settings }) =>
      unwrap(api.api.settings.$patch({ json })),
    onSuccess: (data, { sent }) => {
      qc.setQueryData(queryKeys.settings, data)
      commit(data.settings, sent)
      void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
      toast('Settings saved: they apply from the next poll')
    },
    onError: (err) => toast.error(err.message),
  })
  const firstProblem = GROUPS.flatMap((g) => g.keys as readonly Key[])
    .map((k) => [k, problems[k]] as const)
    .find(([, p]) => p)
  const dirtyGroups = new Set(
    GROUPS.filter((g) => g.keys.some((k) => changed.includes(k))).map((g) => g.id),
  )
  const blocker = useBlocker({
    shouldBlockFn: () => changed.length > 0,
    enableBeforeUnload: () => changed.length > 0,
    withResolver: true,
  })

  const pick = (id: string) => {
    if (id === 'advanced') setAdvanced(true)
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth' })
  }
  const lists = new Map(payload.sourceHealth.map((h) => [h.source, h]))
  const off = new Set(draft.disabledSources)

  return (
    <>
      <div className={LAYOUT}>
        <SideNav dirty={dirtyGroups} onPick={pick} />
        <div className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-1">
          <div>
            {header}
            <StatusStrip payload={payload} />
          </div>
          <Card
            id="feed"
            title="Feed"
            description="Which roles reach your feed and your phone."
            dirty={dirtyGroups.has('feed')}
          >
            <Field
              label="Tiers to track"
              hint="Their boards are checked every poll, and their roles are pushed."
              stack
            >
              <TierPicker value={draft.tiersToTrack} onChange={(v) => set('tiersToTrack', v)} />
            </Field>
            <Toggle
              id="entryLevelOnly"
              label="Entry level only"
              hint="Only titles that say new grad, junior, I and so on (the new-grad lists always count)."
              checked={draft.entryLevelOnly}
              onChange={(v) => set('entryLevelOnly', v)}
            />
            <Field
              label="Hide roles asking for"
              hint="Years of experience, read from the description. 0 shows them all."
              htmlFor="experienceCutoff"
              error={problems.experienceCutoffYears}
            >
              <NumberInput
                id="experienceCutoff"
                value={draft.experienceCutoffYears}
                onChange={(n) => set('experienceCutoffYears', n)}
                {...LIMITS.experienceCutoffYears}
                suffix="+ years"
              />
            </Field>
            <Field
              label="Minimum salary"
              hint="Only when a posting lists pay. 0 shows them all."
              htmlFor="minSalary"
              error={problems.minSalaryUsd}
            >
              <NumberInput
                id="minSalary"
                value={draft.minSalaryUsd}
                onChange={(n) => set('minSalaryUsd', n)}
                {...LIMITS.minSalaryUsd}
                suffix="USD/yr"
              />
            </Field>
          </Card>

          <Card
            id="places"
            title="Places"
            description="Roles in these places rank higher and are the ones pushed."
            dirty={dirtyGroups.has('places')}
          >
            <LocationsEditor value={draft.locations} onChange={(v) => set('locations', v)} />
            {problems.locations && (
              <p className="animate-fade-in px-5 py-3 text-xs text-stop">{problems.locations}</p>
            )}
          </Card>

          <Card
            id="notifications"
            title="Notifications"
            description={`Last push ${relative(payload.lastPushAt)}.`}
            dirty={dirtyGroups.has('notifications')}
          >
            <Field label="Push every" htmlFor="pushEvery" error={problems.pushEveryMinutes}>
              <NumberInput
                id="pushEvery"
                value={draft.pushEveryMinutes}
                onChange={(n) => set('pushEveryMinutes', n)}
                {...LIMITS.pushEveryMinutes}
                suffix="min"
              />
            </Field>
            <Field
              label="Only push roles newer than"
              hint="Older ones still show in the feed."
              htmlFor="maxAge"
              error={problems.maxJobAgeHours}
            >
              <NumberInput
                id="maxAge"
                value={draft.maxJobAgeHours}
                onChange={(n) => set('maxJobAgeHours', n)}
                {...LIMITS.maxJobAgeHours}
                suffix="hours"
              />
            </Field>
            <Field
              label="Quiet hours"
              hint="Eastern time. No pushes in between; the same time twice turns it off."
              error={problems.quietHours}
              errorId="quietHours-error"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="time"
                  aria-label="Quiet hours start"
                  aria-invalid={!draft.quietHours.start}
                  aria-describedby={problems.quietHours && 'quietHours-error'}
                  value={draft.quietHours.start}
                  onChange={(e) =>
                    set('quietHours', { ...draft.quietHours, start: e.target.value })
                  }
                  className="w-32 font-mono aria-invalid:border-stop/60"
                />
                <span className="text-sm text-dim">to</span>
                <Input
                  type="time"
                  aria-label="Quiet hours end"
                  aria-invalid={!draft.quietHours.end}
                  aria-describedby={problems.quietHours && 'quietHours-error'}
                  value={draft.quietHours.end}
                  onChange={(e) => set('quietHours', { ...draft.quietHours, end: e.target.value })}
                  className="w-32 font-mono aria-invalid:border-stop/60"
                />
              </div>
            </Field>
          </Card>

          <Card
            id="sources"
            title="Sources"
            description="Where roles come from. Turning one off keeps the roles it already found."
            dirty={dirtyGroups.has('sources')}
          >
            {payload.sources.map((s) => {
              const down = payload.sourceOutages.find((o) => o.source === s.id)
              const health = lists.get(s.id)
              return (
                <Field
                  key={s.id}
                  label={s.label}
                  htmlFor={`source-${s.id}`}
                  hint={
                    down ? (
                      <span className="text-stop">
                        Down since {relative(down.since)} ({down.error}). Retried every poll.
                      </span>
                    ) : health ? (
                      <>
                        New-grad list · fetched {relative(health.lastSuccessAt)}
                        {health.consecutiveFailures > 0 && (
                          <span className="text-stop">
                            {' '}
                            · last {health.consecutiveFailures} failed
                          </span>
                        )}
                      </>
                    ) : s.kind === 'ats' ? (
                      'Company job boards'
                    ) : (
                      'New-grad list'
                    )
                  }
                >
                  <Switch
                    id={`source-${s.id}`}
                    checked={!off.has(s.id)}
                    onCheckedChange={(v) =>
                      set(
                        'disabledSources',
                        v
                          ? draft.disabledSources.filter((x) => x !== s.id)
                          : [...draft.disabledSources, s.id],
                      )
                    }
                  />
                </Field>
              )
            })}
            <Toggle
              id="suggestCompanies"
              label="Add companies automatically"
              hint={
                payload.tierModel
                  ? `Companies hiring on the lists are added and rated by ${payload.tierModel}.`
                  : 'Companies hiring on the lists are added as Startup (add an OpenAI key to rate them).'
              }
              checked={draft.suggestCompanies}
              onChange={(v) => set('suggestCompanies', v)}
            />
            <Toggle
              id="showSimplifyJobs"
              label="Show roles found only on the lists"
              hint="Roles also on a company board always show."
              checked={draft.showSimplifyJobs}
              onChange={(v) => set('showSimplifyJobs', v)}
            />
          </Card>

          <section
            id="advanced"
            aria-labelledby="advanced-title"
            className={cn(
              'scroll-mt-24 rounded-xl border bg-panel/60 transition-colors duration-300',
              dirtyGroups.has('advanced') ? 'border-signal/40' : 'border-line',
            )}
          >
            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              aria-expanded={advanced}
              aria-controls="advanced-body"
              className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left transition-colors hover:bg-raised/40"
            >
              <span className="flex-1">
                <span id="advanced-title" className="flex items-center gap-2 font-semibold">
                  Advanced
                  {dirtyGroups.has('advanced') && (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full bg-signal" />
                      <span className="sr-only">(unsaved)</span>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-dim">
                  Polling, history and the keywords behind matching.
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'size-4 text-dim transition-transform duration-300 ease-(--ease-out)',
                  advanced && 'rotate-180',
                )}
              />
            </button>
            <Reveal open={advanced} id="advanced-body">
              <div className="divide-y divide-line/70 border-t border-line/70">
                <Field
                  label="Check for new roles every"
                  htmlFor="pollEvery"
                  error={problems.pollEveryMinutes}
                >
                  <NumberInput
                    id="pollEvery"
                    value={draft.pollEveryMinutes}
                    onChange={(n) => set('pollEveryMinutes', n)}
                    {...LIMITS.pollEveryMinutes}
                    suffix="min"
                  />
                </Field>
                <Field
                  label="Keep roles posted within"
                  hint="Older roles still open sink down the feed. New-grad board roles stay up to 180 days."
                  error={problems.storeWindowDays}
                  errorId="storeWindow-error"
                >
                  <StoreWindow
                    key={version}
                    value={draft.storeWindowDays}
                    onChange={(n) => set('storeWindowDays', n)}
                  />
                </Field>
                <Toggle
                  id="requireLevelOnBoards"
                  label="Boards: titles must say the level"
                  hint="Off lets plain “Software Engineer” through; levels like II or Senior never pass."
                  checked={draft.requireLevelOnBoards}
                  onChange={(v) => set('requireLevelOnBoards', v)}
                />
                <Toggle
                  id="applyLevelToSimplify"
                  label="Lists: titles must say the level"
                  hint="Usually off: the lists are new-grad already."
                  checked={draft.applyLevelToSimplify}
                  onChange={(v) => set('applyLevelToSimplify', v)}
                />
                <KeywordField
                  label="Role keywords"
                  hint="A title needs one of these."
                  error={problems.roleKeywords}
                  value={draft.roleKeywords}
                  onChange={(v) => set('roleKeywords', v)}
                />
                <KeywordField
                  label="Level keywords"
                  hint="These mark a title as entry level."
                  error={problems.levelKeywords}
                  value={draft.levelKeywords}
                  onChange={(v) => set('levelKeywords', v)}
                />
                <KeywordField
                  label="Exclude keywords"
                  hint="Any of these hides a title."
                  tone="stop"
                  value={draft.excludeKeywords}
                  onChange={(v) => set('excludeKeywords', v)}
                />
                <KeywordField
                  label="Trusted SimplifyJobs categories"
                  hint="Roles in these pass without a role keyword."
                  value={draft.simplifyCategories}
                  onChange={(v) => set('simplifyCategories', v)}
                />
              </div>
            </Reveal>
          </section>
        </div>
      </div>

      <SaveBar
        count={changed.length}
        problem={firstProblem && `${PROBLEM_LABELS[firstProblem[0]]}: ${firstProblem[1]}`}
        pending={save.isPending}
        onSave={() =>
          save.mutate({
            json: Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<Settings>,
            sent: draft,
          })
        }
        onDiscard={reset}
      />

      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent
          title="Leave without saving?"
          description={`${changed.length} unsaved change${changed.length === 1 ? '' : 's'} will be lost.`}
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
    </>
  )
}

function KeywordField({
  label,
  hint,
  value,
  onChange,
  tone,
  error,
}: {
  label: string
  hint: ReactNode
  value: string[]
  onChange: (v: string[]) => void
  tone?: 'stop'
  error?: string
}) {
  return (
    <div className="px-5 py-3.5">
      <ChipsInput label={label} value={value} onChange={onChange} tone={tone} />
      <p className="mt-1.5 text-xs text-dim">{hint}</p>
      {error && <p className="mt-0.5 animate-fade-in text-xs text-stop">{error}</p>}
    </div>
  )
}

/**
 * Centered: the settings column sits in the middle of the page, the side nav to
 * its left (balanced by an empty column on wide screens, so the middle is the middle).
 */
const LAYOUT =
  'mx-auto grid max-w-[46rem] gap-x-10 lg:max-w-none lg:grid-cols-[10rem_minmax(0,46rem)] lg:justify-center xl:grid-cols-[10rem_minmax(0,46rem)_10rem]'

function SettingsSkeleton() {
  return (
    <div aria-hidden className="space-y-5">
      <Skeleton className="h-72 rounded-xl bg-panel" />
      <Skeleton className="h-56 rounded-xl bg-panel" />
      <Skeleton className="h-48 rounded-xl bg-panel" />
    </div>
  )
}

const HEADER = (
  <PageHeader title="Settings" description="Saved together. Changes apply from the next poll." />
)

export function SettingsPage() {
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  if (settings.data) {
    return (
      <section className="animate-fade-in">
        <SettingsForm payload={settings.data} header={HEADER} />
      </section>
    )
  }
  return (
    <section className={LAYOUT}>
      <div className="min-w-0 lg:col-start-2">
        {HEADER}
        {settings.isError ? (
          <ErrorState
            error={settings.error}
            onRetry={() => settings.refetch()}
            retrying={settings.isFetching}
          />
        ) : (
          <SettingsSkeleton />
        )}
      </div>
    </section>
  )
}
