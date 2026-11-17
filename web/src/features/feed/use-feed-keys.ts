import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from '@/components/toast'
import { safeHref } from '@/lib/format'
import type { Job } from '@/lib/types'
import type { View } from './search'

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['j', '↓'], label: 'Next role' },
  { keys: ['k', '↑'], label: 'Previous role' },
  { keys: ['o', 'Enter'], label: 'Open the posting' },
  { keys: ['a'], label: 'Mark applied' },
  { keys: ['s'], label: 'Save or unsave' },
  { keys: ['h'], label: 'Hide or unhide' },
  { keys: ['u'], label: 'Undo the last action' },
  { keys: ['1', '2', '3', '4'], label: 'Feed, Saved, Applied, Hidden' },
  { keys: ['Esc'], label: 'Clear the selection' },
  { keys: ['?'], label: 'Show these shortcuts' },
]

const VIEW_KEYS: Record<string, View> = { '1': 'feed', '2': 'saved', '3': 'applied', '4': 'hidden' }

const rowLink = (id: string) =>
  document.querySelector<HTMLAnchorElement>(`[data-job-id="${CSS.escape(id)}"] a`)

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest('input, textarea, select, [contenteditable], [role="dialog"]'))

/**
 * Gmail-style triage on the feed. The selected row follows keyboard focus (Tab
 * into a row selects it too), and after a row leaves the list the one that
 * slid into its place is selected, so a, s, h can be pressed down the list.
 */
export function useFeedKeys({
  list,
  onState,
  onView,
  onHelp,
}: {
  list: Job[]
  onState: (job: Job, state: Job['state']) => void
  onView: (view: View) => void
  onHelp: () => void
}) {
  // The id picked, and where it was: if it leaves the list, its successor is selected
  const [picked, setPicked] = useState<{ id: string; index: number } | null>(null)
  const found = picked ? list.findIndex((j) => j.id === picked.id) : -1
  const index = !picked
    ? -1
    : found >= 0
      ? found
      : list.length > 0
        ? Math.min(picked.index, list.length - 1)
        : -1
  const current = index >= 0 ? (list[index]?.id ?? null) : null

  // Keep keyboard focus on the selection when the focused row disappears
  useEffect(() => {
    if (current && document.activeElement === document.body) {
      rowLink(current)?.focus({ preventScroll: true })
    }
  }, [current])

  const latest = useRef({ list, index, onState, onView, onHelp })
  useLayoutEffect(() => {
    latest.current = { list, index, onState, onView, onHelp }
  })

  useEffect(() => {
    const select = (i: number) => {
      const { list } = latest.current
      const at = Math.max(0, Math.min(i, list.length - 1))
      const job = list[at]
      if (!job) return
      setPicked({ id: job.id, index: at })
      const link = rowLink(job.id)
      link?.focus({ preventScroll: true })
      link?.closest('li')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const { list, index, onState, onView, onHelp } = latest.current
      const job = index >= 0 ? list[index] : undefined
      const key = e.key
      let handled = true
      if (key === 'j' || key === 'ArrowDown') select(index + 1)
      else if (key === 'k' || key === 'ArrowUp') select(index < 0 ? 0 : index - 1)
      else if (key === '?') onHelp()
      else if (key in VIEW_KEYS) onView(VIEW_KEYS[key] as View)
      else if (key === 'u') handled = toast.undoLatest()
      else if (key === 'Escape' && job) {
        setPicked(null)
        ;(document.activeElement as HTMLElement | null)?.blur()
      } else if (job && (key === 'o' || key === 'Enter')) {
        // Enter on the focused title link already opens it
        if (key === 'o' || document.activeElement !== rowLink(job.id)) {
          const href = safeHref(job.url)
          if (href) window.open(href, '_blank', 'noopener,noreferrer')
        } else handled = false
      } else if (job && key === 'a') onState(job, job.state === 'applied' ? 'new' : 'applied')
      else if (job && key === 's') onState(job, job.state === 'saved' ? 'new' : 'saved')
      else if (job && key === 'h') onState(job, job.state === 'hidden' ? 'new' : 'hidden')
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Rows call this when focus enters them (Tab or click). */
  const focusRow = (id: string) => {
    const i = list.findIndex((j) => j.id === id)
    if (i >= 0 && id !== current) setPicked({ id, index: i })
  }
  return { selected: current, focusRow }
}
