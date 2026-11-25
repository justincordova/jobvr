import { TIER_TEXT } from '@/lib/tier-style'
import type { LogEntry, TierFilter } from '@/lib/types'

/** Each part of the app keeps one color, so a glance down the list shows who's talking. */
const MODULE_TEXT: Record<string, string> = {
  poll: 'text-info',
  'poll-check': 'text-info',
  notify: 'text-plum',
  companies: 'text-go',
  backup: 'text-signal',
  cleanup: 'text-dim',
  scheduler: 'text-dim',
  server: 'text-dim',
  http: 'text-faint',
}
export const moduleText = (module: string) => MODULE_TEXT[module] ?? 'text-dim'

/**
 * Lines that mark a moment rather than report one: a poll's start and end, a
 * push, a wake. They get a colored edge and wash so each poll reads as a block.
 */
export function milestone(e: LogEntry): string | null {
  // A poll that finished with failed boards logs a warning: still its end, in amber
  if (e.msg.startsWith('poll finished')) {
    return e.level === 'info' ? 'border-l-go bg-go/[0.06]' : 'border-l-signal bg-signal/[0.06]'
  }
  if (e.level !== 'info') return null
  if (e.msg.startsWith('poll started')) return 'border-l-info bg-info/[0.06]'
  if (e.msg.startsWith('push sent')) return 'border-l-plum bg-plum/[0.06]'
  if (e.msg.startsWith('woke after')) return 'border-l-signal bg-signal/[0.06]'
  return null
}

/** The message's base color: by level, with quiet modules (requests) toned down. */
export function messageText(e: LogEntry) {
  if (e.level === 'error' || e.level === 'fatal') return 'text-stop'
  if (e.level === 'warn') return 'text-signal'
  if (e.module === 'http') return 'text-dim'
  if (e.msg.startsWith('poll started')) return 'text-info font-medium'
  if (e.msg.startsWith('poll finished')) return 'text-go font-medium'
  if (e.msg.startsWith('push sent')) return 'text-plum font-medium'
  return 'text-paper'
}

export interface Segment {
  text: string
  className?: string
}

/** Counts and outcomes worth catching by eye, each in the color of what it means. */
const RULES: { re: RegExp; className: (m: RegExpExecArray) => string | undefined }[] = [
  // Zero counts fade; anything new stands out
  {
    re: /(?:\+|\b)0 (?:new|closed|reopened|failed|updated|refreshed)\b/,
    className: () => 'text-faint',
  },
  { re: /\+\d+ new\b/, className: () => 'font-semibold text-go' },
  { re: /\b\d+ reopened\b/, className: () => 'text-info' },
  { re: /\b\d+ closed\b/, className: () => 'text-plum' },
  {
    re: /\b\d+ failed\b|\bfailed\b|\blooks down\b|\bHTTP [45]\d\d\b/,
    className: () => 'text-stop',
  },
  { re: /\b\d+ updated\b|\b\d+ refreshed\b/, className: () => 'text-dim' },
  // "rated Brim Financial B:" shows the letter in its tier color
  {
    re: /(?<=^rated .+? )[SABCD](?=:)/,
    className: (m) => `font-semibold ${TIER_TEXT[m[0] as TierFilter]}`,
  },
  { re: /\b\d+(?:\.\d+)? (?:ms|s|min|h)\b/, className: () => 'text-faint tabular-nums' },
  { re: /\b(?:POST|GET|PUT|PATCH|DELETE)\b/, className: () => 'text-faint' },
]

/** Splits a message into plain and highlighted runs (first match wins at each spot). */
export function highlight(msg: string): Segment[] {
  const out: Segment[] = []
  let rest = msg
  while (rest) {
    let best: { index: number; text: string; className?: string } | null = null
    for (const { re, className } of RULES) {
      const m = re.exec(rest)
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, text: m[0], className: className(m) }
      }
    }
    if (!best) {
      out.push({ text: rest })
      break
    }
    if (best.index > 0) out.push({ text: rest.slice(0, best.index) })
    out.push({ text: best.text, className: best.className })
    rest = rest.slice(best.index + best.text.length)
  }
  return out
}
