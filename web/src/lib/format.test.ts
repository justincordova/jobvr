import { describe, expect, it } from 'vitest'
import { relative, salaryRange, shortAge } from '@/lib/format'

const now = Date.parse('2026-11-12T15:00:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('format', () => {
  it('shortAge buckets', () => {
    expect(shortAge(ago(10_000), now)).toBe('now')
    expect(shortAge(ago(42 * 60_000), now)).toBe('42m')
    expect(shortAge(ago(5 * 3_600_000), now)).toBe('5h')
    expect(shortAge(ago(3 * 86_400_000), now)).toBe('3d')
  })

  it('relative handles null', () => {
    expect(relative(null, now)).toBe('never')
    expect(relative(ago(3 * 60_000), now)).toBe('3 min ago')
  })

  it('salaryRange', () => {
    expect(salaryRange(null, null)).toBeNull()
    expect(salaryRange(120000, 150000)).toBe('$120k–$150k')
    expect(salaryRange(95000, null)).toBe('$95k+')
    expect(salaryRange(null, 140000)).toBe('$140k')
  })
})
