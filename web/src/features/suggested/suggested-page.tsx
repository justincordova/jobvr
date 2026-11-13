import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, PageHeader } from '@/components/page'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/input'
import { api, queryKeys, unwrap } from '@/lib/api'
import { relative } from '@/lib/format'
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
    <li className="flex animate-rise flex-col rounded-xl border border-line bg-panel/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
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
          className="h-8 w-28 py-1 text-xs"
        >
          {TIERS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </NativeSelect>
        <Button size="sm" variant="primary" onClick={() => onAdd(tier)} disabled={busy}>
          <Plus /> Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy} className="ml-auto">
          <X /> Dismiss
        </Button>
      </div>
    </li>
  )
}

export function SuggestedPage() {
  const qc = useQueryClient()
  const toast = useToast()
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
  const add = useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: Tier }) =>
      unwrap(api.api.suggestions[':id'].add.$post({ param: { id }, json: { tier } })),
    onSuccess: (c) => toast(`${c.name} added to Companies`),
    onError: (err) => toast(err.message, 'error'),
    onSettled: done,
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => unwrap(api.api.suggestions[':id'].dismiss.$post({ param: { id } })),
    onError: (err) => toast(err.message, 'error'),
    onSettled: done,
  })
  const atsLabel = (id: string) =>
    settings.data?.sources.find((s) => s.id === id)?.label ?? 'Other ATS'

  return (
    <section>
      <PageHeader
        title="Suggested"
        meta={
          <span className="text-sm text-dim">
            Companies hiring on SimplifyJobs that aren’t in your list
          </span>
        }
      />
      {suggestions.isError ? (
        <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />
      ) : suggestions.data?.length === 0 ? (
        <EmptyState
          title="No suggestions right now"
          body="When SimplifyJobs lists matching roles at companies you don’t track, they show up here."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.data?.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              atsLabel={atsLabel(s.ats)}
              busy={
                (add.isPending && add.variables?.id === s.id) ||
                (dismiss.isPending && dismiss.variables === s.id)
              }
              onAdd={(tier) => add.mutate({ id: s.id, tier })}
              onDismiss={() => dismiss.mutate(s.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
