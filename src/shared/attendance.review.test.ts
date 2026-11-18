// attendance.review.test.ts: QA checks for the Phase 9 attendance rules (pure code).
// Pins the behaviour CLAUDE.md asks for. A failing test here is an app bug, left failing
// on purpose; the comment on each names the review finding it proves.
import { describe, expect, it } from 'vitest'
import { attendanceDue, countedMinutes, extraMinutes, type AttendanceInput } from './attendance'
import { DEFAULT_SETTINGS } from './settings'
import type { Attendance } from './types'

const S = DEFAULT_SETTINGS // 8:00-17:00, Mon-Fri, attendance on, OT from the first minute
const FRI = '2026-11-06' // a Friday
const SAT = '2026-11-07'
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)

const rec = (changes: Partial<Attendance> = {}): Attendance => ({
  date: FRI,
  timeIn: `${FRI}T07:52:00`,
  lunchOut: null,
  lunchIn: null,
  timeOut: null,
  lastSeen: null,
  nonWorkDay: false,
  approved: null,
  ...changes
})

const input = (now: Date, extra: Partial<AttendanceInput> = {}): AttendanceInput => ({
  now,
  today: null,
  open: null,
  ...extra
})

describe('OT on a work day (finding 4)', () => {
  // CLAUDE.md: OT = time after workEnd on a work day. Timing in at 18:00 and out at 19:00
  // is 60 minutes of work, all of it after 17:00: 60 min of OT, not 120.
  it('counts only the time actually worked after the end time when time-in was after it', () => {
    const late = rec({ timeIn: `${FRI}T18:00:00`, timeOut: `${FRI}T19:00:00` })
    expect(extraMinutes(late, '17:00')).toBe(60)
    expect(countedMinutes(late, S)).toBe(60)
  })
  it('still counts from the end time when you timed in during the day', () => {
    const normal = rec({ timeIn: `${FRI}T16:30:00`, timeOut: `${FRI}T18:00:00` })
    expect(extraMinutes(normal, '17:00')).toBe(60)
  })
  it('uses `now` the same way while a late session is still open', () => {
    const late = rec({ timeIn: `${FRI}T18:00:00` })
    expect(extraMinutes(late, '17:00', `${FRI}T18:30:00`)).toBe(30)
  })
})

describe('sessions across midnight', () => {
  it('counts a weekend session that ends after midnight as extended hours in full', () => {
    const sat = rec({ date: SAT, timeIn: `${SAT}T20:00:00`, timeOut: '2026-11-08T01:00:00', nonWorkDay: true })
    expect(extraMinutes(sat, '17:00')).toBe(300)
    expect(countedMinutes(sat, { ...S, otAfterMin: 60 })).toBe(300)
  })
  it('asks about a forgotten time-out once the open session has not been seen for an hour', () => {
    const open = rec({ lastSeen: `${FRI}T23:50:00` })
    expect(attendanceDue(input(at(7, 0, 49), { open }), S)).toBe(null)
    expect(attendanceDue(input(at(7, 0, 50), { open }), S)).toBe('forgot-out')
  })
  it('uses the time-in as last seen when Pong never saw you after timing in', () => {
    const open = rec({ timeIn: `${FRI}T23:30:00` })
    expect(attendanceDue(input(at(7, 0, 29), { open }), S)).toBe(null)
    expect(attendanceDue(input(at(7, 0, 30), { open }), S)).toBe('forgot-out')
  })
})

describe('time-in question hours (finding 3)', () => {
  // The time-in bubble is for "the first moment Pong sees you each day". Being at the PC
  // just after midnight (still on yesterday's OT, or right after timing it out) is not the
  // start of a new work day, so Pong should not ask "Time in at 12:05 AM?".
  it('does not ask for a time-in in the middle of the night', () => {
    expect(attendanceDue(input(at(6, 0, 5)), S)).not.toBe('time-in')
    expect(attendanceDue(input(at(6, 3, 0)), S)).not.toBe('time-in')
  })
  it('still asks in the morning', () => {
    expect(attendanceDue(input(at(6, 7, 30)), S)).toBe('time-in')
  })
})

describe('lunch and OT reminders', () => {
  it('asks "Back from lunch?" exactly at 90 minutes', () => {
    const lunch = rec({ lunchOut: `${FRI}T12:00:00` })
    const T = { ...S, trackLunch: true }
    expect(attendanceDue(input(at(6, 13, 29), { today: lunch }), T)).toBe(null)
    expect(attendanceDue(input(at(6, 13, 30), { today: lunch }), T)).toBe('lunch-back')
  })
  it('does not ask "Still working?" after the OT question was answered either way', () => {
    expect(attendanceDue(input(at(6, 18), { today: rec({ approved: 'yes' }) }), S)).toBe(null)
    expect(attendanceDue(input(at(6, 18), { today: rec({ approved: 'no' }) }), S)).toBe(null)
  })
  it('follows a custom end time', () => {
    const T = { ...S, workEnd: '16:00' }
    expect(attendanceDue(input(at(6, 16, 14), { today: rec() }), T)).toBe(null)
    expect(attendanceDue(input(at(6, 16, 15), { today: rec() }), T)).toBe('ot-ask')
  })
})
