// scheduler.test.ts: main/scheduler.ts driven by fake timers. The real 30-second clock,
// real attendance.ts and an in-memory database; only the Electron-bound parts are
// stubbed: idle.ts (powerMonitor, koffi) and pong.ts (windows). Nothing waits in real time.
// A failing test here is an app bug, left failing on purpose; comments name the finding.
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isWorkTime } from '../shared/schedule'
import { DEFAULT_SETTINGS } from '../shared/settings'

const mocks = vi.hoisted(() => ({
  quietReason: vi.fn((): string | null => null),
  ask: vi.fn(),
  askAttendance: vi.fn(),
  isBusy: vi.fn(() => false)
}))
vi.mock('./idle', () => ({ quietReason: mocks.quietReason }))
vi.mock('./pong', () => ({ ask: mocks.ask, askAttendance: mocks.askAttendance, isBusy: mocks.isBusy }))

type SchedulerModule = typeof import('./scheduler')
type AttendanceModule = typeof import('./attendance')
type SettingsModule = typeof import('./settings')
type QueriesModule = typeof import('./queries')

let sched: SchedulerModule
let att: AttendanceModule
let settings: SettingsModule
let q: QueriesModule
let db: DatabaseSync
let asks: Date[] // when each check-in was asked

const MIN = 60_000
// Nov 5, 2026 is a Thursday, Nov 7 a Saturday, Nov 9 a Monday.
const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second)
const run = (ms: number): void => {
  vi.advanceTimersByTime(ms)
}
const runUntil = (d: Date): void => run(d.getTime() - Date.now())
const stamp = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(at(9, 8, 0))
  vi.resetModules() // fresh dueAt / pausedUntil / firstSeen per test
  mocks.quietReason.mockReset().mockReturnValue(null)
  mocks.isBusy.mockReset().mockReturnValue(false)
  mocks.askAttendance.mockReset()
  asks = []
  mocks.ask.mockReset().mockImplementation(() => asks.push(new Date()))
  vi.spyOn(Math, 'random').mockReturnValue(0.5) // first check-in 7.5 min in, intervals exactly 60 min
  const { openDb } = await import('./db')
  db = openDb(':memory:')
  settings = await import('./settings')
  q = await import('./queries')
  att = await import('./attendance')
  att.initAttendance(db)
  sched = await import('./scheduler')
  settings.saveSettings({ setupDone: true }) // no file: loadSettings was never called
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Today timed in at 7:52, so no attendance question gets in the way of check-ins.
const timedIn = (date = '2026-11-09', extra: Parameters<typeof q.setAttendance>[2] = {}) =>
  q.setAttendance(db, date, { timeIn: `${date}T07:52:00`, lastSeen: stamp(new Date()), ...extra })

describe('check-in interval', () => {
  it('asks 5-10 min into the work day, then every interval', () => {
    settings.saveSettings({ attendance: false })
    sched.startScheduler(db)
    runUntil(at(9, 8, 7, 59))
    expect(asks).toHaveLength(0)
    runUntil(at(9, 8, 8))
    expect(asks).toEqual([at(9, 8, 8)])
    expect(mocks.ask).toHaveBeenCalledWith([]) // no missed days on day one
    runUntil(at(9, 9, 7, 59))
    expect(asks).toHaveLength(1)
    runUntil(at(9, 9, 8))
    expect(asks).toHaveLength(2)
  })

  it('follows a 30-minute interval from Settings', () => {
    settings.saveSettings({ attendance: false, intervalMin: 30 })
    sched.startScheduler(db)
    runUntil(at(9, 10, 0))
    expect(asks.map((d) => d.getTime())).toEqual([at(9, 8, 8), at(9, 8, 38), at(9, 9, 8), at(9, 9, 38)].map(Number))
  })

  it('never asks during lunch, and asks after it', () => {
    settings.saveSettings({ attendance: false })
    sched.startScheduler(db)
    runUntil(at(9, 14, 0))
    expect(asks.some((d) => d.getHours() === 12)).toBe(false)
    expect(asks.some((d) => d.getHours() === 13)).toBe(true)
  })

  it('works with attendance on once you have timed in', () => {
    timedIn()
    sched.startScheduler(db)
    runUntil(at(9, 9, 10))
    expect(asks).toHaveLength(2)
    expect(mocks.askAttendance).not.toHaveBeenCalled()
  })
})

describe('snooze and pause', () => {
  beforeEach(() => settings.saveSettings({ attendance: false }))

  it('"Later" asks again 15 minutes after the snooze', () => {
    sched.startScheduler(db)
    runUntil(at(9, 8, 8))
    sched.snooze(15)
    runUntil(at(9, 8, 22, 59))
    expect(asks).toHaveLength(1)
    runUntil(at(9, 8, 23))
    expect(asks).toHaveLength(2)
  })

  it('Pause 1 hour holds check-ins, then asks once when it ends', () => {
    sched.startScheduler(db)
    sched.pause(60)
    expect(sched.isPaused()).toBe(true)
    runUntil(at(9, 8, 59, 59))
    expect(asks).toHaveLength(0)
    runUntil(at(9, 9, 0))
    expect(asks).toEqual([at(9, 9, 0)])
    runUntil(at(9, 9, 59, 59))
    expect(asks).toHaveLength(1) // no burst of overdue check-ins
  })

  it('resume() lifts the pause right away', () => {
    sched.startScheduler(db)
    sched.pause(60)
    runUntil(at(9, 8, 20))
    sched.resume()
    run(30_000)
    expect(asks).toHaveLength(1)
  })

  it('a busy Pong (bubble already up) delays the check-in instead of dropping it', () => {
    sched.startScheduler(db)
    mocks.isBusy.mockReturnValue(true)
    runUntil(at(9, 8, 30))
    expect(asks).toHaveLength(0)
    mocks.isBusy.mockReturnValue(false)
    run(30_000)
    expect(asks).toHaveLength(1)
  })
})

describe('sleep, lock and resume', () => {
  beforeEach(() => settings.saveSettings({ attendance: false }))

  it('asks once on wake after a 3-hour sleep, not once per missed hour', () => {
    sched.startScheduler(db)
    runUntil(at(9, 8, 8))
    expect(asks).toHaveLength(1)
    // The PC sleeps: no timers run, the wall clock jumps.
    mocks.quietReason.mockReturnValue('away')
    vi.setSystemTime(at(9, 11, 30))
    mocks.quietReason.mockReturnValue(null) // resume
    run(30_000)
    expect(asks).toHaveLength(2)
    run(59 * MIN)
    expect(asks).toHaveLength(2) // the next one is a full interval after the wake-up ask
  })

  it('stays quiet while the screen is locked and asks once on unlock', () => {
    sched.startScheduler(db)
    mocks.quietReason.mockReturnValue('away')
    runUntil(at(9, 10, 0))
    expect(asks).toHaveLength(0)
    mocks.quietReason.mockReturnValue(null)
    run(30_000)
    expect(asks).toHaveLength(1)
  })
})

describe('midnight rollover', () => {
  it('asks nothing overnight and plans the next morning fresh', () => {
    settings.saveSettings({ attendance: false })
    vi.setSystemTime(at(9, 16, 0))
    sched.startScheduler(db)
    runUntil(at(10, 9, 0))
    expect(asks.length).toBeGreaterThan(0)
    for (const d of asks) expect(isWorkTime(d, DEFAULT_SETTINGS)).toBe(true)
    const tuesday = asks.filter((d) => d.getDate() === 10)
    expect(tuesday[0].getTime()).toBeGreaterThanOrEqual(at(10, 8, 5).getTime())
    expect(tuesday[0].getTime()).toBeLessThanOrEqual(at(10, 8, 10).getTime())
  })

  it('an OT session keeps check-ins going past midnight and stops at time-out', () => {
    vi.setSystemTime(at(5, 17, 30)) // Thursday
    timedIn('2026-11-05', { approved: 'pending' }) // "Yes, OT"
    sched.startScheduler(db)
    runUntil(at(6, 0, 45))
    expect(asks.some((d) => d.getDate() === 5 && d.getHours() >= 18)).toBe(true)
    expect(asks.some((d) => d.getDate() === 6 && d.getHours() === 0)).toBe(true)
    expect(mocks.askAttendance).not.toHaveBeenCalled() // still at it: no "forgot to time out"
    att.timeOut('now')
    const before = asks.length
    runUntil(at(6, 7, 0))
    expect(asks).toHaveLength(before)
  })

  it('does not ask a weekend check-in without a weekend session', () => {
    settings.saveSettings({ attendance: false })
    vi.setSystemTime(at(7, 9, 0)) // Saturday
    sched.startScheduler(db)
    runUntil(at(7, 17, 0))
    expect(asks).toHaveLength(0)
  })
})

describe('attendance in the scheduler', () => {
  it('asks for the time-in before any check-in', () => {
    vi.setSystemTime(at(9, 7, 52))
    sched.startScheduler(db)
    run(3_000)
    expect(mocks.askAttendance).toHaveBeenCalledWith('time-in')
    expect(asks).toHaveLength(0)
  })

  // Finding 2: Pause 1 hour (tray, Ctrl+Alt+P, "On a break") must silence Pong, attendance
  // bubbles included (CLAUDE.md "Stay quiet: ... paused").
  it('stays silent about attendance while paused', () => {
    vi.setSystemTime(at(9, 7, 52))
    sched.startScheduler(db)
    sched.pause(60)
    runUntil(at(9, 8, 30))
    expect(mocks.askAttendance).not.toHaveBeenCalled()
  })

  it('keeps check-ins quiet while out for lunch', () => {
    timedIn('2026-11-09', { lunchOut: '2026-11-09T08:00:00' })
    sched.startScheduler(db)
    runUntil(at(9, 10, 0))
    expect(asks).toHaveLength(0)
  })

  it('keeps check-ins quiet all day after "Not working today"', () => {
    q.setAttendance(db, '2026-11-09', {})
    sched.startScheduler(db)
    runUntil(at(9, 17, 0))
    expect(asks).toHaveLength(0)
    expect(mocks.askAttendance).not.toHaveBeenCalled()
  })

  it('asks "Still working?" 15 min after the end time', () => {
    vi.setSystemTime(at(9, 16, 50))
    timedIn()
    sched.startScheduler(db)
    runUntil(at(9, 17, 14, 59))
    expect(mocks.askAttendance).not.toHaveBeenCalledWith('ot-ask')
    runUntil(at(9, 17, 15, 30))
    expect(mocks.askAttendance).toHaveBeenCalledWith('ot-ask')
  })
})
