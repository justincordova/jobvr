import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'info' | 'error'

export interface ToastOptions {
  tone?: Tone
  action?: { label: string; onClick: () => void }
  duration?: number
  /** Runs when the toast closes without its action being used (deferred deletes). */
  onCommit?: () => void
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
  open: boolean
}

const MAX_VISIBLE = 3
const EXIT_MS = 200

// A tiny external store, so toasts can be raised from anywhere
let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const pending = new Map<number, () => void>()

const setItems = (fn: (list: ToastItem[]) => ToastItem[]) => {
  items = fn(items)
  for (const l of listeners) l()
}

function close(id: number, commit = true) {
  const run = pending.get(id)
  pending.delete(id)
  if (commit) run?.()
  setItems((l) => l.map((t) => (t.id === id ? { ...t, open: false } : t)))
  setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), EXIT_MS)
}

function show(message: string, options: ToastOptions = {}) {
  // A repeated message replaces its twin; overflow closes the oldest (deferred work still runs)
  const open = items.filter((t) => t.open)
  const twins = open.filter((t) => t.message === message)
  const rest = open.filter((t) => t.message !== message)
  for (const t of [...twins, ...rest.slice(0, Math.max(0, rest.length - MAX_VISIBLE + 1))]) {
    close(t.id)
  }
  const id = nextId++
  if (options.onCommit) pending.set(id, options.onCommit)
  setItems((l) => [...l, { ...options, id, message, open: true }])
}

// eslint-disable-next-line react-refresh/only-export-components
export const toast = Object.assign(show, {
  error: (message: string) => show(message, { tone: 'error' }),
  /** Shows "message · Undo". `commit` runs only if Undo isn't pressed in time. */
  undoable: (message: string, handlers: { undo: () => void; commit?: () => void }) =>
    show(message, { action: { label: 'Undo', onClick: handlers.undo }, onCommit: handlers.commit }),
  /** Presses Undo on the newest open undoable toast (keyboard "u"); false if there is none. */
  undoLatest: () => {
    const t = [...items].reverse().find((i) => i.open && i.action?.label === 'Undo')
    if (!t?.action) return false
    t.action.onClick()
    close(t.id, false)
    return true
  },
})

// Leaving the page shouldn't drop a deferred delete on the floor
window.addEventListener('pagehide', () => {
  for (const run of pending.values()) run()
  pending.clear()
})

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => toast

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items)
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] in-data-savebar:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] mx-auto flex w-full max-w-sm flex-col px-3 md:bottom-5 md:in-data-savebar:bottom-24"
    >
      {list.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </ol>
  )
}

const ICONS = {
  success: <CircleCheck className="size-4 shrink-0 text-go" />,
  info: <Info className="size-4 shrink-0 text-info" />,
  error: <CircleAlert className="size-4 shrink-0 text-stop" />,
}

function Toast({ toast: t }: { toast: ToastItem }) {
  const { id, message, tone = 'success', action, open } = t
  const duration = t.duration ?? (action || tone === 'error' ? 6000 : 3500)
  const [paused, setPaused] = useState(false)
  const remaining = useRef(duration)

  useEffect(() => {
    if (paused || !open) return
    const start = Date.now()
    const timer = setTimeout(() => close(id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - start
    }
  }, [paused, open, id])

  return (
    // The list is the live region; a role here too made screen readers read each toast twice
    <li
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] overflow-hidden opacity-0',
      )}
    >
      <div className="min-h-0 pt-2">
        <div
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          className={cn(
            'pointer-events-auto relative flex animate-rise items-center gap-2.5 overflow-hidden rounded-xl border bg-raised/95 py-1.5 pr-1.5 pl-3 text-sm shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)] backdrop-blur-md transition-transform duration-200',
            tone === 'error' ? 'border-stop/35' : 'border-line-strong',
            !open && 'translate-y-1 scale-[0.97]',
          )}
        >
          {ICONS[tone]}
          <p className="min-w-0 flex-1 py-1.5 leading-snug">{message}</p>
          {action && (
            <button
              type="button"
              onClick={() => {
                action.onClick()
                close(id, false)
              }}
              className="-my-1 self-stretch rounded-lg px-3 font-medium text-signal transition-colors hover:bg-signal-soft"
            >
              {action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => close(id)}
            aria-label="Dismiss notification"
            className="-my-1 grid w-9 place-items-center self-stretch rounded-lg text-faint transition-colors hover:bg-line hover:text-paper"
          >
            <X className="size-3.5" />
          </button>
          {action && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-px origin-left bg-signal/50"
              style={{
                animation: `toast-timer ${duration}ms linear forwards`,
                animationPlayState: paused || !open ? 'paused' : 'running',
              }}
            />
          )}
        </div>
      </div>
    </li>
  )
}
