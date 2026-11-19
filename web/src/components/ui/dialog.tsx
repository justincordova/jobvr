import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Dialog = DialogPrimitive.Root

/** Bottom sheet on phones, centered card from `sm` up. */
export function DialogContent({
  className,
  title,
  description,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-b-0 border-line-strong bg-panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl focus:outline-none data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border-b sm:pb-5 sm:data-[state=closed]:animate-pop-out sm:data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden
          className="mx-auto -mt-2 mb-3 h-1 w-9 rounded-full bg-line-strong sm:hidden"
        />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-dim">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="relative -m-1 rounded-md p-1.5 text-dim after:absolute after:-inset-1.5 transition-colors hover:bg-raised hover:text-paper pointer-coarse:-m-2 pointer-coarse:p-2.5"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
