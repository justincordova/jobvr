import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Building2, CloudOff, Settings } from 'lucide-react'
import { type ComponentType, useEffect, useRef } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { ScrollNav } from '@/components/scroll-nav'
import { cn } from '@/lib/cn'
import { relative } from '@/lib/format'
import { pollStatus } from '@/lib/poll-status'
import { useOnline } from '@/lib/use-online'

function Wordmark() {
  return (
    <Link
      to="/"
      className="group flex items-center gap-2.5 rounded-md"
      aria-label="jobvr home"
      title="jobvr"
    >
      {/* The radar mark, shared with the tab and the home-screen icon */}
      <img
        src="/favicon.svg"
        alt=""
        width={26}
        height={26}
        className="size-[1.6rem] rounded-[0.34rem] transition-transform duration-300 group-hover:scale-110"
      />
      <span className="font-mono text-[0.95rem] font-semibold tracking-tight">
        job<span className="text-signal">vr</span>
      </span>
    </Link>
  )
}

function PollStatus({ active }: { active: boolean }) {
  const online = useOnline()
  const { data, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
    // Every few seconds while a poll runs, so "polling" turns into "polled" when it's done
    refetchInterval: (q) => (q.state.data && pollStatus(q.state.data).polling ? 3_000 : 60_000),
  })
  if (!online) {
    return (
      <span
        role="status"
        title="No connection: showing what was last loaded. Changes need a connection."
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[0.7rem] text-signal"
      >
        <CloudOff className="size-3.5" /> offline · saved data
      </span>
    )
  }
  if (!data) return <span className="w-24" />
  const { polling, finishedAt } = pollStatus(data)
  const last = finishedAt ? new Date(finishedAt).getTime() : 0
  // Healthy if a poll landed within roughly two intervals of the last refresh;
  // a new install before its first poll isn't late
  const healthy =
    polling ||
    !finishedAt ||
    dataUpdatedAt - last < data.settings.pollEveryMinutes * 2 * 60_000 + 60_000
  const down = data.sourceOutages.map((o) => o.label)
  return (
    <Link
      to="/logs"
      title={
        (polling
          ? 'Polling now · open the logs to follow along'
          : finishedAt
            ? `Last poll finished ${new Date(finishedAt).toLocaleString()} · open the logs`
            : 'No poll has run yet') + (down.length ? ` · ${down.join(', ')} looks down` : '')
      }
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.7rem] transition-colors duration-200 hover:bg-raised hover:text-dim pointer-coarse:min-h-11',
        active ? 'bg-raised text-dim' : 'text-faint',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          polling
            ? 'animate-pulse bg-signal'
            : !healthy
              ? 'bg-stop'
              : down.length
                ? 'bg-signal'
                : 'bg-go',
        )}
      />
      {polling ? (
        <span role="status" className="text-dim">
          polling…
        </span>
      ) : (
        <>polled {relative(finishedAt)}</>
      )}
      {/* Not by colour alone: a late poll says so */}
      {!healthy && <span className="text-stop">· late</span>}
      {down.length > 0 && (
        <span className="text-signal max-sm:sr-only">· {down.join(', ')} down</span>
      )}
    </Link>
  )
}

/**
 * The feed is the app (its views: Feed, Saved, Applied, Hidden); everything
 * else is on the header's right: Logs (the poll status), Companies, Settings.
 */
const HEADER_PAGES: { to: string; label: string; icon?: ComponentType<{ className?: string }> }[] =
  [
    { to: '/logs', label: 'Logs' },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

function HeaderLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  active: boolean
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-8 place-items-center rounded-md transition-colors duration-200 hover:bg-raised hover:text-paper pointer-coarse:size-11',
        active ? 'bg-raised text-signal' : 'text-dim',
      )}
    >
      <Icon className="size-[1.1rem]" />
    </Link>
  )
}

/**
 * Job lists refetch when a poll finishes (seen through the settings check the
 * header already makes every minute), not on a timer: nothing changes between polls.
 */
function useRefreshAfterPoll() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
    refetchInterval: 60_000,
  })
  const finished = data?.lastPollOkAt
  const seen = useRef(finished)
  useEffect(() => {
    if (finished && seen.current && finished !== seen.current) {
      void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
    }
    seen.current = finished
  }, [finished, qc])
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useRefreshAfterPoll()

  useEffect(() => {
    const label = HEADER_PAGES.find((p) => pathname.startsWith(p.to))?.label
    document.title = label ? `${label} · jobvr` : 'jobvr'
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] justify-between gap-4 border-b border-line/70 bg-ink/80 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-lg sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] lg:px-10">
        <Wordmark />
        <div className="flex items-center gap-1">
          <PollStatus active={pathname.startsWith('/logs')} />
          {HEADER_PAGES.map(
            ({ to, label, icon }) =>
              icon && (
                <HeaderLink
                  key={to}
                  to={to}
                  label={label}
                  icon={icon}
                  active={pathname.startsWith(to)}
                />
              ),
          )}
        </div>
      </header>

      <main
        key={pathname}
        className="flex-1 animate-page pt-6 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] in-data-savebar:pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] lg:px-10"
      >
        <Outlet />
      </main>
      <ScrollNav />
    </div>
  )
}
