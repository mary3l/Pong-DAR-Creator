// attendance.test.ts: time-in, time-out, OT and extended hours, written as checks.
import { describe, expect, it } from 'vitest'
import {
  attendanceDue, countedMinutes, extendedSession, extraMinutes, formatMinutes, isWorkDay, nonWorkLabel,
  sessionState, stampAt, timeOutStamp, type AttendanceInput
} from './attendance'
import { DEFAULT_SETTINGS, settingsError } from './settings'
import type { Attendance } from './types'

const S = DEFAULT_SETTINGS // 8:00-17:00, Mon-Fri, attendance on, OT counted from the first minute
// Nov 6, 2026 is a Friday; Nov 7 a Saturday.
const FRI = '2026-11-06'
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

describe('isWorkDay and nonWorkLabel', () => {
  it('is a work day on a weekday with nothing marked', () => {
    expect(isWorkDay(FRI, S.workDays, null)).toBe(true)
  })
  it('is not on a weekend, a holiday or leave', () => {
    expect(isWorkDay(SAT, S.workDays, null)).toBe(false)
    expect(isWorkDay(FRI, S.workDays, 'holiday')).toBe(false)
    expect(isWorkDay(FRI, S.workDays, 'sick')).toBe(false)
  })
  it('names the day for the time-in bubble', () => {
    expect(nonWorkLabel(SAT, null)).toBe('Saturday')
    expect(nonWorkLabel(FRI, 'holiday')).toBe('a holiday')
    expect(nonWorkLabel(FRI, 'personal')).toBe('a leave day')
  })
})

describe('stampAt', () => {
  it('puts a time on the day', () => {
    expect(stampAt(FRI, '17:00')).toBe(`${FRI}T17:00:00`)
  })
  it('moves a time-out after midnight to the next morning', () => {
    expect(stampAt(FRI, '00:30', `${FRI}T18:00:00`)).toBe('2026-11-07T00:30:00')
    expect(stampAt(FRI, '19:30', `${FRI}T18:00:00`)).toBe(`${FRI}T19:30:00`)
  })
})

describe('timeOutStamp', () => {
  it('counts a time-out just before the end time as the end time', () => {
    expect(timeOutStamp(FRI, `${FRI}T16:58:00`, '17:00')).toBe(`${FRI}T17:00:00`)
    expect(timeOutStamp(FRI, `${FRI}T16:45:00`, '17:00')).toBe(`${FRI}T17:00:00`)
  })
  it('keeps the real time after the end time (OT) and well before it', () => {
    expect(timeOutStamp(FRI, `${FRI}T17:20:00`, '17:00')).toBe(`${FRI}T17:20:00`)
    expect(timeOutStamp(FRI, `${FRI}T14:00:00`, '17:00')).toBe(`${FRI}T14:00:00`)
    expect(timeOutStamp(FRI, `${FRI}T16:44:00`, '17:00')).toBe(`${FRI}T16:44:00`)
  })
  it('works the same on a Saturday', () => {
    expect(timeOutStamp(SAT, `${SAT}T16:58:00`, '17:00')).toBe(`${SAT}T17:00:00`)
    expect(timeOutStamp(SAT, `${SAT}T17:40:00`, '17:00')).toBe(`${SAT}T17:40:00`)
  })
})

describe('extraMinutes and countedMinutes', () => {
  it('is time after the end time on a work day', () => {
    expect(extraMinutes(rec({ timeOut: `${FRI}T18:25:00` }), '17:00')).toBe(85)
    expect(extraMinutes(rec({ timeOut: `${FRI}T17:00:00` }), '17:00')).toBe(0)
    expect(extraMinutes(rec({ timeOut: `${FRI}T15:00:00` }), '17:00')).toBe(0)
  })
  it('counts a time-out past midnight', () => {
    expect(extraMinutes(rec({ timeOut: '2026-11-07T00:30:00' }), '17:00')).toBe(450)
  })
  it('is the whole session on a non-work day, minus lunch', () => {
    const sat = rec({ date: SAT, timeIn: `${SAT}T08:00:00`, timeOut: `${SAT}T17:00:00`, nonWorkDay: true })
    expect(extraMinutes(sat, '17:00')).toBe(540)
    expect(extraMinutes({ ...sat, lunchOut: `${SAT}T12:00:00`, lunchIn: `${SAT}T13:00:00` }, '17:00')).toBe(480)
  })
  it('uses `now` while still timed in', () => {
    expect(extraMinutes(rec(), '17:00', `${FRI}T17:30:00`)).toBe(30)
    expect(extraMinutes(rec(), '17:00')).toBe(0)
  })
  it('drops OT under the minimum, never extended hours', () => {
    const fri = rec({ timeOut: `${FRI}T17:20:00` })
    expect(countedMinutes(fri, S)).toBe(20)
    expect(countedMinutes(fri, { ...S, otAfterMin: 30 })).toBe(0)
    expect(countedMinutes(rec({ timeOut: `${FRI}T17:30:00` }), { ...S, otAfterMin: 30 })).toBe(30)
    const sat = rec({ date: SAT, timeIn: `${SAT}T09:00:00`, timeOut: `${SAT}T09:20:00`, nonWorkDay: true })
    expect(countedMinutes(sat, { ...S, otAfterMin: 30 })).toBe(20)
  })
})

describe('formatMinutes', () => {
  it('reads like a person would say it', () => {
    expect(formatMinutes(85)).toBe('1 h 25 min')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(120)).toBe('2 h')
  })
})

describe('sessionState and extendedSession', () => {
  it('follows the record', () => {
    expect(sessionState(null, { attendance: false })).toBe('off')
    expect(sessionState(null, S)).toBe('none')
    expect(sessionState(rec({ timeIn: null }), S)).toBe('declined')
    expect(sessionState(rec(), S)).toBe('in')
    expect(sessionState(rec({ lunchOut: `${FRI}T12:00:00` }), S)).toBe('lunch')
    expect(sessionState(rec({ timeOut: `${FRI}T17:00:00` }), S)).toBe('out')
  })
  it('lets check-ins run late on a weekend, or after "Yes, OT"', () => {
    expect(extendedSession(rec())).toBe(false)
    expect(extendedSession(rec({ approved: 'pending' }))).toBe(true)
    expect(extendedSession(rec({ nonWorkDay: true }))).toBe(true)
    expect(extendedSession(rec({ nonWorkDay: true, timeOut: `${FRI}T17:00:00` }))).toBe(false)
  })
})

describe('attendanceDue', () => {
  const input = (now: Date, extra: Partial<AttendanceInput> = {}): AttendanceInput => ({
    now,
    today: null,
    open: null,
    ...extra
  })

  it('asks for the time-in when there is no record today', () => {
    expect(attendanceDue(input(at(6, 7, 52)), S)).toBe('time-in')
    expect(attendanceDue(input(at(7, 9, 0)), S)).toBe('time-in') // Saturday too
  })
  it('asks nothing when attendance is off, or you said "Not working today"', () => {
    expect(attendanceDue(input(at(6, 7, 52)), { ...S, attendance: false })).toBe(null)
    expect(attendanceDue(input(at(6, 9, 0), { today: rec({ timeIn: null }) }), S)).toBe(null)
  })
  it('asks about a forgotten time-out once you have been away an hour', () => {
    const open = rec({ lastSeen: `${FRI}T17:42:00` })
    expect(attendanceDue(input(at(9, 7, 50), { open }), S)).toBe('forgot-out')
  })
  it('lets a session run past midnight while you are still at it', () => {
    const open = rec({ lastSeen: '2026-11-07T00:20:00' })
    expect(attendanceDue(input(at(7, 0, 30), { open }), S)).toBe(null)
  })
  it('asks "Still working?" 15 min after the end time, once', () => {
    expect(attendanceDue(input(at(6, 17, 10), { today: rec() }), S)).toBe(null)
    expect(attendanceDue(input(at(6, 17, 15), { today: rec() }), S)).toBe('ot-ask')
    expect(attendanceDue(input(at(6, 18, 0), { today: rec({ approved: 'pending' }) }), S)).toBe(null)
    expect(attendanceDue(input(at(6, 18, 0), { today: rec() }), { ...S, otReminder: false })).toBe(null)
  })
  it('never asks about OT on a weekend: it is extended hours', () => {
    const sat = rec({ date: SAT, timeIn: `${SAT}T08:00:00`, nonWorkDay: true })
    expect(attendanceDue(input(at(7, 18, 0), { today: sat }), S)).toBe(null)
  })
  it('asks "Back from lunch?" after 90 min, only when lunch is tracked', () => {
    const lunch = rec({ lunchOut: `${FRI}T12:00:00` })
    expect(attendanceDue(input(at(6, 13, 0), { today: lunch }), { ...S, trackLunch: true })).toBe(null)
    expect(attendanceDue(input(at(6, 13, 30), { today: lunch }), { ...S, trackLunch: true })).toBe('lunch-back')
    expect(attendanceDue(input(at(6, 13, 30), { today: lunch }), S)).toBe(null)
  })
  it('asks nothing after the time-out', () => {
    expect(attendanceDue(input(at(6, 19, 0), { today: rec({ timeOut: `${FRI}T17:00:00` }) }), S)).toBe(null)
  })
})

describe('attendance settings', () => {
  it('accepts the new settings and rejects bad values', () => {
    expect(settingsError({ attendance: false, trackLunch: true, otReminder: false, otAfterMin: 30 })).toBe(null)
    expect(settingsError({ otAfterMin: 20 })).toBe('otAfterMin')
    expect(settingsError({ trackLunch: 'yes' })).toBe('trackLunch')
  })
})
