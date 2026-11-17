import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Bookmark, EyeOff, Keyboard, LoaderCircle, Radar, Send, Sparkle, X } from 'lucide-react'
import { type ComponentType, useEffect, useState } from 'react'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { api, queryKeys, unwrap } from '@/lib/api'
import { companiesQuery } from '@/lib/companies-query'
import { cn } from '@/lib/cn'
import { FEED_GRID } from './columns'
import { FilterBar } from './filter-bar'
import { JobRow } from './job-row'
import {
  activeFilterCount,
  CLEARED_FILTERS,
  DEFAULT_AGE,
  type FeedSearch,
  toJobQuery,
  type View,
} from './search'
import { ShortcutsDialog } from './shortcuts-dialog'
import { useFeedKeys } from './use-feed-keys'
import { useJobActions } from './use-job-actions'
import { captureFirstResponse, isSessionNew, sessionNewCount } from './visit-session'

const EMPTY_COPY: Record<
  View,
  { title: string; body: string; icon: ComponentType<{ className?: string }> }
> = {
  feed: {
    icon: Radar,
    title: 'Quiet on the wire',
    body: 'No matching roles right now. New listings land here within one poll.',
  },
  saved: {
    icon: Bookmark,
    title: 'Nothing saved',
    body: 'Save roles from the feed to come back to them.',
  },
  applied: {
    icon: Send,
    title: 'Nothing marked applied',
    body: 'Hit Applied on a role once you’ve applied and it moves here, out of your feed.',
  },
  hidden: {
    icon: EyeOff,
    title: 'Nothing hidden',
    body: 'Hidden roles stay out of the feed and pushes.',
  },
}

const TITLES: Record<View, string> = {
  feed: 'New-grad feed',
  saved: 'Saved',
  applied: 'Applied',
  hidden: 'Hidden',
}

function SkeletonRows() {
  return (
    <ul aria-hidden className="mt-4 border-t border-line/70">
      {Array.from({ length: 6 }, (_, i) => (
        <li
          key={i}
          className="grid grid-cols-[3.25rem_1fr] gap-3 border-b border-line/60 py-4 sm:grid-cols-[3.75rem_1fr]"
          style={{ opacity: 1 - i * 0.14 }}
        >
          <Skeleton className="ml-auto h-4 w-7" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3 bg-raised/70" />
          </div>
        </li>
      ))}
    </ul>
  )
}

const PAGE_SIZE = 500

export function FeedPage() {
  const search = useSearch({ from: '/' })
  const navigate = useNavigate({ from: '/' })
  const [bannerOpen, setBannerOpen] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const baseQuery = toJobQuery(search)
  const view = search.view ?? 'feed'
  // "Show more" raises the page size; any other change of query starts over
  const queryId = JSON.stringify(baseQuery)
  const [paging, setPaging] = useState({ queryId, limit: PAGE_SIZE })
  const limit = paging.queryId === queryId ? paging.limit : PAGE_SIZE
  const query = limit > PAGE_SIZE ? { ...baseQuery, limit: String(limit) } : baseQuery

  const jobs = useQuery({
    queryKey: queryKeys.jobs(query),
    queryFn: () => unwrap(api.api.jobs.$get({ query })),
    refetchInterval: 120_000,
    // Keep the current list on screen while a new filter loads
    placeholderData: keepPreviousData,
  })
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const companies = useQuery(companiesQuery)
  const { mutate: recordVisit } = useMutation({
    mutationFn: () => unwrap(api.api.jobs.visit.$post()),
  })
  const { setState } = useJobActions()

  // Only the plain feed counts as a visit: opening on Saved (a home-screen
  // shortcut) or a filtered list would record it and lose the feed's highlights
  const plainFeed =
    view === 'feed' &&
    activeFilterCount(search) === 0 &&
    !search.q &&
    (search.age ?? DEFAULT_AGE) === DEFAULT_AGE
  useEffect(() => {
    if (!plainFeed || !jobs.data || jobs.isPlaceholderData) return
    if (captureFirstResponse(jobs.data)) recordVisit()
  }, [plainFeed, jobs.data, jobs.isPlaceholderData, recordVisit])

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
  const act = (job: (typeof list)[number], state: (typeof list)[number]['state']) =>
    setState.mutate({ id: job.id, state, also: job.duplicateIds })
  const keys = useFeedKeys({
    list,
    onState: act,
    onView: (v) => update({ view: v === 'feed' ? undefined : v }),
    onHelp: () => setHelpOpen(true),
  })
  const empty = EMPTY_COPY[view]
  const filtered = activeFilterCount(search) > 0 || Boolean(search.q)
  // Rows just acted on leave the list before the refetch lowers `total`
  const total = (jobs.data?.total ?? 0) - ((jobs.data?.jobs.length ?? 0) - list.length)
  const narrowAge = (search.age ?? DEFAULT_AGE) !== 'all'
  const refreshing = jobs.isFetching && !jobs.isPending

  return (
    <section>
      <PageHeader
        title={TITLES[view]}
        meta={
          jobs.data && (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-faint tabular-nums">
              {total} role{total === 1 ? '' : 's'}
              <LoaderCircle
                aria-hidden
                className={cn(
                  'size-3 animate-spin transition-opacity duration-300',
                  refreshing ? 'opacity-100' : 'opacity-0',
                )}
              />
            </span>
          )
        }
        actions={
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="hidden items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-faint transition-colors hover:bg-raised hover:text-paper pointer-fine:inline-flex"
          >
            <Keyboard className="size-3.5" />
            Shortcuts
            <kbd className="rounded border border-line px-1 text-[0.65rem]">?</kbd>
          </button>
        }
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />

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
            className="-my-1 rounded-md p-1 text-dim transition-colors hover:bg-signal-soft hover:text-paper pointer-coarse:-my-2.5 pointer-coarse:p-3"
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
      ) : jobs.isError && !jobs.data ? (
        <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} retrying={jobs.isFetching} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={empty.icon}
          title={filtered && view === 'feed' ? 'No matches' : empty.title}
          body={
            filtered
              ? search.q
                ? `Nothing matches “${search.q}” here. Check the spelling or loosen the filters.`
                : 'Nothing fits these filters. Loosen them to see more.'
              : narrowAge && view === 'feed'
                ? 'Nothing posted in this window. Try a wider age range.'
                : empty.body
          }
          action={
            (filtered || narrowAge || view !== 'feed') && (
              <>
                {filtered && (
                  <Button size="sm" onClick={() => update({ ...CLEARED_FILTERS, q: undefined })}>
                    {search.q ? 'Clear search and filters' : 'Clear filters'}
                  </Button>
                )}
                {narrowAge && (
                  <Button size="sm" variant="ghost" onClick={() => update({ age: 'all' })}>
                    Show all ages
                  </Button>
                )}
                {view !== 'feed' && !filtered && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/" search={{}}>
                      Back to the feed
                    </Link>
                  </Button>
                )}
              </>
            )
          }
        />
      ) : (
        <ul
          className={cn(
            'mt-4 border-t border-line/70 transition-opacity duration-200',
            jobs.isPlaceholderData && 'opacity-60',
          )}
        >
          <li
            aria-hidden
            className={cn(
              FEED_GRID,
              'hidden border-b border-line/70 py-2 pr-1 font-mono text-[0.65rem] tracking-wider text-faint uppercase lg:grid',
            )}
          >
            <span className="pl-3 text-right">Posted</span>
            <span>Role</span>
            <span>Location</span>
            <span>Pay · Source</span>
            <span />
          </li>
          {list.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              highlighted={isSessionNew(job.id, job.isNew)}
              sourceLabel={sourceLabel}
              busy={setState.isPending && setState.variables?.id === job.id}
              selected={keys.selected === job.id}
              onFocusRow={() => keys.focusRow(job.id)}
              onState={(state) => act(job, state)}
            />
          ))}
        </ul>
      )}
      {jobs.data && total > list.length && (
        <div className="mt-4 flex items-center justify-center gap-3 font-mono text-xs text-faint">
          <span className="tabular-nums">
            {list.length} of {total}
          </span>
          <Button
            size="sm"
            variant="ghost"
            pending={jobs.isFetching}
            onClick={() => setPaging({ queryId, limit: limit + PAGE_SIZE })}
          >
            Show {Math.min(PAGE_SIZE, total - list.length)} more
          </Button>
        </div>
      )}
    </section>
  )
}
