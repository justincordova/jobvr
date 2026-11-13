import { Bookmark, BookmarkCheck, Check, EyeOff, Eye, ExternalLink, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { salaryRange, shortAge } from '@/lib/format'
import { vtName } from '@/lib/motion'
import type { Job } from '@/lib/types'
import { FEED_GRID } from './columns'

interface JobRowProps {
  job: Job
  highlighted: boolean
  sourceLabel: (id: string) => string
  onState: (state: Job['state']) => void
  busy: boolean
}

export function JobRow({ job, highlighted, sourceLabel, onState, busy }: JobRowProps) {
  const salary = salaryRange(job.salaryMinUsd, job.salaryMaxUsd)
  const viaSimplify = job.sources.some((s) => s.source === 'simplify')
  const directSources = [...new Set(job.sources.map((s) => s.source))].filter(
    (s) => s !== 'simplify',
  )
  const closed = job.closedAt !== null

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
          <div className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-paper/85">{job.companyName}</span>
            <Badge tone={job.tier === 'Unlisted' ? 'neutral' : 'info'}>{job.tier}</Badge>
          </div>
        </div>

        <span
          className="truncate lg:line-clamp-2 lg:whitespace-normal"
          title={job.locations.join(' · ')}
        >
          {job.locations.slice(0, 3).join(' · ')}
          {job.locations.length > 3 && ` +${job.locations.length - 3}`}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {salary && <span className="mr-0.5 font-mono text-xs text-go">{salary}</span>}
          {directSources.map((s) => (
            <Badge key={s}>{sourceLabel(s)}</Badge>
          ))}
          {viaSimplify && <Badge tone="neutral">via SimplifyJobs</Badge>}
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
              <Button size="sm" onClick={() => onState('new')} disabled={busy} aria-label="Unsave">
                <BookmarkCheck className="text-signal" /> Unsave
              </Button>
            ) : (
              job.state !== 'hidden' && (
                <Button size="sm" onClick={() => onState('saved')} disabled={busy}>
                  <Bookmark /> Save
                </Button>
              )
            )}
            {job.state === 'hidden' ? (
              <Button size="sm" variant="ghost" onClick={() => onState('new')} disabled={busy}>
                <Eye /> Unhide
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onState('hidden')}
                disabled={busy}
                aria-label="Hide"
              >
                <EyeOff /> <span className="hidden sm:inline">Hide</span>
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  )
}
