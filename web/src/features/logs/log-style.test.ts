import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/lib/types'
import { highlight, milestone } from './log-style'

const entry = (msg: string, level: LogEntry['level'] = 'info'): LogEntry => ({
  seq: 1,
  time: '2026-11-25T13:08:00.000Z',
  level,
  module: 'poll',
  msg,
  error: null,
})

const marked = (msg: string) => highlight(msg).filter((s) => s.className)

describe('highlight', () => {
  it('keeps the whole message, in order', () => {
    const msg = 'poll finished in 34.3 s · 180 unchanged, 1 failed · +4 new, 6 closed, 3 reopened'
    expect(
      highlight(msg)
        .map((s) => s.text)
        .join(''),
    ).toBe(msg)
  })

  it('marks counts by meaning', () => {
    const msg = 'poll finished in 34.3 s · 1 failed · +4 new, 6 closed, 3 reopened'
    expect(marked(msg).map((s) => s.text)).toEqual([
      '34.3 s',
      '1 failed',
      '+4 new',
      '6 closed',
      '3 reopened',
    ])
    expect(marked(msg).find((s) => s.text === '+4 new')?.className).toContain('text-go')
    expect(marked('+0 new')[0]?.className).toBe('text-faint')
    expect(marked('97 refreshed, 0 closed')[1]).toEqual({
      text: '0 closed',
      className: 'text-faint',
    })
  })

  it('colors a rating by its tier', () => {
    const [letter] = marked('rated Brim Financial B: Fintech credit-card startup')
    expect(letter).toEqual({ text: 'B', className: 'font-semibold text-go' })
  })
})

describe('milestone', () => {
  it('marks poll starts and ends, amber when boards failed', () => {
    expect(milestone(entry('poll started · 184 targets'))).toContain('border-l-info')
    expect(milestone(entry('poll finished in 14.1 s'))).toContain('border-l-go')
    expect(milestone(entry('poll finished in 34.3 s', 'warn'))).toContain('border-l-signal')
    expect(milestone(entry('Jobright · 563 listings'))).toBeNull()
  })
})
