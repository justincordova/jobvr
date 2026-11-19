import { CloudOff, RotateCw } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

export function PageHeader({
  title,
  meta,
  description,
  actions,
}: {
  title: string
  meta?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[1.65rem] leading-none font-semibold tracking-[-0.02em]">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-2 text-sm text-dim">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  body: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mt-6 flex animate-rise flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      {Icon && (
        <span className="mb-4 grid size-10 place-items-center rounded-full bg-raised ring-1 ring-line">
          <Icon className="size-[1.1rem] text-dim" />
        </span>
      )}
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-dim">{body}</p>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  retrying,
}: {
  error: Error
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div className="mt-6 flex animate-rise items-start gap-3 rounded-xl border border-stop/40 bg-stop/5 px-5 py-5 text-sm">
      <CloudOff className="mt-0.5 size-4 shrink-0 text-stop" />
      <div>
        <p className="font-medium text-stop">Couldn’t load this page</p>
        <p className="mt-1 text-dim">{error.message}</p>
        <Button size="sm" className="mt-4" onClick={onRetry} pending={retrying}>
          {!retrying && <RotateCw />} Retry
        </Button>
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-raised', className)} />
}
