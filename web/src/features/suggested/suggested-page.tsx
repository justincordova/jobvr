import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, PageHeader } from '@/components/page'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { api, queryKeys, unwrap } from '@/lib/api'
import { relative } from '@/lib/format'
import { vtName, withViewTransition } from '@/lib/motion'
import { type Suggestion, TIERS, type Tier } from '@/lib/types'

function SuggestionCard({
  s,
  atsLabel,
  onAdd,
  onDismiss,
  busy,
}: {
  s: Suggestion
  atsLabel: string
  onAdd: (tier: Tier) => void
  onDismiss: () => void
  busy: boolean
}) {
  const [tier, setTier] = useState<Tier>('Startup')
  const trackable = s.ats !== 'other' && s.slug
  return (
    <li
      style={{ viewTransitionName: vtName('sug', s.id) }}
      className="flex min-w-0 animate-rise flex-col rounded-xl border border-line bg-panel/60 p-4 transition-colors duration-150 hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-semibold tracking-tight">{s.displayName}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-dim">
            <Badge tone={trackable ? 'go' : 'neutral'}>{atsLabel}</Badge>
            {s.slug && <span className="font-mono">{s.slug}</span>}
            <span className="text-faint">· seen {relative(s.lastSeenAt)}</span>
          </p>
        </div>
        <p className="text-right">
          <span className="block font-mono text-2xl leading-none font-semibold text-signal">
            {s.listingCount}
          </span>
          <span className="font-mono text-[0.62rem] tracking-wider text-faint uppercase">
            listing{s.listingCount === 1 ? '' : 's'}
          </span>
        </p>
      </div>
      <ul className="mt-3 flex-1 space-y-1 text-sm text-dim">
        {s.sampleTitles.map((t) => (
          <li key={t} className="truncate before:mr-2 before:text-faint before:content-['›']">
            {t}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
        {trackable
          ? 'Adding tracks it from the next poll (starting with a silent baseline).'
          : s.ats === 'other'
            ? 'Unsupported ATS: added as manual only.'
            : 'Slug unknown: added for review (run discover to find it).'}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <NativeSelect
          aria-label={`Tier for ${s.displayName}`}
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier)}
          className="h-8 w-28 py-1 text-xs pointer-coarse:h-11"
        >
          {TIERS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </NativeSelect>
        <Button size="sm" variant="primary" onClick={() => onAdd(tier)} pending={busy}>
          <Plus /> Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} className="ml-auto">
          <X /> Dismiss
        </Button>
      </div>
    </li>
  )
}

export function SuggestedPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const suggestions = useQuery({
    queryKey: queryKeys.suggestions,
    queryFn: () => unwrap(api.api.suggestions.$get()),
  })
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const done = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.suggestions })
    void qc.invalidateQueries({ queryKey: queryKeys.companies })
  }
  const setList = (fn: (list: Suggestion[]) => Suggestion[]) =>
    withViewTransition(() =>
      qc.setQueryData<Suggestion[]>(queryKeys.suggestions, (list) => list && fn(list)),
    )

  const add = useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: Tier }) =>
      unwrap(api.api.suggestions[':id'].add.$post({ param: { id }, json: { tier } })),
    onSuccess: async (c, { id }) => {
      await setList((list) => list.filter((s) => s.id !== id))
      toast(`${c.name} added to Companies`, {
        action: { label: 'View', onClick: () => void navigate({ to: '/companies' }) },
      })
    },
    onError: (err) => toast.error(err.message),
    onSettled: done,
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => unwrap(api.api.suggestions[':id'].dismiss.$post({ param: { id } })),
    onError: (err) => toast.error(err.message),
    onSettled: done,
  })

  /** Hides the card now; the dismissal only sticks if Undo isn't pressed. */
  const dismissWithUndo = async (s: Suggestion) => {
    await qc.cancelQueries({ queryKey: queryKeys.suggestions })
    const index = suggestions.data?.findIndex((x) => x.id === s.id) ?? -1
    await setList((list) => list.filter((x) => x.id !== s.id))
    toast.undoable(`Dismissed ${s.displayName}`, {
      undo: () =>
        void setList((list) =>
          list.some((x) => x.id === s.id)
            ? list
            : [...list.slice(0, Math.max(0, index)), s, ...list.slice(Math.max(0, index))],
        ),
      commit: () => dismiss.mutate(s.id),
    })
  }

  const atsLabel = (id: string) =>
    settings.data?.sources.find((s) => s.id === id)?.label ?? 'Other ATS'
  const suggestionsOff = settings.data?.settings.suggestCompanies === false

  return (
    <section>
      <PageHeader
        title="Suggested"
        meta={
          suggestions.data &&
          suggestions.data.length > 0 && (
            <span className="font-mono text-xs text-faint tabular-nums">
              {suggestions.data.length}
            </span>
          )
        }
        description="Companies hiring new grads on the lists that aren’t in your list yet. Ones on Greenhouse, Lever or Ashby are added automatically; these are left over (other job sites, or not checked yet)."
      />
      {suggestions.isError && !suggestions.data ? (
        <ErrorState
          error={suggestions.error}
          onRetry={() => suggestions.refetch()}
          retrying={suggestions.isFetching}
        />
      ) : suggestions.isPending ? (
        <ul
          aria-hidden
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
        >
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="h-56 animate-pulse rounded-xl border border-line bg-panel/60" />
          ))}
        </ul>
      ) : suggestions.data.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={suggestionsOff ? 'Suggestions are off' : 'No suggestions right now'}
          body={
            suggestionsOff
              ? 'Turn on “Suggest companies” in Settings to see companies you might be missing.'
              : 'When the new-grad lists have matching roles at companies you don’t track, they show up here.'
          }
          action={
            suggestionsOff && (
              <Button size="sm" asChild>
                <Link to="/settings">Open Settings</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {suggestions.data.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              atsLabel={atsLabel(s.ats)}
              busy={add.isPending && add.variables?.id === s.id}
              onAdd={(tier) => add.mutate({ id: s.id, tier })}
              onDismiss={() => void dismissWithUndo(s)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
