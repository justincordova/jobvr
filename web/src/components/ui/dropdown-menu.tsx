import { DropdownMenu as Menu } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align="end"
        className={cn(
          'z-50 min-w-40 rounded-lg border border-line-strong bg-raised p-1 shadow-xl data-[state=open]:animate-rise',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-paper outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-line [&_svg]:size-4 [&_svg]:text-dim',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line" />
}
