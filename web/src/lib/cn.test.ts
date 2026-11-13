import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/cn'

describe('cn', () => {
  it('joins truthy class names with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })

  it('filters out falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })

  it('returns an empty string when nothing is truthy', () => {
    expect(cn(false, null, undefined)).toBe('')
  })
})

describe('cn with tailwind-merge', () => {
  it('lets later utilities win', () => {
    expect(cn('px-2 text-dim', 'px-4')).toBe('text-dim px-4')
  })
})
