import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,scale,opacity] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-signal text-signal-ink hover:bg-signal/90',
        secondary:
          'border border-line-strong bg-raised text-paper hover:border-faint hover:bg-line',
        ghost: 'text-dim hover:bg-raised hover:text-paper',
        danger: 'border border-stop/40 text-stop hover:bg-stop/10',
        link: 'text-signal underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9 px-3.5',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner in place of the leading icon and blocks clicks. */
    pending?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild,
  pending,
  disabled,
  children,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      className={cn(buttonVariants({ variant, size }), pending && 'opacity-80', className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <LoaderCircle className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}
