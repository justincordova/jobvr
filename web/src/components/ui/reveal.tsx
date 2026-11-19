import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Opens and closes its content with a smooth height and fade (a 0fr → 1fr grid
 * row), so what's below slides instead of jumping. Closed content stays
 * mounted but can't be focused or read out.
 */
export function Reveal({
  open,
  id,
  className,
  children,
}: {
  open: boolean
  id?: string
  /** Applied only while open (e.g. the spacing around it). */
  className?: string
  children: ReactNode
}) {
  return (
    <div
      id={id}
      inert={!open}
      aria-hidden={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity,margin] duration-300 ease-(--ease-out) motion-reduce:transition-none',
        open ? cn('grid-rows-[1fr] opacity-100', className) : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
