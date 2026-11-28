import type { Job } from '@/lib/types'

export type Stage = NonNullable<Job['stage']>

/** In pipeline order; no stage yet reads as "Waiting" (applied, no answer). */
export const STAGES: {
  value: Stage | null
  label: string
  tone: 'neutral' | 'info' | 'go' | 'stop'
}[] = [
  { value: null, label: 'Waiting', tone: 'neutral' },
  { value: 'interviewing', label: 'Interviewing', tone: 'info' },
  { value: 'offer', label: 'Offer', tone: 'go' },
  { value: 'rejected', label: 'Rejected', tone: 'stop' },
]

export const stageInfo = (stage: Job['stage']) =>
  STAGES.find((s) => s.value === (stage ?? null)) ?? STAGES[0]!

export const QUIET_AFTER_DAYS = 21

/** Still "Waiting" three weeks on: most companies that will answer have by then. */
export const isQuiet = (job: Pick<Job, 'stage' | 'appliedAt'>, now = Date.now()) =>
  !job.stage &&
  !!job.appliedAt &&
  now - new Date(job.appliedAt).getTime() >= QUIET_AFTER_DAYS * 86_400_000
