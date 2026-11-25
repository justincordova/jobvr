import { describe, expect, it } from 'vitest'
import { pollStatus } from '@/lib/poll-status'

const now = Date.parse('2026-11-25T13:08:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('pollStatus', () => {
  it('is polling between a start and its finish', () => {
    const p = { lastPollAt: ago(20_000), lastPollOkAt: ago(600_000) }
    expect(pollStatus(p, now)).toEqual({ polling: true, finishedAt: p.lastPollOkAt })
  })

  it('reports the finish once done', () => {
    const p = { lastPollAt: ago(60_000), lastPollOkAt: ago(20_000) }
    expect(pollStatus(p, now)).toEqual({ polling: false, finishedAt: p.lastPollOkAt })
  })

  it('stops calling a poll that never finished "polling"', () => {
    const p = { lastPollAt: ago(30 * 60_000), lastPollOkAt: ago(60 * 60_000) }
    expect(pollStatus(p, now).polling).toBe(false)
  })

  it('handles a new install', () => {
    expect(pollStatus({ lastPollAt: null, lastPollOkAt: null }, now)).toEqual({
      polling: false,
      finishedAt: null,
    })
    expect(pollStatus({ lastPollAt: ago(5_000), lastPollOkAt: null }, now)).toEqual({
      polling: true,
      finishedAt: null,
    })
  })
})
