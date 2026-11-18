import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { TierFilter } from '@/lib/types'
import { appliedStats, type HeatDay } from './applied-stats'

const WEEKS = 16
// Every applied job, whatever the page's filters, so the overview is the whole story
const QUERY = { view: 'applied', limit: '5000' } as const

const LEVEL_CLASS: Record<HeatDay['level'], string> = {
  0: 'bg-raised ring-1 ring-inset ring-line/70',
  1: 'bg-signal/25',
  2: 'bg-signal/50',
  3: 'bg-signal/75',
  4: 'bg-signal shadow-[0_0_10px_-2px] shadow-signal/60',
}

const TIER_CLASS: Record<TierFilter, string> = {
  S: 'bg-signal',
  A: 'bg-info',
  Mid: 'bg-go',
  Startup: 'bg-paper/75',
  Corporate: 'bg-dim',
  Unlisted: 'bg-line-strong',
}

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

const dayTitle = (d: HeatDay) => {
  const date = new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return `${date}: ${d.count === 0 ? 'none' : `${d.count} applied`}`
}

/** "Nov" above the first week that starts a month. */
const monthLabels = (weeks: HeatDay[][]) =>
  weeks.map((week, i) => {
    const first = week.find((d) => d.date.endsWith('-01')) ?? (i === 0 ? week[0] : undefined)
    return first
      ? new Date(`${first.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })
      : ''
  })

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'go' | 'stop' }) {
  return (
    <div>
      <p
        className={cn(
          'font-mono text-lg leading-none font-semibold tabular-nums',
          tone === 'go' ? 'text-go' : tone === 'stop' ? 'text-stop' : 'text-paper',
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[0.62rem] tracking-wider text-faint uppercase">{label}</p>
    </div>
  )
}

function Heatmap({ weeks }: { weeks: HeatDay[][] }) {
  const months = monthLabels(weeks)
  const total = weeks.flat().reduce((n, d) => n + d.count, 0)
  return (
    <figure className="min-w-0">
      <div className="overflow-x-auto scrollbar-none">
        <div
          role="img"
          aria-label={`Applications per day over the last ${weeks.length} weeks: ${total} in all`}
          className="inline-grid grid-flow-col grid-rows-[auto_repeat(7,0.75rem)] gap-[3px]"
        >
          <span aria-hidden />
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              aria-hidden
              className="pr-1.5 font-mono text-[0.58rem] leading-3 text-faint"
            >
              {d}
            </span>
          ))}
          {weeks.map((week, w) => (
            <WeekColumn key={week[0]?.date} week={week} month={months[w] ?? ''} index={w} />
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex items-center gap-1.5 font-mono text-[0.6rem] text-faint">
        less
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <span key={l} aria-hidden className={cn('size-2.5 rounded-[3px]', LEVEL_CLASS[l])} />
        ))}
        more
      </figcaption>
    </figure>
  )
}

function WeekColumn({ week, month, index }: { week: HeatDay[]; month: string; index: number }) {
  return (
    <>
      <span
        aria-hidden
        className="h-3 font-mono text-[0.58rem] leading-3 whitespace-nowrap text-faint"
      >
        {month}
      </span>
      {week.map((d, i) => (
        <span
          key={d.date}
          title={d.future ? undefined : dayTitle(d)}
          style={{ animationDelay: `${(index * 7 + i) * 4}ms` }}
          className={cn(
            'size-3 animate-fade-in rounded-[3px]',
            d.future ? 'invisible' : LEVEL_CLASS[d.level],
          )}
        />
      ))}
    </>
  )
}

function TierMix({
  tiers,
  total,
}: {
  tiers: { tier: TierFilter; count: number }[]
  total: number
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 font-mono text-[0.62rem] tracking-wider text-faint uppercase">By tier</p>
      <div
        role="img"
        aria-label={tiers.map((t) => `${t.tier} ${t.count}`).join(', ')}
        className="flex h-2 overflow-hidden rounded-full bg-raised"
      >
        {tiers.map((t) => (
          <span
            key={t.tier}
            className={cn(
              'h-full transition-[width] duration-500 ease-(--ease-out)',
              TIER_CLASS[t.tier],
            )}
            style={{ width: `${(t.count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {tiers.map((t) => (
          <li key={t.tier} className="flex items-center gap-1.5 text-dim">
            <span aria-hidden className={cn('size-2 rounded-full', TIER_CLASS[t.tier])} />
            {t.tier}
            <span className="ml-auto font-mono text-paper tabular-nums">{t.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The Applied page's header card: total, pace, a 16-week heatmap and the tier mix. */
export function AppliedOverview() {
  const { data } = useQuery({
    queryKey: queryKeys.jobs(QUERY),
    queryFn: () => unwrap(api.api.jobs.$get({ query: QUERY })),
  })
  const stats = useMemo(() => (data ? appliedStats(data.jobs, new Date(), WEEKS) : null), [data])
  if (!stats || stats.total === 0) return null

  const delta = stats.thisWeek - stats.lastWeek
  return (
    <section
      aria-label="Applications overview"
      className="relative mb-5 grid animate-rise gap-6 overflow-hidden rounded-xl border border-line bg-panel/60 p-5 md:grid-cols-[auto_1fr] xl:grid-cols-[auto_auto_minmax(14rem,1fr)]"
    >
      {/* A low amber glow behind the number, like the page's top light */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-16 -left-10 size-56 rounded-full bg-signal/10 blur-3xl"
      />
      <div className="relative flex flex-col justify-between gap-5">
        <div>
          <p className="font-mono text-5xl leading-none font-semibold tracking-tight text-signal tabular-nums">
            {stats.total}
          </p>
          <p className="mt-2 font-mono text-[0.68rem] tracking-[0.2em] text-dim uppercase">
            applications
          </p>
        </div>
        <div className="flex gap-6">
          <Stat value={String(stats.thisWeek)} label="this week" />
          <Stat
            value={delta === 0 ? '±0' : delta > 0 ? `+${delta}` : String(delta)}
            label="vs last week"
            tone={delta > 0 ? 'go' : delta < 0 ? 'stop' : undefined}
          />
          <Stat value={`${stats.streak}d`} label="streak" />
        </div>
      </div>
      <Heatmap weeks={stats.weeks} />
      <div className="md:col-span-2 xl:col-span-1">
        <TierMix tiers={stats.tiers} total={stats.total} />
        {stats.undated > 0 && (
          <p className="mt-3 text-xs text-faint">
            {stats.undated} applied before jobvr kept dates; they count in the total only.
          </p>
        )}
      </div>
    </section>
  )
}
