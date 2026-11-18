import { describe, expect, it } from 'vitest'
import { appliedStats } from './applied-stats'

// Wednesday 18 Nov 2026, local time
const NOW = new Date(2026, 10, 18, 15, 0)
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

describe('appliedStats', () => {
  it('counts this week, last week, and the current streak', () => {
    const s = appliedStats(
      [
        { appliedAt: at(18), tier: 'Mid' },
        { appliedAt: at(17), tier: 'Mid' },
        { appliedAt: at(16), tier: 'Startup' },
        { appliedAt: at(14), tier: 'Startup' },
        { appliedAt: at(10), tier: 'Unlisted' },
        { appliedAt: null, tier: 'Corporate' },
      ],
      NOW,
    )
    expect(s.total).toBe(6)
    expect(s.undated).toBe(1)
    // Monday 16 Nov to today
    expect(s.thisWeek).toBe(3)
    expect(s.lastWeek).toBe(2)
    expect(s.streak).toBe(3)
    expect(s.tiers).toEqual([
      { tier: 'Mid', count: 2 },
      { tier: 'Startup', count: 2 },
      { tier: 'Corporate', count: 1 },
      { tier: 'Unlisted', count: 1 },
    ])
  })

  it('keeps a streak alive until the day is over', () => {
    const s = appliedStats(
      [
        { appliedAt: at(17), tier: 'Mid' },
        { appliedAt: at(16), tier: 'Mid' },
      ],
      NOW,
    )
    expect(s.streak).toBe(2)
  })

  it('lays out whole weeks, Monday first, ending with this week', () => {
    const s = appliedStats(
      [
        { appliedAt: at(18), tier: 'Mid' },
        { appliedAt: at(18, 16), tier: 'Mid' },
        { appliedAt: at(17), tier: 'Mid' },
      ],
      NOW,
      4,
    )
    expect(s.weeks).toHaveLength(4)
    const thisWeek = s.weeks[3] ?? []
    expect(thisWeek.map((d) => d.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
    expect(thisWeek.map((d) => d.level)).toEqual([0, 2, 4, 0, 0, 0, 0])
    expect(thisWeek.map((d) => d.future)).toEqual([false, false, false, true, true, true, true])
  })
})
