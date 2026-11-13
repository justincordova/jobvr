import { RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[1.65rem] leading-none font-semibold tracking-[-0.02em]">{title}</h1>
        {meta}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-dim">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-xl border border-stop/40 bg-stop/5 px-5 py-6 text-sm">
      <p className="font-medium text-stop">Couldn’t load this page</p>
      <p className="mt-1 text-dim">{error.message}</p>
      <Button size="sm" className="mt-4" onClick={onRetry}>
        <RotateCw /> Retry
      </Button>
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-panel/60">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-dim">{description}</p>}
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer && (
        <footer className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
          {footer}
        </footer>
      )}
    </section>
  )
}
