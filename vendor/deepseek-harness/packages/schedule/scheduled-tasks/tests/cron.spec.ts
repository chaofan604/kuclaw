import { describe, expect, it } from 'vitest'
import { nextCronAt, validateCron } from '../src/cron.ts'

describe('nextCronAt', () => {
  it('computes the next daily run for an explicit zone', () => {
    // 2026-01-10 12:00 UTC = 20:00 CST → next 01:00 CST = 2026-01-10 17:00 UTC.
    expect(nextCronAt('0 1 * * *', 'Asia/Shanghai', Date.UTC(2026, 0, 10, 12, 0))).toBe(Date.UTC(2026, 0, 10, 17, 0))
    expect(nextCronAt('0 1 * * *', 'UTC', Date.UTC(2026, 0, 10, 12, 0))).toBe(Date.UTC(2026, 0, 11, 1, 0))
  })

  it('returns the first matching minute strictly after the supplied epoch', () => {
    expect(nextCronAt('0 1 * * *', 'UTC', Date.UTC(2026, 0, 11, 1, 0))).toBe(Date.UTC(2026, 0, 12, 1, 0))
  })

  it('resolves fixed local times across a DST transition', () => {
    // Last 01:00 EST before the 2026-03-08 switch, then the first 01:00 EDT.
    expect(nextCronAt('0 1 * * *', 'America/New_York', Date.UTC(2026, 2, 7, 12, 0))).toBe(Date.UTC(2026, 2, 8, 6, 0))
    expect(nextCronAt('0 1 * * *', 'America/New_York', Date.UTC(2026, 2, 8, 12, 0))).toBe(Date.UTC(2026, 2, 9, 5, 0))
  })

  it('supports steps and restricted day selectors', () => {
    expect(nextCronAt('*/15 * * * *', 'UTC', Date.UTC(2026, 0, 10, 12, 7))).toBe(Date.UTC(2026, 0, 10, 12, 15))
    // 2026-01-10 is a Saturday; day-of-month or Monday match next lands on Monday 2026-01-12.
    expect(nextCronAt('0 0 1 * 1', 'UTC', Date.UTC(2026, 0, 10, 12, 0))).toBe(Date.UTC(2026, 0, 12, 0, 0))
    expect(nextCronAt('0 0 * * 7', 'UTC', Date.UTC(2026, 0, 10, 12, 0))).toBe(Date.UTC(2026, 0, 11, 0, 0))
  })

  it('rejects malformed rules and zones', () => {
    expect(() => nextCronAt('0 1 * *', 'UTC', Date.now())).toThrow('five fields')
    expect(() => nextCronAt('60 * * * *', 'UTC', Date.now())).toThrow('minute')
    expect(() => nextCronAt('0 0 * * 8', 'UTC', Date.now())).toThrow('day-of-week')
    expect(() => nextCronAt('*/0 * * * *', 'UTC', Date.now())).toThrow('outside its supported range')
    expect(() => validateCron('0 1 * * *', 'Mars/Olympus')).toThrow('IANA')
  })
})
