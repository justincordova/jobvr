import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Settings } from '@/lib/types'
import { settingsProblems, useDraft } from './draft'

const SETTINGS = {
  locations: [
    { label: 'NJ', aliases: ['nj'], enabled: true },
    { label: 'Remote-US', aliases: [], enabled: true, builtin: 'remote_us' },
  ],
  tiersToTrack: ['S', 'A'],
  entryLevelOnly: false,
  roleKeywords: ['software'],
  levelKeywords: ['new grad'],
  excludeKeywords: [],
  applyLevelToSimplify: false,
  requireLevelOnBoards: false,
  simplifyCategories: [],
  experienceCutoffYears: 3,
  storeWindowDays: 30,
  maxJobAgeHours: 24,
  pollEveryMinutes: 10,
  pushEveryMinutes: 30,
  quietHours: { start: '23:00', end: '07:00' },
  minSalaryUsd: 0,
  disabledSources: [],
  showSimplifyJobs: true,
  suggestCompanies: true,
} as Settings

describe('settingsProblems', () => {
  it('accepts the defaults', () => {
    expect(settingsProblems(SETTINGS)).toEqual({})
  })

  it('checks each number against the server’s limits', () => {
    expect(
      settingsProblems({
        ...SETTINGS,
        pollEveryMinutes: 2,
        pushEveryMinutes: 2000,
        maxJobAgeHours: Number.NaN,
        storeWindowDays: 7.5,
        experienceCutoffYears: 21,
        minSalaryUsd: -1,
      }),
    ).toEqual({
      pollEveryMinutes: 'Use 5 to 1440',
      pushEveryMinutes: 'Use 5 to 1440',
      maxJobAgeHours: 'Enter a number',
      storeWindowDays: 'Use a whole number',
      experienceCutoffYears: 'Use 0 to 20',
      minSalaryUsd: 'Use 0 or more',
    })
    expect(settingsProblems({ ...SETTINGS, storeWindowDays: 120 })).toEqual({})
  })

  it('catches an empty quiet-hours time, a place with nothing to match, and no places on', () => {
    expect(settingsProblems({ ...SETTINGS, quietHours: { start: '', end: '07:00' } })).toEqual({
      quietHours: 'Set both a start and an end time',
    })
    expect(
      settingsProblems({
        ...SETTINGS,
        locations: [{ label: 'Boston', aliases: [], enabled: true }, SETTINGS.locations[1]!],
      }).locations,
    ).toBe('Boston needs at least one name to match')
    expect(
      settingsProblems({
        ...SETTINGS,
        locations: SETTINGS.locations.map((l) => ({ ...l, enabled: false })),
      }).locations,
    ).toBe('Turn on at least one place')
  })
})

describe('useDraft', () => {
  it('keeps edits made while a save was on its way', () => {
    const { result, rerender } = renderHook(({ settings }) => useDraft(settings), {
      initialProps: { settings: SETTINGS },
    })
    act(() => result.current.set('pollEveryMinutes', 20))
    const sent = result.current.draft
    // Typed while the request is out
    act(() => result.current.set('pushEveryMinutes', 45))
    const saved = { ...SETTINGS, pollEveryMinutes: 20 }
    act(() => result.current.commit(saved, sent))
    rerender({ settings: { ...saved } })

    expect(result.current.draft.pollEveryMinutes).toBe(20)
    expect(result.current.draft.pushEveryMinutes).toBe(45)
    expect(result.current.changed).toEqual(['pushEveryMinutes'])
  })

  it('takes what the server kept for the settings it saved', () => {
    const { result, rerender } = renderHook(({ settings }) => useDraft(settings), {
      initialProps: { settings: SETTINGS },
    })
    act(() => result.current.set('roleKeywords', ['software', ' swe ']))
    const sent = result.current.draft
    const saved = { ...SETTINGS, roleKeywords: ['software', 'swe'] }
    act(() => result.current.commit(saved, sent))
    rerender({ settings: saved })
    expect(result.current.draft.roleKeywords).toEqual(['software', 'swe'])
    expect(result.current.changed).toEqual([])
  })
})
