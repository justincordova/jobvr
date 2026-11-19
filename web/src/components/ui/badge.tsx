import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { TIER_BADGE } from '@/lib/tier-style'
import type { TierFilter } from '@/lib/types'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[0.68rem] leading-none font-medium tracking-wide uppercase',
  {
    variants: {
      tone: {
        neutral: 'bg-raised text-dim ring-1 ring-line',
        signal: 'bg-signal-soft text-signal ring-1 ring-signal/30',
        go: 'bg-go/10 text-go ring-1 ring-go/30',
        stop: 'bg-stop/10 text-stop ring-1 ring-stop/30',
        info: 'bg-info/10 text-info ring-1 ring-info/30',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

/** A company's tier, in its own color. */
export function TierBadge({
  tier,
  className,
  ...props
}: ComponentProps<'span'> & { tier: TierFilter }) {
  return (
    <span
      className={cn(badgeVariants(), 'normal-case ring-1', TIER_BADGE[tier], className)}
      {...props}
    >
      {tier}
    </span>
  )
}
