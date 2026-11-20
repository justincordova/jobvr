import { describe, expect, it } from 'vitest'
import { appliedStats } from './applied-stats'

// Wednesday 18 Nov 2026, local time
const NOW = new Date(2026, 10, 18, 15, 0)
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

describe('appliedStats', () => {
  it('counts this week, last week, and the current streak', () => {
    const s = appliedStats(
      [
        { appliedAt: at(18), tier: 'B' },
        { appliedAt: at(17), tier: 'B' },
        { appliedAt: at(16), tier: 'C' },
        { appliedAt: at(14), tier: 'C' },
        { appliedAt: at(10), tier: 'Unlisted' },
        { appliedAt: null, tier: 'D' },
      ],
      NOW,
    )
    expect(s.total).toBe(6)
    expect(s.undated).toBe(1)
    // Monday 16 Nov to today
    expect(s.thisWeek).toBe(3)
    expect(s.lastWeek).toBe(2)
    expect(s.streak).toBe(3)
    expect(s.bestDay).toEqual({ date: '2026-11-18', count: 1 })
    expect(s.tiers).toEqual([
      { tier: 'B', count: 2 },
      { tier: 'C', count: 2 },
      { tier: 'D', count: 1 },
      { tier: 'Unlisted', count: 1 },
    ])
  })

  it('counts today, yesterday and this month, and averages per day', () => {
    const s = appliedStats(
      [
        { appliedAt: at(18), tier: 'B' },
        { appliedAt: at(18, 9), tier: 'B' },
        { appliedAt: at(17), tier: 'B' },
        { appliedAt: new Date(2026, 9, 30, 12).toISOString(), tier: 'B' },
      ],
      NOW,
    )
    expect(s.today).toBe(2)
    expect(s.yesterday).toBe(1)
    // 30 Oct is last month
    expect(s.thisMonth).toBe(3)
    // 30 Oct to 18 Nov is 20 days
    expect(s.perDay).toBeCloseTo(4 / 20)
  })

  it('averages over at most 30 days, and has no average without dates', () => {
    const old = appliedStats(
      [
        { appliedAt: new Date(2026, 5, 1, 12).toISOString(), tier: 'B' },
        { appliedAt: at(18), tier: 'B' },
      ],
      NOW,
    )
    expect(old.perDay).toBeCloseTo(1 / 30)
    expect(appliedStats([{ appliedAt: null, tier: 'B' }], NOW).perDay).toBeNull()
  })

  it('keeps a streak alive until the day is over', () => {
    const s = appliedStats(
      [
        { appliedAt: at(17), tier: 'B' },
        { appliedAt: at(16), tier: 'B' },
      ],
      NOW,
    )
    expect(s.streak).toBe(2)
  })

  it('lays out whole weeks, Monday first, ending with this week', () => {
    const s = appliedStats(
      [
        { appliedAt: at(18), tier: 'B' },
        { appliedAt: at(18, 16), tier: 'B' },
        { appliedAt: at(17), tier: 'B' },
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
