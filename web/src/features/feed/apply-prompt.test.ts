import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_AWAY_MS, MIN_AWAY_MS, noteOpened, takeReturned } from './apply-prompt'

describe('apply prompt', () => {
  beforeEach(() => localStorage.clear())

  it('asks once about a posting opened a while ago', () => {
    noteOpened('gh:1', 1_000)
    expect(takeReturned(1_000 + MIN_AWAY_MS)).toBe('gh:1')
    expect(takeReturned(1_000 + MIN_AWAY_MS)).toBeNull()
  })

  it('skips a quick glance and a stale open', () => {
    noteOpened('gh:1', 1_000)
    expect(takeReturned(1_000 + MIN_AWAY_MS - 1)).toBeNull()
    noteOpened('gh:2', 1_000)
    expect(takeReturned(1_000 + MAX_AWAY_MS + 1)).toBeNull()
  })

  it('only the latest posting counts, and bad data is ignored', () => {
    noteOpened('gh:1', 1_000)
    noteOpened('gh:2', 2_000)
    expect(takeReturned(2_000 + MIN_AWAY_MS)).toBe('gh:2')
    localStorage.setItem('jobvr:opened-posting', '{oops')
    expect(takeReturned()).toBeNull()
  })
})
