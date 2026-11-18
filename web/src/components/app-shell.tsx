import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Building2, CloudOff, Radar, Send, Settings2, Sparkles } from 'lucide-react'
import { type ComponentType, useEffect } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { recallSearch } from '@/features/feed/search'
import { cn } from '@/lib/cn'
import { relative } from '@/lib/format'
import { useIndicator } from '@/lib/use-indicator'
import { useOnline } from '@/lib/use-online'

const NAV: { to: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { to: '/', label: 'Feed', icon: Radar },
  { to: '/applied', label: 'Applied', icon: Send },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/suggested', label: 'Suggested', icon: Sparkles },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

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
      to="/settings"
      title={
        (data.lastPollAt
          ? `Last poll ${new Date(data.lastPollAt).toLocaleString()}`
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

function useSuggestionCount() {
  const { data } = useQuery({
    queryKey: queryKeys.suggestions,
    queryFn: () => unwrap(api.api.suggestions.$get()),
  })
  return data?.length ?? 0
}

/** Feed and Applied reopen with the filters they last had (see `recallSearch`). */
const navSearch = (to: string) =>
  to === '/'
    ? () => recallSearch('feed')
    : to === '/applied'
      ? () => recallSearch('applied')
      : undefined

const isActive = (to: string, pathname: string) =>
  to === '/' ? pathname === '/' : pathname.startsWith(to)

function DesktopNav({ pathname }: { pathname: string }) {
  const suggestions = useSuggestionCount()
  const { ref, style } = useIndicator<HTMLElement>('[data-status="active"]', pathname)
  return (
    <nav ref={ref} className="relative hidden items-center gap-0.5 md:flex" aria-label="Main">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-md bg-raised ring-1 ring-line"
        style={style}
      />
      {NAV.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          search={navSearch(to)}
          activeOptions={{ exact: to === '/', includeSearch: false }}
          className="relative flex items-center rounded-md px-3 py-1.5 text-sm text-dim transition-colors duration-200 hover:text-paper data-[status=active]:text-paper"
        >
          {label}
          {to === '/suggested' && suggestions > 0 && (
            <span className="ml-1.5 rounded-full bg-signal-soft px-1.5 font-mono text-[0.65rem] text-signal">
              {suggestions}
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}

function MobileNav({ pathname }: { pathname: string }) {
  const suggestions = useSuggestionCount()
  const { ref, style } = useIndicator<HTMLElement>('[data-status="active"]', pathname)
  return (
    <nav
      ref={ref}
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 flex justify-center" style={style}>
        <span className="h-0.5 w-8 rounded-b-full bg-signal" />
      </span>
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          search={navSearch(to)}
          activeOptions={{ exact: to === '/', includeSearch: false }}
          className="group relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[0.65rem] text-faint transition-colors duration-200 data-[status=active]:text-paper"
        >
          <span className="relative">
            <Icon className="size-5 transition-[color,scale] duration-200 group-active:scale-90 group-data-[status=active]:text-signal" />
            {to === '/suggested' && suggestions > 0 && (
              <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-signal ring-2 ring-panel" />
            )}
          </span>
          {label}
        </Link>
      ))}
    </nav>
  )
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    const page = NAV.find((n) => isActive(n.to, pathname))
    document.title = page && page.to !== '/' ? `${page.label} · jobvr` : 'jobvr'
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] justify-between gap-4 border-b border-line/70 bg-ink/80 px-4 backdrop-blur-lg sm:px-6 lg:px-10">
        <Wordmark />
        <DesktopNav pathname={pathname} />
        <PollStatus />
      </header>

      <main
        key={pathname}
        className="flex-1 animate-page px-4 pt-6 pb-28 sm:px-6 md:pb-16 lg:px-10"
      >
        <Outlet />
      </main>

      <MobileNav pathname={pathname} />
    </div>
  )
}
