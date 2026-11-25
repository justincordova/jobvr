import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Pause, Play, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/page'
import { toast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relative, shortDate } from '@/lib/format'
import type { LogEntry } from '@/lib/types'
import { logsAsText } from './logs-text'

const POLL_MS = 4_000
/** Matches the server's buffer: everything it still has fits. */
const MAX_ENTRIES = 1000

type LevelFilter = 'all' | 'warn' | 'error'
const LEVEL_FILTERS: { id: LevelFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'warn', label: 'Warnings' },
  { id: 'error', label: 'Errors' },
]
const SHOWN: Record<LevelFilter, readonly LogEntry['level'][]> = {
  all: ['info', 'warn', 'error', 'fatal'],
  warn: ['warn', 'error', 'fatal'],
  error: ['error', 'fatal'],
}
type RangeFilter = 'all' | 'today' | 'hour'
const RANGE_FILTERS: { id: RangeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'hour', label: '1h' },
]
const since = (range: RangeFilter, now: number) => {
  if (range === 'hour') return now - 3_600_000
  if (range === 'today') return new Date(now).setHours(0, 0, 0, 0)
  return 0
}
const TONE = { info: 'neutral', warn: 'signal', error: 'stop', fatal: 'stop' } as const
const COPIED_MS = 1_800

interface LogState {
  after: number
  startedAt: string | null
  entries: LogEntry[]
}

/**
 * Fetches only what's new since the last call and appends it. A server restart
 * (a different `startedAt`) starts the list over.
 */
function useLogs(live: boolean) {
  const state = useRef<LogState>({ after: 0, startedAt: null, entries: [] })
  return useQuery({
    queryKey: queryKeys.logs,
    queryFn: async () => {
      const fetchAfter = (after: number) =>
        unwrap(api.api.logs.$get({ query: { after: String(after), limit: String(MAX_ENTRIES) } }))
      const current = state.current
      let data = await fetchAfter(current.after)
      let kept = current.entries
      if (current.startedAt !== null && data.startedAt !== current.startedAt) {
        data = await fetchAfter(0)
        kept = []
      }
      state.current = {
        after: data.latestSeq,
        startedAt: data.startedAt,
        entries: [...kept, ...data.entries].slice(-MAX_ENTRIES),
      }
      return state.current
    },
    refetchInterval: live ? POLL_MS : false,
    // Each visit starts from the server's buffer, not a stale copy
    gcTime: 0,
  })
}

function clock(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return d.toDateString() === new Date().toDateString() ? time : `${shortDate(iso)} ${time}`
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <li className="grid grid-cols-[auto_3.25rem_1fr] items-baseline gap-x-3 px-4 py-1.5 font-mono text-xs hover:bg-raised/50">
      <time
        dateTime={entry.time}
        title={new Date(entry.time).toLocaleString()}
        className="text-faint tabular-nums"
      >
        {clock(entry.time)}
      </time>
      <Badge tone={TONE[entry.level]} className="justify-center">
        {entry.level}
      </Badge>
      <div className="min-w-0 break-words">
        {entry.module && <span className="text-dim">{entry.module} · </span>}
        <span className={cn(entry.level === 'info' ? 'text-paper' : 'text-signal')}>
          {entry.msg}
        </span>
        {entry.error && <p className="mt-0.5 text-stop">{entry.error}</p>}
      </div>
    </li>
  )
}

/** Copies the lines on screen (the filters decide what), oldest first. */
function CopyButton({ entries }: { entries: LogEntry[] }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const count = entries.length
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logsAsText(entries))
    } catch {
      toast.error('Couldn’t copy: the browser blocked the clipboard')
      return
    }
    toast(`Copied ${count} log ${count === 1 ? 'line' : 'lines'}`, { tone: 'success' })
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void copy()}
      disabled={count === 0}
      title="Copy the lines shown, oldest first. Narrow them with the filters."
      className={cn(copied && 'text-go hover:text-go')}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy'}
      <span className="font-mono text-faint tabular-nums">{count}</span>
    </Button>
  )
}

export function LogsPage() {
  const [live, setLive] = useState(true)
  const [level, setLevel] = useState<LevelFilter>('all')
  const [range, setRange] = useState<RangeFilter>('all')
  const [search, setSearch] = useState('')
  const logs = useLogs(live)

  // Oldest first, as copied; the list shows it reversed
  const matching = useMemo(() => {
    const entries = logs.data?.entries ?? []
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    // Measured from the last refresh, which is at most a few seconds old while live
    const from = since(range, logs.dataUpdatedAt)
    return entries
      .filter((e) => SHOWN[level].includes(e.level))
      .filter((e) => from === 0 || new Date(e.time).getTime() >= from)
      .filter((e) => {
        if (words.length === 0) return true
        const text = `${e.module ?? ''} ${e.msg} ${e.error ?? ''}`.toLowerCase()
        return words.every((w) => text.includes(w))
      })
  }, [logs.data, logs.dataUpdatedAt, level, range, search])
  const shown = useMemo(() => [...matching].reverse(), [matching])

  const total = logs.data?.entries.length ?? 0

  return (
    <section>
      <PageHeader
        title="Logs"
        meta={
          logs.data && (
            <span className="font-mono text-xs text-faint tabular-nums">
              {shown.length === total ? total : `${shown.length} of ${total}`}
            </span>
          )
        }
        description={
          <>
            What the server logged since it started
            {logs.data?.startedAt && <> ({relative(logs.data.startedAt)})</>}: info and above, the
            last {MAX_ENTRIES} lines, with secrets removed.
          </>
        }
        actions={
          <div className="flex items-center gap-1">
            <CopyButton entries={matching} />
            <Button size="sm" variant="ghost" onClick={() => setLive((v) => !v)}>
              {live ? <Pause /> : <Play />}
              {live ? 'Pause' : 'Resume'}
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  live && !logs.isError ? 'animate-pulse bg-go' : 'bg-faint',
                )}
              />
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Level" value={level} options={LEVEL_FILTERS} onChange={setLevel} />
        <Segmented label="Time" value={range} options={RANGE_FILTERS} onChange={setRange} />
        <Input
          type="search"
          aria-label="Filter log lines"
          placeholder="Filter, e.g. poll failed"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {logs.isError && logs.data && (
          <span role="status" className="text-xs text-stop">
            Can’t reach jobvr: showing what was loaded.
          </span>
        )}
      </div>

      {logs.isError && !logs.data ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} retrying={logs.isFetching} />
      ) : !logs.data ? (
        <div aria-hidden className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={total === 0 ? 'Nothing logged yet' : 'No lines match'}
          body={
            total === 0
              ? 'Polls, pushes and problems show up here as they happen.'
              : 'Try another level or clear the filter.'
          }
          action={
            total > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  setLevel('all')
                  setRange('all')
                  setSearch('')
                }}
              >
                Show every line
              </Button>
            )
          }
        />
      ) : (
        <ol
          aria-label="Log lines, newest first"
          className="animate-fade-in divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-panel/60"
        >
          {shown.map((e) => (
            <LogRow key={e.seq} entry={e} />
          ))}
        </ol>
      )}
    </section>
  )
}
