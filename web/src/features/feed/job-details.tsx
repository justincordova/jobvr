import { useQuery } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, Check, ExternalLink, EyeOff, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { TierBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api, unwrap } from '@/lib/api'
import { relative, safeHref, salaryRange } from '@/lib/format'
import type { Job } from '@/lib/types'

const TOPIC_LABEL = {
  experience: 'Experience',
  degree: 'Degree',
  visa: 'Visa',
  workplace: 'Where',
  pay: 'Pay',
} as const

const detailsKey = (id: string) => ['job-details', id] as const

/**
 * The posting without leaving the feed: what it asks for first (years,
 * degree, visa, where, pay), then the full text. Opened with the row's
 * Details button or "d".
 */
export function JobDetailsDialog({
  job: current,
  sourceLabel,
  onOpenChange,
  onState,
}: {
  job: Job | null
  sourceLabel: (id: string) => string
  onOpenChange: (open: boolean) => void
  onState: (job: Job, state: Job['state']) => void
}) {
  // The last job stays rendered while the dialog animates shut
  const [last, setLast] = useState(current)
  if (current && current !== last) setLast(current)
  const job = current ?? last
  const details = useQuery({
    queryKey: detailsKey(job?.id ?? ''),
    queryFn: () => unwrap(api.api.jobs[':id'].details.$get({ param: { id: job?.id ?? '' } })),
    enabled: current !== null,
    staleTime: 10 * 60_000,
  })
  if (!job) return null
  const href = safeHref(job.url)
  const pay = salaryRange(job.salaryMinUsd, job.salaryMaxUsd)
  const act = (state: Job['state']) => {
    onState(job, state)
    onOpenChange(false)
  }
  const data = details.data

  return (
    <Dialog open={current !== null} onOpenChange={onOpenChange}>
      <DialogContent
        // Back to the row it was opened from, so j / k carry on from there
        onCloseAutoFocus={(e) => {
          const row = document.querySelector<HTMLElement>(`[data-job-id="${CSS.escape(job.id)}"] a`)
          if (row) {
            e.preventDefault()
            row.focus({ preventScroll: true })
          }
        }}
        title={job.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-paper">{job.companyName}</span>
            {job.tier !== 'Unlisted' && <TierBadge tier={job.tier} />}
            <span>{job.locations.slice(0, 3).join(' · ')}</span>
          </span>
        }
        className="sm:max-w-2xl"
      >
        <dl className="mb-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-faint">
          <div>
            <dt className="sr-only">Posted</dt>
            <dd>posted {relative(job.effectiveAt)}</dd>
          </div>
          {pay && (
            <div>
              <dt className="sr-only">Pay</dt>
              <dd className="text-go">{pay}</dd>
            </div>
          )}
          <div>
            <dt className="sr-only">Sources</dt>
            <dd>{job.sources.map((s) => sourceLabel(s.source)).join(' · ')}</dd>
          </div>
        </dl>

        <section
          aria-labelledby="key-lines"
          className="rounded-lg border border-line bg-ink/40 p-3.5"
        >
          <h3
            id="key-lines"
            className="mb-2 font-mono text-[0.68rem] tracking-wider text-faint uppercase"
          >
            Before you apply
          </h3>
          {details.isPending ? (
            <div className="space-y-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-raised"
                  style={{ width: `${88 - i * 14}%` }}
                />
              ))}
            </div>
          ) : details.isError ? (
            <p className="text-sm text-stop">
              Couldn’t load the description: {details.error.message}
            </p>
          ) : data?.keyLines.length ? (
            <ul className="space-y-2">
              {data.keyLines.map((l) => (
                <li key={l.text} className="grid grid-cols-[5.5rem_1fr] gap-3 text-sm leading-snug">
                  <span className="pt-0.5 font-mono text-[0.68rem] tracking-wide text-signal uppercase">
                    {TOPIC_LABEL[l.topic]}
                  </span>
                  <span className="text-paper">{l.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-dim">
              {data?.description
                ? 'Nothing about years, degree, visa, location or pay stood out. Skim the full text below.'
                : 'No description yet: the new-grad lists have none, and the board’s is fetched on the next poll. Open the posting to read it.'}
            </p>
          )}
        </section>

        {data?.description && (
          <details className="group mt-3">
            <summary className="cursor-pointer rounded-md py-1.5 text-sm text-dim transition-colors select-none hover:text-paper">
              Full description
              {data.source && <span className="text-faint"> · {sourceLabel(data.source)}</span>}
            </summary>
            <div className="mt-2 max-h-[40dvh] overflow-y-auto overscroll-contain rounded-lg border border-line p-3.5 text-sm leading-relaxed whitespace-pre-line text-dim">
              {data.description}
            </div>
          </details>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {href && (
            <Button variant="primary" asChild>
              <a href={href} target="_blank" rel="noreferrer">
                <ExternalLink /> Open posting
              </a>
            </Button>
          )}
          {job.state === 'applied' ? (
            <Button variant="ghost" onClick={() => act('new')}>
              <Undo2 /> Not applied
            </Button>
          ) : (
            <>
              <Button onClick={() => act('applied')}>
                <Check /> Applied
              </Button>
              {job.state === 'saved' ? (
                <Button onClick={() => act('new')}>
                  <BookmarkCheck className="text-signal" /> Unsave
                </Button>
              ) : (
                <Button onClick={() => act('saved')}>
                  <Bookmark /> Save
                </Button>
              )}
              {job.state !== 'hidden' && (
                <Button variant="ghost" onClick={() => act('hidden')}>
                  <EyeOff /> Hide
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
