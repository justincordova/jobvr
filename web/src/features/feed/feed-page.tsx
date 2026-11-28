import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Bookmark, CloudOff, EyeOff, Keyboard, LoaderCircle, Radar, Send } from 'lucide-react'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/page'
import { toast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/ui/reveal'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { JobList } from '@/lib/types'
import { AppliedOverview } from './applied-overview'
import { takeReturned } from './apply-prompt'
import { FEED_GRID } from './columns'
import { FilterBar } from './filter-bar'
import { JobDetailsDialog } from './job-details'
import { JobRow } from './job-row'
import { NewSinceBanner } from './new-banner'
import {
  activeFilterCount,
  CLEARED_FILTERS,
  countsAsVisit,
  DEFAULT_AGE,
  type FeedSearch,
  isBlankSearch,
  recallSearch,
  rememberSearch,
  searchFor,
  toJobQuery,
  type View,
} from './search'
import { ShortcutsDialog } from './shortcuts-dialog'
import { useFeedKeys } from './use-feed-keys'
import { useJobActions } from './use-job-actions'
import {
  bannerDismissed,
  captureFirstResponse,
  dismissBanner,
  isSessionNew,
  sessionNewCount,
  sessionNewJobs,
} from './visit-session'

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
    body: 'Hit Applied on a role once you’ve applied and it moves here, out of your feed, latest first.',
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
          className="grid grid-cols-[1fr_auto] gap-3 border-b border-line/60 py-4 pl-3 sm:grid-cols-[3.75rem_1fr] sm:pl-0"
          style={{ opacity: 1 - i * 0.14 }}
        >
          {/* Phones put the age after the title, like the rows */}
          <Skeleton className="ml-auto h-4 w-7 max-sm:order-last" />
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
// The banner's jobs, kept with the job lists so Save, Hide and Applied (and their undo) update them too
const BANNER_KEY = queryKeys.jobs({ banner: 'new-since-visit' })

export function FeedPage() {
  return <JobsPage search={useSearch({ from: '/' })} />
}

function JobsPage({ search }: { search: FeedSearch }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [bannerOpen, setBannerOpen] = useState(() => !bannerDismissed())
  const [helpOpen, setHelpOpen] = useState(false)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const baseQuery = toJobQuery(search)
  const view = search.view ?? 'feed'
  // A bare page (the home-screen icon, a reload) opens with the filters last used here
  const opening = useRef(true)
  const searchId = JSON.stringify(search)
  useEffect(() => {
    const now: FeedSearch = JSON.parse(searchId)
    if (opening.current) {
      opening.current = false
      const saved = recallSearch(view)
      if (isBlankSearch(now) && !isBlankSearch(saved)) {
        void navigate({ to: '/', search: saved, replace: true })
        return
      }
    }
    rememberSearch(view, now)
  }, [view, searchId, navigate])
  // "Show more" raises the page size; any other change of query starts over
  const queryId = JSON.stringify(baseQuery)
  const [paging, setPaging] = useState({ queryId, limit: PAGE_SIZE })
  const limit = paging.queryId === queryId ? paging.limit : PAGE_SIZE
  const query = limit > PAGE_SIZE ? { ...baseQuery, limit: String(limit) } : baseQuery

  const jobs = useQuery({
    queryKey: queryKeys.jobs(query),
    queryFn: () => unwrap(api.api.jobs.$get({ query })),
    // No timer: the app shell refetches job lists when a poll finishes.
    // Keep the current list on screen while a new filter loads
    placeholderData: keepPreviousData,
  })
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const banner = useQuery<JobList>({
    queryKey: BANNER_KEY,
    queryFn: skipToken,
    gcTime: Number.POSITIVE_INFINITY,
  })
  const { mutate: recordVisit } = useMutation({
    mutationFn: () => unwrap(api.api.jobs.visit.$post()),
  })
  const { setState, setStage } = useJobActions()
  const { mutate: changeState } = setState

  // Back from a posting opened here: offer Mark applied (see apply-prompt.ts). Also
  // once the list loads, for an installed app reloaded while the posting was open
  const listReady = jobs.data !== undefined
  useEffect(() => {
    if (!listReady) return
    const askAboutReturn = () => {
      if (document.visibilityState !== 'visible') return
      const id = takeReturned()
      if (!id) return
      const job = qc
        .getQueriesData<JobList>({ queryKey: queryKeys.allJobs })
        .flatMap(([, cached]) => cached?.jobs ?? [])
        .find((j) => j.id === id)
      if (!job || (job.state !== 'new' && job.state !== 'saved')) return
      const title = job.title.length > 50 ? `${job.title.slice(0, 48).trimEnd()}…` : job.title
      toast(`Did you apply to ${title} at ${job.companyName}?`, {
        tone: 'info',
        duration: 20_000,
        action: {
          label: 'Mark applied',
          onClick: () => changeState({ id: job.id, state: 'applied', also: job.duplicateIds }),
        },
      })
    }
    askAboutReturn()
    document.addEventListener('visibilitychange', askAboutReturn)
    return () => document.removeEventListener('visibilitychange', askAboutReturn)
  }, [listReady, qc, changeState])

  const plainFeed = countsAsVisit(search)
  useEffect(() => {
    if (!plainFeed || !jobs.data || jobs.isPlaceholderData) return
    if (captureFirstResponse(jobs.data)) {
      qc.setQueryData(BANNER_KEY, { ...jobs.data, jobs: jobs.data.newJobs })
      recordVisit()
    }
  }, [plainFeed, jobs.data, jobs.isPlaceholderData, recordVisit, qc])

  const sources = settings.data?.sources ?? []
  const sourceLabel = (id: string) => sources.find((s) => s.id === id)?.label ?? id
  // Filter and search tweaks replace the entry; a view switch is a place you can go Back from
  const update = (next: Partial<FeedSearch>) =>
    navigate({ to: '/', search: searchFor(view, { ...search, ...next }), replace: true })
  // Each view opens with its own last filters (see `recallSearch`)
  const goView = (next: View) => navigate({ to: '/', search: recallSearch(next) })

  const newCount = sessionNewCount()
  // Ones applied to or hidden since leave the banner
  const bannerAll = banner.data?.jobs ?? sessionNewJobs()
  const bannerJobs = bannerAll.filter((j) => j.state === 'new' || j.state === 'saved')
  const list = (jobs.data?.jobs ?? []).filter((j) =>
    // Optimistic state changes remove rows that no longer belong to this view
    view === 'feed' ? j.state === 'new' || j.state === 'saved' : j.state === view,
  )
  const act = (job: (typeof list)[number], state: (typeof list)[number]['state']) =>
    setState.mutate({ id: job.id, state, also: job.duplicateIds })
  const keys = useFeedKeys({
    list,
    onState: act,
    onView: (v) => v !== view && goView(v),
    onHelp: () => setHelpOpen(true),
    onDetails: (job) => setDetailsId(job.id),
  })
  // From the full response, so the panel stays open if the job leaves this view; the
  // banner's new jobs may be hidden by the filters, so they're looked up there too
  const detailsJob =
    jobs.data?.jobs.find((j) => j.id === detailsId) ??
    bannerAll.find((j) => j.id === detailsId) ??
    null
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
      {(settings.data?.sourceOutages.length ?? 0) > 0 && (
        <p
          role="status"
          className="mt-3 flex animate-fade-in items-start gap-2 rounded-lg border border-signal/30 bg-signal-soft/30 px-3 py-2 text-sm text-dim"
        >
          <CloudOff className="mt-0.5 size-4 shrink-0 text-signal" />
          <span>
            {settings.data?.sourceOutages.map((o) => o.label).join(' and ')} look
            {settings.data?.sourceOutages.length === 1 ? 's' : ''} down, so jobs from those boards
            aren’t updating. jobvr retries every poll.
          </span>
        </p>
      )}
      <JobDetailsDialog
        job={detailsJob}
        sourceLabel={sourceLabel}
        onOpenChange={(open) => !open && setDetailsId(null)}
        onState={act}
      />

      {bannerAll.length > 0 && (
        <Reveal open={bannerJobs.length > 0 && bannerOpen && view === 'feed'}>
          <NewSinceBanner
            count={Math.max(newCount - (bannerAll.length - bannerJobs.length), bannerJobs.length)}
            jobs={bannerJobs}
            inList={new Set(list.map((j) => j.id))}
            onOpen={(job) => setDetailsId(job.id)}
            onDismiss={() => {
              dismissBanner()
              setBannerOpen(false)
            }}
          />
        </Reveal>
      )}

      <FilterBar search={search} onChange={update} onView={goView} />

      {/* Below the filters, so switching views never moves them; it slides open and shut */}
      <Reveal open={view === 'applied'} className="mt-4">
        <AppliedOverview active={view === 'applied'} />
      </Reveal>

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
                ? `Nothing matches “${search.q}” here. Check the spelling or pick more tiers.`
                : 'Nothing in these tiers. Pick more to see more.'
              : narrowAge && view === 'feed'
                ? 'Nothing posted in this window. Try a wider age range.'
                : empty.body
          }
          action={
            (filtered || narrowAge || view !== 'feed') && (
              <>
                {filtered && (
                  <Button size="sm" onClick={() => update({ ...CLEARED_FILTERS, q: undefined })}>
                    {search.q ? 'Clear search and tiers' : 'Clear tiers'}
                  </Button>
                )}
                {narrowAge && (
                  <Button size="sm" variant="ghost" onClick={() => update({ age: 'all' })}>
                    Show all ages
                  </Button>
                )}
                {view !== 'feed' && !filtered && (
                  <Button size="sm" variant="ghost" onClick={() => goView('feed')}>
                    Back to the feed
                  </Button>
                )}
              </>
            )
          }
        />
      ) : (
        <ul
          className={cn(
            'mt-4 animate-fade-in border-t border-line/70 transition-opacity duration-200',
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
              onDetails={() => setDetailsId(job.id)}
              onState={(state) => act(job, state)}
              onStage={(stage) => setStage.mutate({ id: job.id, stage })}
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
            pending={jobs.isPlaceholderData}
            onClick={() => setPaging({ queryId, limit: limit + PAGE_SIZE })}
          >
            Show {Math.min(PAGE_SIZE, total - list.length)} more
          </Button>
        </div>
      )}
    </section>
  )
}
