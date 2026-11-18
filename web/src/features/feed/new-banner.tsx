import { ChevronRight, Sparkle, X } from 'lucide-react'
import { useState } from 'react'
import { shortAge } from '@/lib/format'
import type { Job } from '@/lib/types'

const SHOWN = 3

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
  const shown = expanded ? jobs : jobs.slice(0, SHOWN)
  return (
    <div
      role="status"
      className="mb-4 animate-rise rounded-lg border border-signal/40 bg-signal-soft text-sm"
    >
      <div className="flex items-center gap-3 px-3.5 pt-2.5 pb-1.5">
        <Sparkle className="size-4 shrink-0 text-signal" />
        <p className="flex-1">
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
        {shown.map((job) => (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => onOpen(job)}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-signal/10 pointer-coarse:py-2.5"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-paper">{job.title}</span>
                <span className="text-dim"> · {job.companyName}</span>
                {job.tier !== 'Unlisted' && <span className="text-faint"> · {job.tier}</span>}
              </span>
              {!inList.has(job.id) && (
                <span
                  className="hidden shrink-0 text-xs text-faint sm:inline"
                  title="Your tier, age or search filters hide it from the list below"
                >
                  hidden by filters
                </span>
              )}
              <span className="shrink-0 font-mono text-xs text-faint">
                {shortAge(job.effectiveAt)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
      {jobs.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-signal/20 px-3.5 py-1.5 text-left text-xs text-dim transition-colors hover:text-paper"
        >
          {expanded ? 'Show fewer' : `Show all ${jobs.length}`}
        </button>
      )}
    </div>
  )
}
