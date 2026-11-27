import {
  Bookmark,
  BookmarkCheck,
  Check,
  EyeOff,
  Eye,
  ExternalLink,
  PanelRightOpen,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, TierBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { relative, safeHref, salaryRange, shortAge } from '@/lib/format'
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
  /** The keyboard selection (j/k). */
  selected?: boolean
  onFocusRow?: () => void
  /** Opens the detail panel. */
  onDetails?: () => void
}

/** An icon-only row action, unboxed like the rest; the label is its accessible name and tooltip. */
function IconAction({
  label,
  className,
  ...props
}: {
  label: string
  className?: string
  onClick: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      className={className}
      {...props}
    />
  )
}

/** Under a day reads green, under three days bright, older fades. */
const freshness = (iso: string) => {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000
  return hours < 24 ? 'text-go' : hours < 72 ? 'text-paper/80' : 'text-faint'
}

/** "Parsippany, NJ, United States" → "Parsippany, NJ": the country only takes room in a US feed. */
const TRAILING_US = /,\s*(?:united states(?: of america)?|usa|us)\s*$/i

/** Matching places first ("King of Prussia, PA" before "Farmington Hills, MI"), then a count. */
function placeSummary(job: Job, shown: number) {
  const rest = job.locations.filter((l) => !job.matchedLocations.includes(l))
  // "Remote - US" is added by the adapters for matching; redundant next to "Remote (US)"
  const ordered = [...job.matchedLocations, ...rest].filter(
    (l, _, all) => l !== REMOTE_US || !all.some((o) => o !== l && /remote/i.test(o)),
  )
  const extra = ordered.length - shown
  const places = ordered.slice(0, shown).map((l) => l.replace(TRAILING_US, ''))
  return `${places.join(' · ')}${extra > 0 ? ` +${extra}` : ''}`
}

export function JobRow({
  job,
  highlighted,
  sourceLabel,
  onState,
  busy,
  selected = false,
  onFocusRow,
  onDetails,
}: JobRowProps) {
  const salary = salaryRange(job.salaryMinUsd, job.salaryMaxUsd)
  const sources = [...new Set(job.sources.map((s) => sourceLabel(s.source)))].join(' · ')
  const years = Math.max(0, ...job.sources.map((s) => s.requiredYears ?? 0))
  const closed = job.closedAt !== null
  const allPlaces = job.locations.join(' · ')

  return (
    <li
      data-job-id={job.id}
      aria-current={selected || undefined}
      onFocus={onFocusRow}
      style={{ viewTransitionName: vtName('job', job.id) }}
      className={cn(
        FEED_GRID,
        'group relative scroll-my-24 border-b border-line/70 py-3 pr-1 transition-colors duration-150 hover:bg-panel/60 lg:items-center lg:py-2.5',
        highlighted && 'bg-signal-soft/40 hover:bg-signal-soft/60',
        selected && 'bg-raised/70 hover:bg-raised/70',
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 right-0 left-0 animate-fade-in rounded-md ring-1 ring-line-strong ring-inset"
        />
      )}
      {highlighted && (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-signal" />
      )}
      <div className="self-start pt-0.5 pl-3 text-right lg:self-center lg:pt-0">
        <time
          dateTime={job.effectiveAt}
          title={new Date(job.effectiveAt).toLocaleString()}
          className={cn(
            'font-mono text-sm tabular-nums',
            highlighted ? 'font-semibold text-signal' : freshness(job.effectiveAt),
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
            href={safeHref(job.url)}
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
            {job.tier !== 'Unlisted' && <TierBadge tier={job.tier} />}
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
            <Badge tone="go" title="The title says it’s entry level, or a new-grad list has it">
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
          {job.duplicateIds.length > 0 && (
            <span
              className="font-mono text-[0.68rem] text-faint"
              title="The company posted this role more than once; Save, Hide, and Applied apply to every copy"
            >
              · {job.duplicateIds.length + 1} postings
            </span>
          )}
          {job.state === 'saved' && <Badge tone="signal">Saved</Badge>}
          {closed && <Badge tone="stop">Closed</Badge>}
          {/* Its own line, under the badges and sources */}
          {job.state === 'applied' && (
            <span
              className="basis-full font-mono text-[0.68rem] text-go"
              title={job.appliedAt ? new Date(job.appliedAt).toLocaleString() : undefined}
            >
              Applied{job.appliedAt && ` ${relative(job.appliedAt)}`}
            </span>
          )}
        </div>
      </div>

      <div className="col-start-2 mt-2.5 flex items-center gap-1.5 sm:col-start-3 sm:mt-0 sm:self-center lg:col-start-5 lg:justify-end">
        {job.state === 'applied' ? (
          <IconAction label="Not applied" onClick={() => onState('new')} disabled={busy}>
            <Undo2 />
          </IconAction>
        ) : (
          <>
            <IconAction
              label="Applied"
              onClick={() => onState('applied')}
              disabled={busy}
              className="hover:text-go"
            >
              <Check />
            </IconAction>
            {job.state === 'saved' ? (
              <IconAction label="Unsave" onClick={() => onState('new')} disabled={busy}>
                <BookmarkCheck className="text-signal" />
              </IconAction>
            ) : (
              job.state !== 'hidden' && (
                <IconAction
                  label="Save"
                  onClick={() => onState('saved')}
                  disabled={busy}
                  className="hover:text-signal"
                >
                  <Bookmark />
                </IconAction>
              )
            )}
            {job.state === 'hidden' ? (
              <IconAction label="Unhide" onClick={() => onState('new')} disabled={busy}>
                <Eye />
              </IconAction>
            ) : (
              <IconAction
                label="Hide"
                onClick={() => onState('hidden')}
                disabled={busy}
                className="hover:text-stop"
              >
                <EyeOff />
              </IconAction>
            )}
          </>
        )}
        {onDetails && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onDetails}
            aria-label={`Details for ${job.title}`}
            title="Details (d)"
            className="size-8 hover:text-info"
          >
            <PanelRightOpen />
          </Button>
        )}
      </div>
    </li>
  )
}
