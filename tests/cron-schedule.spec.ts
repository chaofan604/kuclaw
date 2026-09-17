import { describe, expect, it } from 'vitest'
import { nextCronOccurrence, validateCronSchedule } from '../src/main/runtime/cron-schedule.js'

const MINUTE = 60_000

describe('nextCronOccurrence', () => {
  it('computes the next daily run in Asia/Shanghai as a UTC epoch', () => {
    // 2026-01-10 20:00 CST（周六）→ 下一次 01:00 CST = 2026-01-10 17:00 UTC。
    const after = Date.UTC(2026, 0, 10, 12, 0, 0)
    expect(nextCronOccurrence('0 1 * * *', 'Asia/Shanghai', after)).toBe(Date.UTC(2026, 0, 10, 17, 0))
  })

  it('never returns the current matching minute', () => {
    const after = Date.UTC(2026, 0, 10, 17, 0)
    expect(nextCronOccurrence('0 1 * * *', 'Asia/Shanghai', after)).toBe(Date.UTC(2026, 0, 11, 17, 0))
  })

  it('honours the explicit UTC zone instead of the host zone', () => {
    const after = Date.UTC(2026, 0, 10, 12, 0, 0)
    expect(nextCronOccurrence('0 1 * * *', 'UTC', after)).toBe(Date.UTC(2026, 0, 11, 1, 0))
  })

  it('keeps fixed-zone schedules correct across a DST transition', () => {
    // 美国东部 2026-03-08 切换夏令时：最后一次切换前的 01:00 仍是 EST（UTC-5）。
    expect(nextCronOccurrence('0 1 * * *', 'America/New_York', Date.UTC(2026, 2, 7, 12, 0)))
      .toBe(Date.UTC(2026, 2, 8, 6, 0))
    // 夏令时期间 01:00 是 EDT（UTC-4）。
    expect(nextCronOccurrence('0 1 * * *', 'America/New_York', Date.UTC(2026, 5, 10, 12, 0)))
      .toBe(Date.UTC(2026, 5, 11, 5, 0))
  })

  it('supports stepped minutes', () => {
    const after = Date.UTC(2026, 0, 10, 12, 7, 0)
    expect(nextCronOccurrence('*/15 * * * *', 'Asia/Shanghai', after)).toBe(Date.UTC(2026, 0, 10, 12, 15))
  })

  it('matches day-of-month or day-of-week when both are restricted', () => {
    // 2026-01-10 是周六：周日不匹配，下一次是周一 2026-01-12 00:00 CST。
    const after = Date.UTC(2026, 0, 10, 12, 0, 0)
    expect(nextCronOccurrence('0 0 1 * 1', 'Asia/Shanghai', after)).toBe(Date.UTC(2026, 0, 11, 16, 0))
  })

  it('treats weekday 7 as Sunday', () => {
    const after = Date.UTC(2026, 0, 10, 12, 0, 0)
    expect(nextCronOccurrence('0 0 * * 7', 'Asia/Shanghai', after)).toBe(Date.UTC(2026, 0, 10, 16, 0))
  })
})

describe('validateCronSchedule', () => {
  it('accepts a valid expression and zone', () => {
    expect(() => validateCronSchedule('0 1 * * *', 'Asia/Shanghai')).not.toThrow()
  })

  it('rejects malformed expressions', () => {
    expect(() => nextCronOccurrence('0 1 * *', 'UTC', Date.now())).toThrow('5 个字段')
    expect(() => nextCronOccurrence('60 1 * * *', 'UTC', Date.now())).toThrow('分钟')
    expect(() => nextCronOccurrence('0 24 * * *', 'UTC', Date.now())).toThrow('小时')
    expect(() => nextCronOccurrence('0 0 0 * *', 'UTC', Date.now())).toThrow('日期')
    expect(() => nextCronOccurrence('0 0 1 13 *', 'UTC', Date.now())).toThrow('月份')
    expect(() => nextCronOccurrence('0 0 * * 8', 'UTC', Date.now())).toThrow('星期')
    expect(() => nextCronOccurrence('*/0 * * * *', 'UTC', Date.now())).toThrow('步长')
    expect(() => nextCronOccurrence('5-1 * * * *', 'UTC', Date.now())).toThrow('超出')
  })

  it('rejects an invalid IANA time zone', () => {
    expect(() => validateCronSchedule('0 1 * * *', 'Mars/Olympus')).toThrow('时区无效')
  })
})

describe('minute resolution', () => {
  it('aligns results to whole minutes', () => {
    const after = Date.UTC(2026, 0, 10, 12, 0, 30, 500)
    const next = nextCronOccurrence('0 1 * * *', 'UTC', after)
    expect(next % MINUTE).toBe(0)
    expect(next).toBe(Date.UTC(2026, 0, 11, 1, 0))
  })
})
