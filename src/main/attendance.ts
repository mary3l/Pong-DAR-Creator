// attendance.ts: time-in, lunch and time-out. Runs in the MAIN process: it owns the
// database and the clock. The rules (what's OT, when to ask) are pure functions in
// shared/attendance.ts; this file feeds them the real time and saves what you answer.
//   scheduler.ts  calls checkAttendance() every 30 s: "is something due?"
//   pong.ts       turns the answer into a bubble, and clicks into the functions below
//   ipc.ts        lets the Today view and the extra-time card read and fix times
import type { DatabaseSync } from 'node:sqlite'
import { events } from './events'
import * as q from './queries'
import { getSettings } from './settings'
import {
  attendanceDue, countedMinutes, dayStarted, extendedSession, hhmm, isOpen, isWorkDay, nonWorkLabel, onLunch, sessionState,
  stampAt, timeOutStamp, type AttendanceDue
} from '../shared/attendance'
import { localDate, localTimestamp } from '../shared/dates'
import type { Attendance, AttendanceChanges, Bubble, DayType, SessionState } from '../shared/types'

let db: DatabaseSync
// The first moment Pong saw you at the PC today: the time the time-in bubble suggests.
let firstSeen: { date: string; at: string } | null = null
// "Later" on an attendance bubble: no attendance questions until then (ms).
let quietUntil = 0

export function initAttendance(database: DatabaseSync): void {
  db = database
}

// Every write goes through here, so the tray, Pong and the Today view all hear about it.
export function saveAttendance(date: string, changes: AttendanceChanges & { lastSeen?: string }): Attendance {
  const saved = q.setAttendance(db, date, changes)
  events.emit('attendance-saved', date)
  return saved
}

function dayType(date: string): DayType | null {
  return q.dayStatusInPeriod(db, { start: date, end: date })[0]?.type ?? null
}

export const todayRecord = (): Attendance | null => q.attendanceFor(db, localDate())

// The session the tray and hover buttons act on: today's, or one still going past
// midnight (a time-out after midnight belongs to the time-in day).
function sessionRecord(): Attendance | null {
  const today = todayRecord()
  if (isOpen(today)) return today
  return q.openSessionBefore(db, localDate()) ?? today
}

export function currentSession(): SessionState {
  return sessionState(sessionRecord(), getSettings())
}

export function snoozeAttendance(minutes: number): void {
  quietUntil = Date.now() + minutes * 60_000
}

export interface AttendanceCheck {
  due: AttendanceDue // a question to ask, if any
  extended: boolean // check-ins may go on past work hours (OT said yes, or a weekend)
  quiet: boolean // out for lunch, or "Not working today": no check-ins
}

// One look, every scheduler tick. `present` = you're at the PC (not away, not idle):
// only then does Pong note when it first saw you and keep "last seen" fresh.
export function checkAttendance(now: Date, present: boolean): AttendanceCheck {
  const s = getSettings()
  if (!s.attendance) return { due: null, extended: false, quiet: false }
  const date = localDate(now)
  const stamp = localTimestamp(now)
  const today = q.attendanceFor(db, date)
  const open = q.openSessionBefore(db, date)

  const due = attendanceDue({ now, today, open }, s)
  if (present) {
    // A work day starts the first time Pong sees you from 5 AM on, with no session from
    // last night still going: being up at 00:05 on OT is not a new day's time-in. A
    // forgotten session (not seen for an hour) doesn't count as still going.
    const stillGoing = open !== null && due !== 'forgot-out'
    if (firstSeen?.date !== date && !stillGoing && dayStarted(now)) firstSeen = { date, at: stamp }
    // Still here. Not when an old session waits for its time-out: its last seen is the
    // evidence of when you left.
    if (due !== 'forgot-out') {
      if (isOpen(today)) q.touchAttendance(db, date, stamp)
      if (open) q.touchAttendance(db, open.date, stamp)
    }
  }
  return {
    due: present && Date.now() >= quietUntil ? due : null,
    extended: extendedSession(today) || (due !== 'forgot-out' && extendedSession(open)),
    quiet: onLunch(today) || onLunch(open) || (today !== null && !today.timeIn)
  }
}

// The bubble for a question. Main only: it needs the database for names and times.
// null when the question no longer applies (the session was closed in the meantime).
export function attendanceBubble(due: NonNullable<AttendanceDue>): Bubble | null {
  const s = getSettings()
  const date = localDate()
  switch (due) {
    case 'time-in': {
      const at = firstSeen?.date === date ? firstSeen.at : localTimestamp()
      const type = dayType(date)
      return { kind: 'time-in', at: hhmm(at), nonWork: isWorkDay(date, s.workDays, type) ? null : nonWorkLabel(date, type) }
    }
    case 'forgot-out': {
      const open = q.openSessionBefore(db, date)
      return open ? { kind: 'forgot-out', date: open.date, lastSeen: hhmm(lastSeenOut(open)) } : null
    }
    case 'ot-ask':
      return { kind: 'ot-ask', end: s.workEnd }
    case 'lunch-back':
      return { kind: 'lunch-back' }
  }
}

// The time-out a forgotten session gets: when Pong last saw you (4:58 counts as 5:00).
function lastSeenOut(open: Attendance): string {
  return timeOutStamp(open.date, open.lastSeen ?? open.timeIn!, getSettings().workEnd)
}

// ---- what your clicks do

// Time in. Answering the morning bubble uses the moment Pong first saw you; timing in
// later after "Not working today" uses now. Already timed in today: nothing changes
// (a second click from the tray or an old bubble keeps the first time-in).
export function timeIn(): Attendance {
  const date = localDate()
  const today = todayRecord()
  if (today?.timeIn) return today
  const now = localTimestamp()
  const at = today === null && firstSeen?.date === date ? firstSeen.at : now
  return saveAttendance(date, {
    timeIn: at,
    lastSeen: now,
    nonWorkDay: !isWorkDay(date, getSettings().workDays, dayType(date))
  })
}

export function notWorkingToday(): void {
  if (todayRecord() === null) saveAttendance(localDate(), {})
}

// Lunch and "Yes, OT" act on the open session (past midnight too), never on a new day:
// a write to a day with no time-in would read as "Not working today".
export function lunchOut(): void {
  const date = openDate()
  if (date && !onLunch(q.attendanceFor(db, date))) saveAttendance(date, { lunchOut: localTimestamp(), lunchIn: null })
}

export function lunchIn(): void {
  const date = openDate()
  if (date && onLunch(q.attendanceFor(db, date))) saveAttendance(date, { lunchIn: localTimestamp() })
}

// "Yes, OT": mark it pending; the extra-time card asks about approval at time-out.
// An approval already answered (yes / no / pending) stays as it is.
export function overtimeYes(): void {
  const date = openDate()
  if (date && q.attendanceFor(db, date)?.approved === null) saveAttendance(date, { approved: 'pending' })
}

// Which session a Time out click closes: today's, or one still going past midnight.
function openDate(): string | null {
  const today = todayRecord()
  if (isOpen(today)) return today.date
  return q.openSessionBefore(db, localDate())?.date ?? null
}

// Time out, three ways:
//   'now'        the button: now, or your end time if it's only a few minutes away
//   'end'        "I left at 5:00 PM"
//   'last-seen'  a forgotten time-out: when Pong last saw you
// Returns the saved record and the OT / extended-hours minutes that count.
export function timeOut(how: 'now' | 'end' | 'last-seen', date = openDate()): { record: Attendance; minutes: number } | null {
  if (!date) return null
  const rec = q.attendanceFor(db, date)
  if (!rec?.timeIn || rec.timeOut) return null // not timed in, or already out
  const s = getSettings()
  let at =
    how === 'end'
      ? stampAt(date, s.workEnd)
      : how === 'last-seen'
        ? lastSeenOut(rec)
        : timeOutStamp(date, localTimestamp(), s.workEnd)
  if (at < rec.timeIn) at = rec.timeIn // never out before in
  // Still out for lunch at time-out: lunch ends there too.
  const lunch = rec.lunchOut && !rec.lunchIn ? { lunchIn: at } : {}
  const record = saveAttendance(date, { timeOut: at, ...lunch })
  return { record, minutes: countedMinutes(record, s) }
}
