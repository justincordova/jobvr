/** The URL when it's http(s), else undefined: a stored "javascript:" link never becomes clickable. */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact age for the feed's gutter: "now", "42m", "5h", "3d". */
export function shortAge(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

/** "3 min ago", "2 h ago", "never". */
export function relative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const ms = now - new Date(iso).getTime()
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`
  return `${Math.floor(ms / DAY)} d ago`
}

const usd = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)

/** "$120k–$150k", "$95k+", or null when unlisted. */
export function salaryRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min !== null && max !== null && min !== max) return `${usd(min)}–${usd(max)}`
  if (max !== null) return usd(max)
  return `${usd(min as number)}+`
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Value for <input type="date"> in local time. */
export function toDateInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local date input → ISO at local noon (avoids timezone day shifts). */
export function fromDateInput(value: string): string {
  return new Date(`${value}T12:00:00`).toISOString()
}
