import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Sparkle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { EmptyState, ErrorState, PageHeader } from '@/components/page'
import { FilterBar } from './filter-bar'
import { JobRow } from './job-row'
import { type FeedSearch, toJobQuery } from './search'
import { useJobActions } from './use-job-actions'
import { captureFirstResponse, isSessionNew, sessionNewCount } from './visit-session'

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  feed: {
    title: 'Quiet on the wire',
    body: 'No matching roles for these filters yet. New listings land here within one poll.',
  },
  saved: { title: 'Nothing saved', body: 'Save roles from the feed to come back to them.' },
  applied: { title: 'No applications yet', body: 'Hit Applied on a role and it moves here.' },
  hidden: { title: 'Nothing hidden', body: 'Hidden roles stay out of the feed and pushes.' },
}

function SkeletonRows() {
  return (
    <ul aria-hidden className="mt-4">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="grid grid-cols-[3.75rem_1fr] gap-3 border-b border-line/60 py-4">
          <div className="ml-auto h-4 w-7 animate-pulse rounded bg-raised" />
          <div className="space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-raised" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-raised/70" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function FeedPage() {
  const search = useSearch({ from: '/' })
  const navigate = useNavigate({ from: '/' })
  const [bannerOpen, setBannerOpen] = useState(true)
  const query = toJobQuery(search)
  const view = search.view ?? 'feed'

  const jobs = useQuery({
    queryKey: queryKeys.jobs(query),
    queryFn: () => unwrap(api.api.jobs.$get({ query })),
    refetchInterval: 120_000,
  })
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const companies = useQuery({
    queryKey: queryKeys.companies,
    queryFn: () => unwrap(api.api.companies.$get()),
  })
  const { mutate: recordVisit } = useMutation({
    mutationFn: () => unwrap(api.api.jobs.visit.$post()),
  })
  const { setState, apply } = useJobActions()

  useEffect(() => {
    if (jobs.data && captureFirstResponse(jobs.data)) recordVisit()
  }, [jobs.data, recordVisit])

  const sources = settings.data?.sources ?? []
  const sourceLabel = (id: string) => sources.find((s) => s.id === id)?.label ?? id
  const locations = (settings.data?.settings.locations ?? [])
    .filter((l) => l.enabled)
    .map((l) => l.label)
  const update = (next: Partial<FeedSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })

  const newCount = sessionNewCount()
  const list = (jobs.data?.jobs ?? []).filter((j) =>
    // Optimistic state changes remove rows that no longer belong to this view
    view === 'feed' ? j.state === 'new' || j.state === 'saved' : j.state === view,
  )
  const empty = EMPTY_COPY[view] ?? EMPTY_COPY.feed

  return (
    <section>
      <PageHeader
        title={view === 'feed' ? 'New-grad feed' : `${view[0]?.toUpperCase()}${view.slice(1)}`}
        meta={
          jobs.data && (
            <span className="font-mono text-xs text-faint">
              {list.length} role{list.length === 1 ? '' : 's'}
            </span>
          )
        }
      />

      {newCount > 0 && bannerOpen && view === 'feed' && (
        <div
          role="status"
          className="mb-4 flex animate-rise items-center gap-3 rounded-lg border border-signal/40 bg-signal-soft px-3.5 py-2.5 text-sm"
        >
          <Sparkle className="size-4 shrink-0 text-signal" />
          <p className="flex-1">
            <span className="font-mono font-semibold text-signal">{newCount}</span> new since your
            last visit
          </p>
          <button
            type="button"
            onClick={() => setBannerOpen(false)}
            aria-label="Dismiss"
            className="rounded p-1 text-dim hover:text-paper"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <FilterBar
        search={search}
        onChange={update}
        locations={locations}
        sources={sources.map((s) => ({ id: s.id, label: s.label }))}
        companies={companies.data ?? []}
      />

      {jobs.isPending ? (
        <SkeletonRows />
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title={empty.title} body={empty.body} />
      ) : (
        <ul className="mt-4 border-t border-line/70">
          {list.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              highlighted={isSessionNew(job.id, job.isNew)}
              sourceLabel={sourceLabel}
              busy={
                (setState.isPending && setState.variables?.id === job.id) ||
                (apply.isPending && apply.variables === job.id)
              }
              onState={(state) => setState.mutate({ id: job.id, state })}
              onApply={() => apply.mutate(job.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
