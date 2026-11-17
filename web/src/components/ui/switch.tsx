import { Switch as SwitchPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer relative inline-flex h-5 w-9 shrink-0 after:absolute after:-inset-2.5 cursor-pointer items-center rounded-full border border-line-strong bg-raised transition-colors duration-200 data-[state=checked]:border-signal data-[state=checked]:bg-signal disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-dim shadow transition-[translate,background-color] duration-200 ease-(--ease-out) data-[state=checked]:translate-x-[1.1rem] data-[state=checked]:bg-signal-ink" />
    </SwitchPrimitive.Root>
  )
}
