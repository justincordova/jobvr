import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

const fieldClass =
  'w-full rounded-md border border-line-strong bg-panel px-3 py-2 text-base text-paper sm:text-sm placeholder:text-faint transition-colors hover:border-faint focus-visible:border-signal focus-visible:outline-none disabled:opacity-50'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'h-9', className)} {...props} />
}
