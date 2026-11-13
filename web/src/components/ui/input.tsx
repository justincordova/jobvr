import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const fieldClass =
  'w-full rounded-md border border-line-strong bg-panel px-3 py-2 text-sm text-paper placeholder:text-faint transition-colors hover:border-faint focus-visible:border-signal focus-visible:outline-none disabled:opacity-50'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'h-9', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'min-h-20 resize-y', className)} {...props} />
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(fieldClass, 'h-9 cursor-pointer pr-8 select-chevron', className)}
      {...props}
    />
  )
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'mb-1.5 block font-mono text-[0.7rem] tracking-wider text-dim uppercase',
        className,
      )}
      {...props}
    />
  )
}
