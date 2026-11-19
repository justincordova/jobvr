import type { TierFilter } from '@/lib/types'

/** One color per tier, used everywhere a tier shows: amber for the best, then blue, green, plum, grey. */
export const TIER_BADGE: Record<TierFilter, string> = {
  S: 'bg-signal-soft text-signal ring-signal/35',
  A: 'bg-info/10 text-info ring-info/30',
  Mid: 'bg-go/10 text-go ring-go/30',
  Startup: 'bg-plum/10 text-plum ring-plum/30',
  Corporate: 'bg-raised text-dim ring-line-strong',
  Unlisted: 'bg-raised text-faint ring-line',
}

export const TIER_DOT: Record<TierFilter, string> = {
  S: 'bg-signal',
  A: 'bg-info',
  Mid: 'bg-go',
  Startup: 'bg-plum',
  Corporate: 'bg-dim',
  Unlisted: 'bg-line-strong',
}

export const TIER_TEXT: Record<TierFilter, string> = {
  S: 'text-signal',
  A: 'text-info',
  Mid: 'text-go',
  Startup: 'text-plum',
  Corporate: 'text-dim',
  Unlisted: 'text-faint',
}
