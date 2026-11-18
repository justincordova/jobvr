import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useMemo, useState } from 'react'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { TierFilter } from '@/lib/types'
import { appliedStats, type HeatDay } from './applied-stats'

/** Up to a year, like GitHub; fewer when the card is narrower. */
const MAX_WEEKS = 53
const MIN_WEEKS = 12
const CELL = 13
const MAX_CELL = 20
const GAP = 3
const DAY_LABEL_WIDTH = 28
// Every applied job, whatever the page's filters, so the overview is the whole story
const QUERY = { view: 'applied', limit: '5000' } as const

const LEVEL_CLASS: Record<HeatDay['level'], string> = {
  0: 'bg-raised ring-1 ring-inset ring-line/70',
  1: 'bg-signal/25',
  2: 'bg-signal/50',
  3: 'bg-signal/75',
  4: 'bg-signal',
}

const TIER_DOT: Record<TierFilter, string> = {
  S: 'bg-signal',
  A: 'bg-info',
  Mid: 'bg-go',
  Startup: 'bg-paper/75',
  Corporate: 'bg-dim',
  Unlisted: 'bg-line-strong',
}

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

const longDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const dayText = (d: HeatDay) =>
  `${d.count === 0 ? 'No applications' : `${d.count} applied`} on ${longDate(d.date)}`

/** "Nov" above the first week that starts a month (not on the first column, to avoid clipping). */
const monthLabels = (weeks: HeatDay[][]) =>
  weeks.map((week, i) => {
    const first = week.find((d) => d.date.endsWith('-01'))
    return first && i > 0
      ? new Date(`${first.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })
      : ''
  })

/** How many week columns fit the element's width. */
function useWeeksThatFit() {
  // A callback ref: the card renders nothing until the data loads, so measure when it appears
  const [el, ref] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ weeks: 26, cell: CELL })
  useLayoutEffect(() => {
    if (!el) return
    // Fewer weeks on narrow screens; once a whole year fits, bigger squares fill the width
    const measure = () => {
      const room = el.clientWidth - DAY_LABEL_WIDTH + GAP
      const fit = Math.floor(room / (CELL + GAP))
      setSize(
        fit < MAX_WEEKS
          ? { weeks: Math.max(MIN_WEEKS, fit), cell: CELL }
          : { weeks: MAX_WEEKS, cell: Math.min(MAX_CELL, Math.floor(room / MAX_WEEKS) - GAP) },
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return { ref, ...size }
}

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
      <p className="mt-1.5 font-mono text-[0.62rem] tracking-wider text-faint uppercase">{label}</p>
    </div>
  )
}

/** GitHub-style: one square per day, a tooltip on hover (or tap). */
function Heatmap({ weeks, cell }: { weeks: HeatDay[][]; cell: number }) {
  const months = monthLabels(weeks)
  const [tip, setTip] = useState<{ day: HeatDay; x: number; y: number } | null>(null)
  const show = (day: HeatDay, el: HTMLElement) => {
    const box = el.parentElement?.getBoundingClientRect()
    const square = el.getBoundingClientRect()
    if (!box) return
    // Kept inside the card at the first and last weeks
    const x = Math.min(Math.max(square.left - box.left + square.width / 2, 80), box.width - 80)
    setTip({ day, x, y: square.top - box.top })
  }
  const total = weeks.flat().reduce((n, d) => n + d.count, 0)
  return (
    <div
      role="img"
      aria-label={`Applications per day over the last ${weeks.length} weeks: ${total} in all`}
      onMouseLeave={() => setTip(null)}
      className="relative inline-grid grid-flow-col gap-[3px]"
      style={{
        gridTemplateRows: `auto repeat(7, ${cell}px)`,
        gridTemplateColumns: `${DAY_LABEL_WIDTH - GAP}px repeat(${weeks.length}, ${cell}px)`,
      }}
    >
      <span aria-hidden />
      {DAY_LABELS.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="font-mono text-[0.6rem] text-faint"
          style={{ lineHeight: `${cell}px` }}
        >
          {d}
        </span>
      ))}
      {weeks.map((week, w) => (
        <WeekColumn
          key={week[0]?.date}
          week={week}
          month={months[w] ?? ''}
          active={tip?.day.date}
          onShow={show}
        />
      ))}
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-raised px-2 py-1 text-xs whitespace-nowrap text-paper shadow-lg"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {dayText(tip.day)}
        </span>
      )}
    </div>
  )
}

function WeekColumn({
  week,
  month,
  active,
  onShow,
}: {
  week: HeatDay[]
  month: string
  active: string | undefined
  onShow: (day: HeatDay, el: HTMLElement) => void
}) {
  return (
    <>
      <span
        aria-hidden
        className="h-4 overflow-visible font-mono text-[0.6rem] leading-3 whitespace-nowrap text-faint"
      >
        {month}
      </span>
      {week.map((d) =>
        d.future ? (
          <span key={d.date} aria-hidden />
        ) : (
          <span
            key={d.date}
            aria-hidden
            onMouseEnter={(e) => onShow(d, e.currentTarget)}
            onClick={(e) => onShow(d, e.currentTarget)}
            className={cn(
              'rounded-[3px] transition-shadow duration-100',
              LEVEL_CLASS[d.level],
              active === d.date && 'ring-2 ring-paper/70 ring-inset',
            )}
          />
        ),
      )}
    </>
  )
}

/** The Applied page's header card: pace up top, a GitHub-style year of days, the tier mix in one line. */
export function AppliedOverview() {
  const { data } = useQuery({
    queryKey: queryKeys.jobs(QUERY),
    queryFn: () => unwrap(api.api.jobs.$get({ query: QUERY })),
  })
  const { ref, weeks, cell } = useWeeksThatFit()
  const stats = useMemo(
    () => (data ? appliedStats(data.jobs, new Date(), MAX_WEEKS) : null),
    [data],
  )
  if (!stats || stats.total === 0) return null

  const shown = stats.weeks.slice(-weeks)
  const delta = stats.thisWeek - stats.lastWeek
  return (
    <section
      aria-label="Applications overview"
      className="relative mb-5 animate-rise overflow-hidden rounded-xl border border-line bg-panel/60 p-5"
    >
      {/* A low amber glow behind the number, like the page's top light */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-16 -left-10 size-56 rounded-full bg-signal/10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-4xl leading-none font-semibold tracking-tight text-signal tabular-nums">
            {stats.total}
          </p>
          <p className="font-mono text-[0.68rem] tracking-[0.2em] text-dim uppercase">
            applications
          </p>
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <Stat value={String(stats.thisWeek)} label="this week" />
          <Stat
            value={delta === 0 ? '±0' : delta > 0 ? `+${delta}` : String(delta)}
            label="vs last week"
            tone={delta > 0 ? 'go' : delta < 0 ? 'stop' : undefined}
          />
          <Stat value={`${stats.streak}d`} label="streak" />
          {stats.bestDay && (
            <Stat
              value={String(stats.bestDay.count)}
              label={`best day · ${longDate(stats.bestDay.date)}`}
            />
          )}
        </div>
      </div>

      <div ref={ref} className="relative mt-2 pt-6">
        <Heatmap weeks={shown} cell={cell} />
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <ul aria-label="By tier" className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {stats.tiers.map((t) => (
            <li key={t.tier} className="flex items-center gap-1.5 text-dim">
              <span aria-hidden className={cn('size-2 rounded-full', TIER_DOT[t.tier])} />
              {t.tier}
              <span className="font-mono text-paper tabular-nums">{t.count}</span>
            </li>
          ))}
        </ul>
        <p
          aria-hidden
          className="ml-auto flex items-center gap-1 font-mono text-[0.6rem] text-faint"
        >
          less
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <span key={l} className={cn('size-2.5 rounded-[3px]', LEVEL_CLASS[l])} />
          ))}
          more
        </p>
      </div>
      {stats.undated > 0 && (
        <p className="relative mt-2 text-xs text-faint">
          {stats.undated} applied before jobvr kept dates; they count in the total only.
        </p>
      )}
    </section>
  )
}
