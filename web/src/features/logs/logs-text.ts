import type { LogEntry } from '@/lib/types'

const pad = (n: number) => String(n).padStart(2, '0')

/** Local time as "2026-11-25 08:13:01". */
const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Error lines line up under the message: the stamp, the level and two spaces. */
const INDENT = ' '.repeat(26)

/** Plain text, oldest first like a log file, for pasting into a chat or an issue. */
export function logsAsText(entries: LogEntry[]) {
  const lines = entries.map((e) => {
    const head = `${stamp(e.time)} ${e.level.toUpperCase().padEnd(5)} ${e.module ? `${e.module} · ` : ''}${e.msg}`
    return e.error ? `${head}\n${INDENT}${e.error}` : head
  })
  return `${lines.join('\n')}\n`
}
