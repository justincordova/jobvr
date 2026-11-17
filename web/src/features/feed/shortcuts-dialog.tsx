import { Dialog, DialogContent } from '@/components/ui/dialog'
import { SHORTCUTS } from './use-feed-keys'

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Keyboard shortcuts"
        description="Triage the feed without the mouse. After an action the next role is selected."
      >
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="contents">
              <dt className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-6 rounded-md border border-line-strong bg-raised px-1.5 py-0.5 text-center font-mono text-xs text-paper shadow-[inset_0_-1px_0_var(--color-line-strong)]"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-dim">{s.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
