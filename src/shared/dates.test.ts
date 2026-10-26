// dates.test.ts: Vitest checks for dates.ts. Run with `npm test`.
// describe() groups related tests; it() is one test; expect(x).toBe(y) fails the
// test if x isn't y. A test file sits next to the file it tests, ending in .test.ts.
import { describe, expect, it } from 'vitest'
import { addDays, dayOfWeek, isIsoDate, isWeekend, localDate, localTimestamp } from './dates'

describe('localDate', () => {
  it('uses the local calendar day, not UTC', () => {
    // new Date(year, monthIndex, day, hour, minute) builds a LOCAL time.
    // Month 9 = October, because months count from 0.
    // 7:30 AM local. In Manila (UTC+8) toISOString() would say the 25th.
    const morning = new Date(2026, 9, 26, 7, 30)
    expect(localDate(morning)).toBe('2026-10-26')
    expect(localTimestamp(morning)).toBe('2026-10-26T07:30:00')
  })
})

describe('addDays', () => {
  // Month and year ends are where date code breaks, so test exactly those.
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29') // 2028 is a leap year
  })
})

describe('weekdays', () => {
  it('knows Oct 3, 2026 is a Saturday', () => {
    expect(dayOfWeek('2026-10-03')).toBe(6)
    expect(isWeekend('2026-10-03')).toBe(true)
    expect(isWeekend('2026-10-05')).toBe(false) // Monday
  })
})

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2026-10-26')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false) // right shape, but not a real day
    expect(isIsoDate('2026-10-26T07:30')).toBe(false) // a timestamp, not a date
    expect(isIsoDate(20261026)).toBe(false) // a number, not a string
  })
})