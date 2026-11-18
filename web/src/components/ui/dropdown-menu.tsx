import { Check } from 'lucide-react'
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
          'z-50 min-w-44 origin-(--radix-dropdown-menu-content-transform-origin) rounded-lg border border-line-strong bg-raised p-1 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)] data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
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

/** A toggle row with a check; stays open on select so several can be picked. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  onSelect,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-3 pl-2 text-sm text-paper outline-none select-none data-[highlighted]:bg-line pointer-coarse:py-2.5',
        className,
      )}
      onSelect={(e) => {
        e.preventDefault()
        onSelect?.(e)
      }}
      {...props}
    >
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center rounded border border-line-strong transition-colors in-data-[state=checked]:border-signal in-data-[state=checked]:bg-signal"
      >
        <Menu.ItemIndicator>
          <Check className="size-3 text-signal-ink" strokeWidth={3} />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  )
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn(
        'px-2.5 pt-1.5 pb-1 font-mono text-[0.65rem] tracking-wider text-faint uppercase',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line" />
}
