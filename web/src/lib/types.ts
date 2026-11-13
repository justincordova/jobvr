import type { api, DataOf } from './api'

type Data<F extends (...args: never[]) => Promise<unknown>> = DataOf<Awaited<ReturnType<F>>>

export type JobList = Data<typeof api.api.jobs.$get>
export type Job = JobList['jobs'][number]
export type Application = Data<typeof api.api.applications.$get>[number]
export type Company = Data<typeof api.api.companies.$get>[number]
export type Suggestion = Data<typeof api.api.suggestions.$get>[number]
export type SettingsPayload = Data<typeof api.api.settings.$get>
export type Settings = SettingsPayload['settings']
export type Tier = Company['tier']
export type TierFilter = Job['tier']
export type ApplicationStatus = Application['status']
export type NamedLocation = Settings['locations'][number]

export const TIERS: Tier[] = ['S', 'A', 'Mid', 'Startup', 'Corporate']
export const TIER_FILTERS: TierFilter[] = [...TIERS, 'Unlisted']
export const APPLICATION_STATUSES: { id: ApplicationStatus; label: string }[] = [
  { id: 'applied', label: 'Applied' },
  { id: 'oa', label: 'Online assessment' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
]
