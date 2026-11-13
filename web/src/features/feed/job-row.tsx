import { Bookmark, BookmarkCheck, Check, EyeOff, Eye, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { salaryRange, shortAge } from '@/lib/format'
import type { Job } from '@/lib/types'

interface JobRowProps {
  job: Job
  highlighted: boolean
  sourceLabel: (id: string) => string
  onState: (state: 'saved' | 'hidden' | 'new') => void
  onApply: () => void
  busy: boolean
}

export function JobRow({ job, highlighted, sourceLabel, onState, onApply, busy }: JobRowProps) {
  const salary = salaryRange(job.salaryMinUsd, job.salaryMaxUsd)
  const viaSimplify = job.sources.some((s) => s.source === 'simplify')
  const directSources = [...new Set(job.sources.map((s) => s.source))].filter(
    (s) => s !== 'simplify',
  )
  const closed = job.closedAt !== null

  return (
    <li
      className={cn(
        'group relative grid grid-cols-[3.25rem_1fr] gap-x-3 border-b border-line/70 py-3.5 pr-1 transition-colors hover:bg-panel/60 sm:grid-cols-[3.75rem_1fr_auto]',
        highlighted && 'bg-signal-soft/40 hover:bg-signal-soft/60',
      )}
    >
      {highlighted && (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-signal" />
      )}
      <div className="pt-0.5 pl-3 text-right">
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
          <span className="mt-1 block font-mono text-[0.6rem] tracking-widest text-signal">
            NEW
          </span>
        )}
      </div>

      <div className="min-w-0">
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex items-baseline gap-1.5 text-[0.98rem] leading-snug font-semibold tracking-tight text-paper decoration-signal/60 underline-offset-4 hover:underline',
            closed && 'text-dim line-through decoration-faint',
          )}
        >
          {job.title}
          <ExternalLink className="size-3 shrink-0 translate-y-px text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
          <span className="text-paper/85">{job.companyName}</span>
          <Badge tone={job.tier === 'Unlisted' ? 'neutral' : 'info'}>{job.tier}</Badge>
          {job.locations.length > 0 && (
            <span className="truncate" title={job.locations.join(' · ')}>
              {job.locations.slice(0, 3).join(' · ')}
              {job.locations.length > 3 && ` +${job.locations.length - 3}`}
            </span>
          )}
          {salary && <span className="font-mono text-xs text-go">{salary}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {directSources.map((s) => (
            <Badge key={s}>{sourceLabel(s)}</Badge>
          ))}
          {viaSimplify && <Badge tone="neutral">via SimplifyJobs</Badge>}
          {job.state === 'saved' && <Badge tone="signal">Saved</Badge>}
          {job.state === 'applied' && <Badge tone="go">Applied</Badge>}
          {closed && <Badge tone="stop">Closed</Badge>}
        </div>
      </div>

      <div className="col-start-2 mt-3 flex items-center gap-1.5 sm:col-start-3 sm:mt-0 sm:self-center">
        {job.state !== 'applied' && (
          <>
            <Button
              size="sm"
              onClick={onApply}
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
