import { Bookmark, BookmarkCheck, Check, EyeOff, Eye, ExternalLink, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { salaryRange, shortAge } from '@/lib/format'
import { vtName } from '@/lib/motion'
import type { Job } from '@/lib/types'
import { FEED_GRID } from './columns'

const REMOTE_US = 'Remote - US'

interface JobRowProps {
  job: Job
  highlighted: boolean
  sourceLabel: (id: string) => string
  onState: (state: Job['state']) => void
  busy: boolean
}

/** Matching places first ("King of Prussia, PA" before "Farmington Hills, MI"), then a count. */
function placeSummary(job: Job, shown: number) {
  const rest = job.locations.filter((l) => !job.matchedLocations.includes(l))
  // "Remote - US" is added by the adapters for matching; redundant next to "Remote (US)"
  const ordered = [...job.matchedLocations, ...rest].filter(
    (l, _, all) => l !== REMOTE_US || !all.some((o) => o !== l && /remote/i.test(o)),
  )
  const extra = ordered.length - shown
  return `${ordered.slice(0, shown).join(' · ')}${extra > 0 ? ` +${extra}` : ''}`
}

export function JobRow({ job, highlighted, sourceLabel, onState, busy }: JobRowProps) {
  const salary = salaryRange(job.salaryMinUsd, job.salaryMaxUsd)
  const sources = [...new Set(job.sources.map((s) => sourceLabel(s.source)))].join(' · ')
  const years = Math.max(0, ...job.sources.map((s) => s.requiredYears ?? 0))
  const closed = job.closedAt !== null
  const allPlaces = job.locations.join(' · ')

  return (
    <li
      style={{ viewTransitionName: vtName('job', job.id) }}
      className={cn(
        FEED_GRID,
        'group relative border-b border-line/70 py-3 pr-1 transition-colors duration-150 hover:bg-panel/60 lg:items-center lg:py-2.5',
        highlighted && 'bg-signal-soft/40 hover:bg-signal-soft/60',
      )}
    >
      {highlighted && (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-signal" />
      )}
      <div className="self-start pt-0.5 pl-3 text-right lg:self-center lg:pt-0">
        <time
          dateTime={job.effectiveAt}
          title={new Date(job.effectiveAt).toLocaleString()}
          className={cn(
            'font-mono text-sm tabular-nums',
            highlighted ? 'font-semibold text-signal' : 'text-dim',
          )}
        >
          {shortAge(job.effectiveAt)}
        </time>
        {highlighted && (
          <span className="mt-0.5 block font-mono text-[0.6rem] tracking-widest text-signal">
            NEW
          </span>
        )}
      </div>

      {/* Stacked on small screens; each block becomes its own column from lg */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim lg:contents">
        <div className="min-w-0 basis-full">
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex max-w-full items-baseline gap-1.5 rounded-sm text-[0.95rem] leading-snug font-semibold tracking-tight text-paper decoration-signal/60 underline-offset-4 visited:text-dim hover:underline',
              closed && 'text-dim line-through decoration-faint',
            )}
          >
            <span className="lg:truncate">{job.title}</span>
            <ExternalLink className="size-3 shrink-0 translate-y-px text-faint opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden" />
          </a>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="shrink-0 truncate text-paper/85 max-lg:max-w-[60%]">
              {job.companyName}
            </span>
            {job.tier !== 'Unlisted' && <Badge tone="info">{job.tier}</Badge>}
            {/* Small screens: the location shares the company line */}
            <span className="min-w-0 truncate lg:hidden" title={allPlaces}>
              <span aria-hidden className="mr-2 text-faint">
                ·
              </span>
              {placeSummary(job, 1)}
            </span>
          </div>
        </div>

        <span className="hidden lg:line-clamp-2" title={allPlaces}>
          {placeSummary(job, 2)}
        </span>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {job.entryLevel && (
            <Badge
              tone="go"
              title="The title says it’s entry level, or SimplifyJobs (new grad only) lists it"
            >
              Entry level
            </Badge>
          )}
          {years > 0 && (
            <Badge title={`The description asks for ${years}+ years of experience`}>
              {years}+ yrs
            </Badge>
          )}
          {salary && <span className="font-mono text-xs text-go">{salary}</span>}
          <span className="font-mono text-[0.68rem] text-faint">{sources}</span>
          {job.state === 'saved' && <Badge tone="signal">Saved</Badge>}
          {job.state === 'applied' && <Badge tone="go">Applied</Badge>}
          {closed && <Badge tone="stop">Closed</Badge>}
        </div>
      </div>

      <div className="col-start-2 mt-2.5 flex items-center gap-1.5 sm:col-start-3 sm:mt-0 sm:self-center lg:col-start-5 lg:justify-end">
        {job.state === 'applied' ? (
          <Button size="sm" variant="ghost" onClick={() => onState('new')} disabled={busy}>
            <Undo2 /> Not applied
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => onState('applied')}
              disabled={busy}
              className="hover:border-go/50 hover:text-go"
            >
              <Check /> Applied
            </Button>
            {job.state === 'saved' ? (
              <Button size="sm" onClick={() => onState('new')} disabled={busy}>
                <BookmarkCheck className="text-signal" />
                <span className="max-sm:sr-only">Unsave</span>
              </Button>
            ) : (
              job.state !== 'hidden' && (
                <Button size="sm" onClick={() => onState('saved')} disabled={busy}>
                  <Bookmark />
                  <span className="max-sm:sr-only">Save</span>
                </Button>
              )
            )}
            {job.state === 'hidden' ? (
              <Button size="sm" variant="ghost" onClick={() => onState('new')} disabled={busy}>
                <Eye /> Unhide
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onState('hidden')} disabled={busy}>
                <EyeOff />
                <span className="max-sm:sr-only">Hide</span>
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  )
}
