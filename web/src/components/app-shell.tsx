import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Building2, CloudOff, Settings } from 'lucide-react'
import { type ComponentType, useEffect, useRef } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relative } from '@/lib/format'
import { useOnline } from '@/lib/use-online'

function Wordmark() {
  return (
    <Link to="/" className="group flex items-center gap-2.5 rounded-md" aria-label="jobvr home">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping-once rounded-full bg-signal" />
        <span className="relative inline-flex size-2.5 rounded-full bg-signal transition-transform duration-300 group-hover:scale-125" />
      </span>
      <span className="font-mono text-[0.95rem] font-semibold tracking-tight">
        job<span className="text-signal">vr</span>
      </span>
    </Link>
  )
}

function PollStatus() {
  const online = useOnline()
  const { data, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
    refetchInterval: 60_000,
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
  const last = data.lastPollAt ? new Date(data.lastPollAt).getTime() : 0
  // Healthy if a poll landed within roughly two intervals of the last refresh
  const healthy = dataUpdatedAt - last < data.settings.pollEveryMinutes * 2 * 60_000 + 60_000
  const down = data.sourceOutages.map((o) => o.label)
  return (
    <Link
      to="/logs"
      title={
        (data.lastPollAt
          ? `Last poll ${new Date(data.lastPollAt).toLocaleString()} · open the logs`
          : 'No poll has run yet') + (down.length ? ` · ${down.join(', ')} looks down` : '')
      }
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[0.7rem] text-faint transition-colors hover:text-dim"
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          !healthy ? 'bg-stop' : down.length ? 'bg-signal' : 'bg-go',
        )}
      />
      polled {relative(data.lastPollAt)}
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
      <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] justify-between gap-4 border-b border-line/70 bg-ink/80 px-4 backdrop-blur-lg sm:px-6 lg:px-10">
        <Wordmark />
        <div className="flex items-center gap-1">
          <PollStatus />
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
        className="flex-1 animate-page px-4 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10"
      >
        <Outlet />
      </main>
    </div>
  )
}
