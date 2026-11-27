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
