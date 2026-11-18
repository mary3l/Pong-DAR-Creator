// schedule.review.test.ts: QA checks for tick() in extended sessions (Phase 9).
// A failing test here is an app bug, left failing on purpose.
import { describe, expect, it } from 'vitest'
import { tick, type TickInput } from './schedule'
import { DEFAULT_SETTINGS } from './settings'

const S = DEFAULT_SETTINGS // 8:00-17:00, lunch 12:00-13:00, Mon-Fri
const MIN = 60_000
// Nov 7, 2026 is a Saturday; Nov 9 a Monday.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
const input = (now: Date, dueAt: number | null, extra: Partial<TickInput> = {}): TickInput => ({
  now,
  dueAt,
  paused: false,
  quiet: false,
  random: 0.5,
  ...extra
})

describe('tick in an extended session', () => {
  // CLAUDE.md "Stay quiet": lunch 12:00-13:00. An extended session (Saturday work, or OT)
  // lifts the work-hours and work-day limits, not the lunch break. (finding 6)
  it('stays quiet over the 12:00-13:00 lunch window on a Saturday session', () => {
    const due = at(7, 12, 30).getTime()
    expect(tick(input(at(7, 12, 30), due, { extended: true }), S).ask).toBe(false)
    expect(tick(input(at(7, 12, 0), at(7, 11, 55).getTime(), { extended: true }), S).ask).toBe(false)
  })
  it('asks again right after lunch', () => {
    const due = at(7, 12, 30).getTime()
    expect(tick(input(at(7, 13, 0), due, { extended: true }), S).ask).toBe(true)
  })
  it('keeps asking past midnight while the session is open', () => {
    const due = at(10, 0, 10).getTime()
    expect(tick(input(at(10, 0, 10), due, { extended: true }), S)).toEqual({ dueAt: due + 60 * MIN, ask: true })
  })
  it('still honours pause and quiet in an extended session', () => {
    const due = at(9, 18).getTime()
    expect(tick(input(at(9, 18), due, { extended: true, paused: true }), S)).toEqual({ dueAt: due, ask: false })
    expect(tick(input(at(9, 18), due, { extended: true, quiet: true }), S)).toEqual({ dueAt: due, ask: false })
  })
})
