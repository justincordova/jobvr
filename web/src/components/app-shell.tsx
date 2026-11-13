import { useQuery } from '@tanstack/react-query'
import { Link, Outlet } from '@tanstack/react-router'
import { Building2, KanbanSquare, Radar, Settings2, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { relative } from '@/lib/format'

const NAV: { to: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { to: '/', label: 'Feed', icon: Radar },
  { to: '/applications', label: 'Applications', icon: KanbanSquare },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/suggested', label: 'Suggested', icon: Sparkles },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

function Wordmark() {
  return (
    <Link to="/" className="group flex items-center gap-2.5" aria-label="jobvr home">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping-once rounded-full bg-signal" />
        <span className="relative inline-flex size-2.5 rounded-full bg-signal" />
      </span>
      <span className="font-mono text-[0.95rem] font-semibold tracking-tight">
        job<span className="text-signal">vr</span>
      </span>
    </Link>
  )
}

function PollStatus() {
  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
    refetchInterval: 60_000,
  })
  if (!data) return null
  return (
    <p className="font-mono text-[0.7rem] text-faint" title={data.lastPollAt ?? undefined}>
      polled {relative(data.lastPollAt)}
    </p>
  )
}

function SuggestionCount() {
  const { data } = useQuery({
    queryKey: queryKeys.suggestions,
    queryFn: () => unwrap(api.api.suggestions.$get()),
  })
  if (!data?.length) return null
  return (
    <span className="ml-1 rounded-full bg-raised px-1.5 font-mono text-[0.65rem] text-dim ring-1 ring-line">
      {data.length}
    </span>
  )
}

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <header className="sticky top-0 z-40 -mx-4 flex h-14 items-center justify-between border-b border-line/70 bg-ink/85 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
        <Wordmark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === '/' }}
              className="rounded-md px-3 py-1.5 text-sm text-dim transition-colors hover:text-paper data-[status=active]:bg-raised data-[status=active]:text-paper"
            >
              {label}
              {to === '/suggested' && <SuggestionCount />}
            </Link>
          ))}
        </nav>
        <PollStatus />
      </header>

      <main className="flex-1 pt-5 pb-28 md:pb-12">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="flex flex-col items-center gap-1 py-2.5 text-[0.65rem] text-faint data-[status=active]:text-signal"
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
