// attendance.ts: time-in, time-out, OT and extended hours as pure functions.
// No clock, no database, no Electron: main/attendance.ts and the Today view call these
// with the record and the time, and the tests do the same with fixed values.
//
// The words, as DCWD uses them:
//   OT              time after your end time on a work day ("Was the OT approved?")
//   extended hours  a session on a weekend, holiday or leave day; it needs an
//                   Authority to Work on Extended Hours (ATWEH)
// Times are local timestamps 'YYYY-MM-DDTHH:MM:SS' (see dates.ts localTimestamp).
import { addDays, dayOfWeek } from './dates'
import type { Settings } from './settings'
import type { Attendance, DayType, SessionState } from './types'

type AttendanceSettings = Pick<Settings, 'attendance' | 'trackLunch' | 'otReminder' | 'otAfterMin' | 'workEnd' | 'workDays'>

const MINUTE = 60_000
export const SNAP_MIN = 15 // a time-out up to 15 min before your end time counts as the end time
export const OT_ASK_AFTER_MIN = 15 // "Still working? Overtime?" 15 min after your end time
export const LUNCH_REMIND_MIN = 90 // "Back from lunch?" after 90 min out
export const AWAY_GAP_MIN = 60 // not seen for an hour with the session open: you went home

// A timestamp without a Z is read as local time, so this matches new Date(y, m, d, h, mi).
export const stampMs = (stamp: string): number => new Date(stamp).getTime()

// '2026-11-06T17:05:00' -> '17:05'
export const hhmm = (stamp: string): string => stamp.slice(11, 16)

// '17:05' on a day -> '2026-11-06T17:05:00'. When it would come before `notBefore`
// (a time-out of 00:30 after a time-in of 18:00), it's the next morning instead.
export function stampAt(date: string, time: string, notBefore?: string | null): string {
  const stamp = `${date}T${time}:00`
  return notBefore && stamp < notBefore ? `${addDays(date, 1)}T${time}:00` : stamp
}

// A work day: one of your work days, with no rest day, leave or holiday marked on it.
export function isWorkDay(date: string, workDays: number[], dayType: DayType | null): boolean {
  return dayType === null && workDays.includes(dayOfWeek(date))
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// What the time-in bubble calls a non-work day: "It's Saturday." / "It's a holiday."
export function nonWorkLabel(date: string, dayType: DayType | null): string {
  if (dayType === 'holiday') return 'a holiday'
  if (dayType === 'rest') return 'a rest day'
  if (dayType === 'sick' || dayType === 'personal') return 'a leave day'
  return DAY_NAMES[dayOfWeek(date)]
}

// The time-out to record when you click Time out at `now`. Turning the PC off at 4:58
// counts as 5:00; after 5:00 the real time stays (OT, or extended hours past 5 on a
// Saturday). Leaving much earlier (2:00 PM) keeps the real time too.
export function timeOutStamp(date: string, now: string, workEnd: string): string {
  const end = `${date}T${workEnd}:00`
  const early = (stampMs(end) - stampMs(now)) / MINUTE
  return early > 0 && early <= SNAP_MIN ? end : now
}

// The exact extra minutes, before any minimum. `now` stands in for a missing time-out
// (the Today view shows OT so far).
//   work day:      time-out minus end time
//   non-work day:  the whole session, minus lunch if you logged it
export function extraMinutes(rec: Attendance, workEnd: string, now?: string): number {
  const out = rec.timeOut ?? now
  if (!rec.timeIn || !out) return 0
  let ms: number
  if (rec.nonWorkDay) {
    ms = stampMs(out) - stampMs(rec.timeIn)
    if (rec.lunchOut && rec.lunchIn) ms -= stampMs(rec.lunchIn) - stampMs(rec.lunchOut)
  } else {
    ms = stampMs(out) - stampMs(stampAt(rec.date, workEnd))
  }
  return Math.max(0, Math.floor(ms / MINUTE))
}

// The minutes that count. OT below "Count OT only after" doesn't; extended hours always do.
export function countedMinutes(rec: Attendance, s: Pick<Settings, 'workEnd' | 'otAfterMin'>, now?: string): number {
  const extra = extraMinutes(rec, s.workEnd, now)
  if (rec.nonWorkDay) return extra
  return extra > 0 && extra >= s.otAfterMin ? extra : 0
}

// "OT" or "extended hours", for labels.
export const extraKind = (rec: Pick<Attendance, 'nonWorkDay'>): string => (rec.nonWorkDay ? 'extended hours' : 'OT')

// 85 -> "1 h 25 min", 45 -> "45 min", 120 -> "2 h"
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// Timed in and not out yet.
export const isOpen = (rec: Attendance | null): rec is Attendance => !!rec?.timeIn && !rec.timeOut

// Out for lunch right now.
export const onLunch = (rec: Attendance | null): boolean => isOpen(rec) && !!rec.lunchOut && !rec.lunchIn

// Check-ins may go on past your work hours: a weekend or holiday session, or OT you said yes to.
export const extendedSession = (rec: Attendance | null): boolean =>
  isOpen(rec) && (rec.nonWorkDay || rec.approved !== null)

export function sessionState(rec: Attendance | null, s: Pick<Settings, 'attendance'>): SessionState {
  if (!s.attendance) return 'off'
  if (!rec) return 'none'
  if (!rec.timeIn) return 'declined'
  if (rec.timeOut) return 'out'
  return rec.lunchOut && !rec.lunchIn ? 'lunch' : 'in'
}

export interface AttendanceInput {
  now: Date
  today: Attendance | null // today's record, if any
  open: Attendance | null // an earlier day's session that was never timed out
}

export type AttendanceDue = 'time-in' | 'forgot-out' | 'ot-ask' | 'lunch-back' | null

// What Pong should ask about attendance right now, if anything. main/scheduler.ts calls
// this every 30 seconds while you're at the PC, before the regular check-in.
//   An earlier day still open, and you've been away an hour since: you forgot to time out.
//     (Still at it past midnight: nothing to ask, the session simply goes on.)
//   No record today: time in.
//   Out for lunch 90 min: back yet?
//   A work day, 15 min past your end time, OT not answered: still working?
export function attendanceDue(input: AttendanceInput, s: AttendanceSettings): AttendanceDue {
  if (!s.attendance) return null
  const now = input.now.getTime()
  const { today, open } = input
  if (open?.timeIn) {
    const seen = open.lastSeen ?? open.timeIn
    return now - stampMs(seen) >= AWAY_GAP_MIN * MINUTE ? 'forgot-out' : null
  }
  if (!today) return 'time-in'
  if (!isOpen(today)) return null
  if (today.lunchOut && !today.lunchIn) {
    return s.trackLunch && now - stampMs(today.lunchOut) >= LUNCH_REMIND_MIN * MINUTE ? 'lunch-back' : null
  }
  if (!today.nonWorkDay && s.otReminder && today.approved === null) {
    const askAt = stampMs(stampAt(today.date, s.workEnd)) + OT_ASK_AFTER_MIN * MINUTE
    if (now >= askAt) return 'ot-ask'
  }
  return null
}
