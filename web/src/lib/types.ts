import type { api, DataOf } from './api'

type Data<F extends (...args: never[]) => Promise<unknown>> = DataOf<Awaited<ReturnType<F>>>

export type JobList = Data<typeof api.api.jobs.$get>
export type Job = JobList['jobs'][number]
export type Company = Data<typeof api.api.companies.$get>[number]
export type SettingsPayload = Data<typeof api.api.settings.$get>
export type Settings = SettingsPayload['settings']
export type LogList = Data<typeof api.api.logs.$get>
export type LogEntry = LogList['entries'][number]
export type Tier = Company['tier']
export type TierFilter = Job['tier']
export type NamedLocation = Settings['locations'][number]

export const TIERS: Tier[] = ['S', 'A', 'Mid', 'Startup', 'Corporate']
export const TIER_FILTERS: TierFilter[] = [...TIERS, 'Unlisted']
