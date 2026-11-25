import { describe, expect, it } from 'vitest'
import { logsAsText } from './logs-text'

const at = (h: number, m: number, s: number) => new Date(2026, 10, 25, h, m, s).toISOString()

describe('logsAsText', () => {
  it('writes one line per entry with the error indented under it', () => {
    const text = logsAsText([
      {
        seq: 1,
        time: at(8, 12, 46),
        level: 'warn',
        module: 'poll',
        msg: 'Secureframe failed',
        error: null,
      },
      { seq: 2, time: at(8, 13, 1), level: 'error', module: null, msg: 'crashed', error: 'boom' },
    ])
    expect(text).toBe(
      [
        '2026-11-25 08:12:46 WARN  poll · Secureframe failed',
        '2026-11-25 08:13:01 ERROR crashed',
        '                          boom',
        '',
      ].join('\n'),
    )
  })
})
