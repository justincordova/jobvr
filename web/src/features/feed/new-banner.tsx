import { ChevronRight, EyeOff, Sparkle, X } from 'lucide-react'
import { useState } from 'react'
import { Reveal } from '@/components/ui/reveal'
import { shortAge } from '@/lib/format'
import { TIER_TEXT } from '@/lib/tier-style'
import type { Job } from '@/lib/types'

const SHOWN = 3

function BannerJob({
  job,
  hidden,
  onOpen,
}: {
  job: Job
  hidden: boolean
  onOpen: (job: Job) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(job)}
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-signal/10 pointer-coarse:py-2.5"
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-paper">{job.title}</span>
          <span className="text-dim"> · {job.companyName}</span>
          {job.tier !== 'Unlisted' && (
            <span className={TIER_TEXT[job.tier]}> · {job.tier} tier</span>
          )}
        </span>
        {hidden && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-faint"
            title="Your tier, age or search filters hide it from the list below"
          >
            <EyeOff aria-hidden className="size-3.5" />
            <span className="max-sm:sr-only">hidden by filters</span>
          </span>
        )}
        <span className="shrink-0 font-mono text-xs text-faint">{shortAge(job.effectiveAt)}</span>
        <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  )
}

/**
 * "N new since your last visit", with the new postings themselves: each opens
 * its details, even when the list's filters (tiers, age, search) hide it.
 */
export function NewSinceBanner({
  count,
  jobs,
  inList,
  onOpen,
  onDismiss,
}: {
  count: number
  jobs: readonly Job[]
  inList: ReadonlySet<string>
  onOpen: (job: Job) => void
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-4 rounded-lg border border-signal/40 bg-signal-soft text-sm">
      <div className="flex items-center gap-3 px-3.5 pt-2.5 pb-1.5">
        <Sparkle className="size-4 shrink-0 text-signal" />
        {/* Only the count is live: the list's "hidden by filters" changes as you search */}
        <p role="status" className="flex-1">
          <span className="font-mono font-semibold text-signal">{count}</span> new since your last
          visit
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-1 rounded-md p-1 text-dim transition-colors hover:bg-signal-soft hover:text-paper pointer-coarse:-my-2.5 pointer-coarse:p-3"
        >
          <X className="size-4" />
        </button>
      </div>
      <ul className="px-1.5 pb-1.5">
        {jobs.slice(0, SHOWN).map((job) => (
          <BannerJob key={job.id} job={job} hidden={!inList.has(job.id)} onOpen={onOpen} />
        ))}
      </ul>
      {jobs.length > SHOWN && (
        <Reveal open={expanded}>
          <ul className="px-1.5 pb-1.5">
            {jobs.slice(SHOWN).map((job) => (
              <BannerJob key={job.id} job={job} hidden={!inList.has(job.id)} onOpen={onOpen} />
            ))}
          </ul>
        </Reveal>
      )}
      {jobs.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-signal/20 px-3.5 py-1.5 text-left text-xs text-dim transition-colors hover:text-paper pointer-coarse:py-3"
        >
          {expanded ? 'Show fewer' : `Show all ${jobs.length}`}
        </button>
      )}
    </div>
  )
}
