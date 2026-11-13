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
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  tone?: 'neutral' | 'stop'
}) {
  const [text, setText] = useState('')
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
      onChange(value.slice(0, -1))
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
        {value.map((v) => (
          <span
            key={v}
            className={cn(
              'inline-flex animate-pop-in items-center gap-1 rounded px-2 py-0.5 font-mono text-xs',
              tone === 'stop' ? 'bg-stop/10 text-stop' : 'bg-raised text-paper ring-1 ring-line',
            )}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="-mr-0.5 rounded-sm p-0.5 text-faint transition-colors hover:text-paper"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => text && add(text)}
          placeholder={value.length ? '' : placeholder}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-0.5 text-sm placeholder:text-faint focus:outline-none"
        />
      </div>
    </div>
  )
}
