import { X } from 'lucide-react'
import { type KeyboardEvent, useId, useState } from 'react'
import { cn } from '@/lib/cn'

/** Editable list of short strings (keywords, aliases, categories). */
export function ChipsInput({
  label,
  value,
  onChange,
  placeholder = 'Type and press Enter',
  tone = 'neutral',
  describedBy,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  tone?: 'neutral' | 'stop'
  /** Id of a hint or error for the field to point at. */
  describedBy?: string
}) {
  const [text, setText] = useState('')
  // Backspace on an empty field marks the last chip first; a second one removes it
  const [armed, setArmed] = useState(false)
  const id = useId()

  const add = (raw: string) => {
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const next = [...value]
    for (const item of items) {
      if (!next.some((v) => v.toLowerCase() === item.toLowerCase())) next.push(item)
    }
    if (next.length !== value.length) onChange(next)
    setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) {
      if (armed) onChange(value.slice(0, -1))
      setArmed(!armed)
    } else if (armed) {
      setArmed(false)
    }
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[0.7rem] tracking-wider text-dim uppercase"
      >
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-panel p-1.5 transition-colors hover:border-faint focus-within:border-signal">
        {value.map((v, i) => (
          <span
            key={v}
            className={cn(
              'inline-flex animate-pop-in items-center gap-1 rounded px-2 py-0.5 font-mono text-xs transition-shadow duration-150',
              tone === 'stop' ? 'bg-stop/10 text-stop' : 'bg-raised text-paper ring-1 ring-line',
              armed && i === value.length - 1 && 'ring-2 ring-stop/70',
            )}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="relative -mr-0.5 rounded-sm p-0.5 text-faint transition-colors after:absolute after:-inset-2 hover:text-paper pointer-coarse:after:-inset-3"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-describedby={describedBy}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setArmed(false)
            if (text) add(text)
          }}
          placeholder={value.length ? '' : placeholder}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-0.5 text-base placeholder:text-faint sm:text-sm focus:outline-none"
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {armed && value.length > 0 ? `Press Backspace again to remove ${value.at(-1)}` : ''}
      </p>
    </div>
  )
}
