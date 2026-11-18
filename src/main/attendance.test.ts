// attendance.test.ts: main/attendance.ts against a real in-memory SQLite database and a
// fake clock (vi.useFakeTimers + setSystemTime). No Electron: attendance.ts only uses
// db/queries/settings/events. Each test gets fresh module state (firstSeen, quietUntil).
// A failing test here is an app bug, left failing on purpose; comments name the finding.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AttendanceModule = typeof import('./attendance')
type QueriesModule = typeof import('./queries')
type DbModule = typeof import('./db')
type SettingsModule = typeof import('./settings')

let att: AttendanceModule
let q: QueriesModule
let dbm: DbModule
let settings: SettingsModule
let db: DatabaseSync

// Nov 5, 2026 is a Thursday, Nov 6 a Friday, Nov 7 a Saturday, Nov 9 a Monday.
const THU = '2026-11-05'
const FRI = '2026-11-06'
const SAT = '2026-11-07'
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
// Move the fake clock and return the same moment, for checkAttendance(now, ...).
const clock = (d: Date): Date => {
  vi.setSystemTime(d)
  return d
}

beforeEach(async () => {
  vi.useFakeTimers()
  clock(at(6, 7, 0))
  vi.resetModules() // fresh firstSeen / quietUntil / settings for every test
  dbm = await import('./db')
  q = await import('./queries')
  settings = await import('./settings')
  att = await import('./attendance')
  db = dbm.openDb(':memory:')
  att.initAttendance(db)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('time-in (logging)', () => {
  it('suggests and saves the moment Pong first saw you, on the local date', () => {
    expect(att.checkAttendance(clock(at(6, 7, 52)), true).due).toBe('time-in')
    clock(at(6, 8, 5))
    expect(att.attendanceBubble('time-in')).toEqual({ kind: 'time-in', at: '07:52', nonWork: null })
    const saved = att.timeIn()
    expect(saved).toMatchObject({ date: FRI, timeIn: `${FRI}T07:52:00`, lastSeen: `${FRI}T08:05:00`, nonWorkDay: false })
    expect(q.attendanceFor(db, FRI)).toEqual(saved)
    expect(att.currentSession()).toBe('in')
  })

  it('does not record a first-seen time while you are away', () => {
    att.checkAttendance(clock(at(6, 7, 0)), false)
    expect(att.checkAttendance(clock(at(6, 8, 10)), false).due).toBe(null) // away: no question
    att.checkAttendance(clock(at(6, 8, 15)), true)
    expect(att.attendanceBubble('time-in')).toMatchObject({ at: '08:15' })
  })

  it('marks a Saturday or a holiday as a non-work day', () => {
    clock(at(7, 9))
    expect(att.timeIn()).toMatchObject({ date: SAT, nonWorkDay: true })
    expect(att.attendanceBubble('time-in')).toMatchObject({ nonWork: 'Saturday' })
    q.setDayStatus(db, '2026-11-09', 'holiday')
    clock(at(9, 9))
    expect(att.timeIn()).toMatchObject({ date: '2026-11-09', nonWorkDay: true })
  })

  it('stores "Not working today", keeps check-ins quiet, and allows a later time-in at the real time', () => {
    att.checkAttendance(clock(at(6, 7, 50)), true)
    att.notWorkingToday()
    expect(att.currentSession()).toBe('declined')
    expect(att.checkAttendance(clock(at(6, 9)), true)).toMatchObject({ due: null, quiet: true })
    clock(at(6, 10, 15))
    expect(att.timeIn().timeIn).toBe(`${FRI}T10:15:00`)
  })

  // Finding 5: a second Time in (tray, hover chip) must not move the first time-in.
  it('keeps the first time-in when Time in is clicked again later', () => {
    clock(at(6, 7, 52))
    att.timeIn()
    clock(at(6, 9, 0))
    att.timeIn()
    expect(q.attendanceFor(db, FRI)?.timeIn).toBe(`${FRI}T07:52:00`)
  })

  it('does nothing when attendance is switched off', () => {
    settings.saveSettings({ attendance: false })
    expect(att.checkAttendance(clock(at(6, 7, 52)), true)).toEqual({ due: null, extended: false, quiet: false })
    expect(att.currentSession()).toBe('off')
  })
})

describe('"Later" on an attendance bubble', () => {
  it('silences attendance questions for the snooze, then asks again', () => {
    att.checkAttendance(clock(at(6, 7, 52)), true)
    att.snoozeAttendance(15)
    expect(att.checkAttendance(clock(at(6, 8, 6)), true).due).toBe(null)
    expect(att.checkAttendance(clock(at(6, 8, 7)), true).due).toBe('time-in')
  })
})

describe('time-out', () => {
  beforeEach(() => {
    clock(at(6, 7, 52))
    att.timeIn()
  })

  it('snaps a time-out up to 15 min before the end time to the end time', () => {
    clock(at(6, 16, 50))
    const out = att.timeOut('now')
    expect(out).toMatchObject({ record: { timeOut: `${FRI}T17:00:00` }, minutes: 0 })
    expect(att.currentSession()).toBe('out')
  })

  it('keeps the real time when leaving early, and when on OT', () => {
    clock(at(6, 18, 25))
    expect(att.timeOut('now')).toMatchObject({ record: { timeOut: `${FRI}T18:25:00` }, minutes: 85 })
  })

  it('"I left at 5:00 PM" records the end time', () => {
    clock(at(6, 19))
    expect(att.timeOut('end')).toMatchObject({ record: { timeOut: `${FRI}T17:00:00` }, minutes: 0 })
  })

  it('ends an open lunch at the time-out', () => {
    clock(at(6, 12, 5))
    att.lunchOut()
    expect(att.currentSession()).toBe('lunch')
    expect(att.checkAttendance(clock(at(6, 12, 30)), true).quiet).toBe(true)
    clock(at(6, 14))
    expect(att.timeOut('now')?.record).toMatchObject({ lunchOut: `${FRI}T12:05:00`, lunchIn: `${FRI}T14:00:00` })
  })

  it('refuses a second time-out', () => {
    clock(at(6, 17))
    expect(att.timeOut('now')).not.toBeNull()
    clock(at(6, 18))
    expect(att.timeOut('now')).toBeNull()
    expect(q.attendanceFor(db, FRI)?.timeOut).toBe(`${FRI}T17:00:00`)
  })

  it('a "Yes, OT" session keeps check-ins going after hours', () => {
    clock(at(6, 17, 15))
    expect(att.checkAttendance(at(6, 17, 15), true).due).toBe('ot-ask')
    att.overtimeYes()
    expect(att.checkAttendance(clock(at(6, 17, 16)), true)).toMatchObject({ due: null, extended: true })
  })
})

describe('a session that crosses midnight', () => {
  beforeEach(() => {
    clock(at(6, 7, 52))
    att.timeIn()
    att.checkAttendance(clock(at(6, 23, 50)), true) // still here late
  })

  // Finding 1: CLAUDE.md "a time-out after midnight belongs to the time-in day". The
  // hover buttons and tray read currentSession(); 'none' hides Time out.
  it('still shows as timed in after midnight', () => {
    clock(at(7, 0, 20))
    expect(att.currentSession()).toBe('in')
  })

  it('keeps last seen fresh past midnight and asks nothing while you are still at it', () => {
    expect(att.checkAttendance(clock(at(7, 0, 20)), true)).toMatchObject({ due: null })
    expect(q.attendanceFor(db, FRI)?.lastSeen).toBe(`${SAT}T00:20:00`)
    expect(q.attendanceFor(db, SAT)).toBeNull()
  })

  it('records a time-out after midnight on the time-in day', () => {
    clock(at(7, 0, 20))
    const out = att.timeOut('now')
    expect(out?.record).toMatchObject({ date: FRI, timeOut: `${SAT}T00:20:00` })
    expect(out?.minutes).toBe(440) // 17:00 -> 00:20
    expect(q.attendanceFor(db, SAT)).toBeNull()
  })

  // Finding 5: after midnight these write to the new date and create a row with no
  // time_in, which reads as "Not working today" on that day.
  it('"Yes, OT" after midnight marks the open session, not a new day', () => {
    clock(at(7, 0, 10))
    att.overtimeYes()
    expect(q.attendanceFor(db, FRI)?.approved).toBe('pending')
    expect(q.attendanceFor(db, SAT)).toBeNull()
  })

  it('lunch out / back after midnight does not create a "Not working today" row for the new day', () => {
    clock(at(7, 0, 10))
    att.lunchOut()
    clock(at(7, 0, 40))
    att.lunchIn()
    expect(q.attendanceFor(db, SAT)).toBeNull()
  })
})

describe('"Yes, OT" (finding 5)', () => {
  it('does not overwrite an approval that was already answered', () => {
    clock(at(6, 7, 52))
    att.timeIn()
    att.saveAttendance(FRI, { approved: 'yes' })
    clock(at(6, 18))
    att.overtimeYes()
    expect(q.attendanceFor(db, FRI)?.approved).toBe('yes')
  })
})

describe('forgot to time out', () => {
  beforeEach(() => {
    clock(at(6, 7, 52))
    att.timeIn()
    att.checkAttendance(clock(at(6, 17, 42)), true) // last seen at 5:42 PM
  })

  it('asks on the next morning, offers last seen, and does not refresh it', () => {
    expect(att.checkAttendance(clock(at(9, 7, 50)), true).due).toBe('forgot-out')
    expect(q.attendanceFor(db, FRI)?.lastSeen).toBe(`${FRI}T17:42:00`)
    expect(att.attendanceBubble('forgot-out')).toEqual({ kind: 'forgot-out', date: FRI, lastSeen: '17:42' })
  })

  it('"Use 5:42 PM" times the old session out at last seen, then asks for today\'s time-in', () => {
    att.checkAttendance(clock(at(9, 7, 50)), true)
    const out = att.timeOut('last-seen')
    expect(out).toMatchObject({ record: { date: FRI, timeOut: `${FRI}T17:42:00` }, minutes: 42 })
    expect(att.checkAttendance(clock(at(9, 7, 51)), true).due).toBe('time-in')
    expect(att.attendanceBubble('time-in')).toMatchObject({ at: '07:50' })
  })
})

describe('time-in after a late OT session (finding 3)', () => {
  beforeEach(() => {
    clock(at(5, 7, 52)) // Thursday
    att.timeIn()
    att.overtimeYes()
    att.checkAttendance(clock(at(5, 23, 50)), true)
    att.checkAttendance(clock(at(6, 0, 5)), true) // 00:05 Friday, still on Thursday's OT
    clock(at(6, 0, 30))
    att.timeOut('now')
  })

  it('does not ask "Time in at 12:30 AM?" right after timing out past midnight', () => {
    expect(q.attendanceFor(db, THU)?.timeOut).toBe(`${FRI}T00:30:00`)
    expect(att.checkAttendance(clock(at(6, 0, 31)), true).due).not.toBe('time-in')
  })

  it('suggests the morning moment Pong sees you, not 00:05', () => {
    expect(att.checkAttendance(clock(at(6, 7, 55)), true).due).toBe('time-in')
    expect(att.attendanceBubble('time-in')).toMatchObject({ at: '07:55' })
  })
})

describe('nothing is lost on restart', () => {
  let dir: string
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps an open session and a finished day in pong.db across a close and re-open', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pong-att-'))
    const file = join(dir, 'pong.db')
    let fileDb = dbm.openDb(file)
    att.initAttendance(fileDb)
    clock(at(5, 7, 52))
    att.timeIn()
    clock(at(5, 18, 10))
    att.timeOut('now')
    att.saveAttendance(THU, { approved: 'yes' })
    clock(at(6, 8, 1))
    att.timeIn()
    const before = q.attendanceInPeriod(fileDb, { start: '2026-11-03', end: '2026-11-17' })
    fileDb.close()

    fileDb = dbm.openDb(file) // the app starts again
    att.initAttendance(fileDb)
    expect(q.attendanceInPeriod(fileDb, { start: '2026-11-03', end: '2026-11-17' })).toEqual(before)
    expect(att.currentSession()).toBe('in')
    clock(at(6, 17))
    expect(att.timeOut('now')?.record).toMatchObject({ date: FRI, timeIn: `${FRI}T08:01:00`, timeOut: `${FRI}T17:00:00` })
    fileDb.close()
  })
})
