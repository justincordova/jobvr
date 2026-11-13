import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useIndicator } from '@/lib/use-indicator'

/** Single-choice pill group with a thumb that glides to the selected option. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: { id: T; label: ReactNode }[]
  onChange: (v: T) => void
  className?: string
}) {
  const { ref, style } = useIndicator<HTMLDivElement>('[aria-checked="true"]', value)

  // Arrow keys move the selection, like native radio groups
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = options.findIndex((o) => o.id === value)
    const next = options[(i + step + options.length) % options.length]
    if (!next) return
    onChange(next.id)
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[options.indexOf(next)]?.focus()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('relative inline-flex rounded-lg border border-line bg-panel p-0.5', className)}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0 rounded-md bg-raised shadow-sm ring-1 ring-line-strong"
        style={style}
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          className={cn(
            'relative rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors duration-200',
            value === o.id ? 'text-paper' : 'text-dim hover:text-paper',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
