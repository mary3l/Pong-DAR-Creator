// schedule.test.ts: when Pong may ask, written as checks.
import { describe, expect, it } from 'vitest'
import { isWorkTime, nextCheckinAt, tick, type TickInput } from './schedule'
import { DEFAULT_SETTINGS, settingsError } from './settings'

const S = DEFAULT_SETTINGS // 8:00-17:00, lunch 12:00-13:00, Mon-Fri, every 60 min +/- 15
const MIN = 60_000
// new Date(year, monthIndex, day, hour, minute): local time. Oct 26, 2026 is a Monday.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)
const input = (now: Date, dueAt: number | null, extra: Partial<TickInput> = {}): TickInput => ({
  now,
  dueAt,
  paused: false,
  quiet: false,
  random: 0.5,
  ...extra
})

describe('isWorkTime', () => {
  it('is true inside work hours on a work day', () => {
    expect(isWorkTime(at(26, 8, 0), S)).toBe(true)
    expect(isWorkTime(at(26, 16, 59), S)).toBe(true)
  })
  it('is false before 8, from 17:00, at lunch and on weekends', () => {
    expect(isWorkTime(at(26, 7, 59), S)).toBe(false)
    expect(isWorkTime(at(26, 17, 0), S)).toBe(false)
    expect(isWorkTime(at(26, 12, 0), S)).toBe(false)
    expect(isWorkTime(at(26, 12, 59), S)).toBe(false)
    expect(isWorkTime(at(26, 13, 0), S)).toBe(true)
    expect(isWorkTime(at(24, 10, 0), S)).toBe(false) // Saturday
    expect(isWorkTime(at(25, 10, 0), S)).toBe(false) // Sunday
  })
  it('follows the work days you pick', () => {
    expect(isWorkTime(at(24, 10, 0), { ...S, workDays: [6] })).toBe(true)
  })
})

describe('nextCheckinAt', () => {
  const from = at(26, 9).getTime()
  it('is an interval later, +/- 15 minutes', () => {
    expect(nextCheckinAt(from, S, 0.5)).toBe(from + 60 * MIN)
    expect(nextCheckinAt(from, S, 0)).toBe(from + 45 * MIN)
    expect(nextCheckinAt(from, S, 1)).toBe(from + 75 * MIN)
  })
  it('has no jitter with randomness off', () => {
    expect(nextCheckinAt(from, { ...S, randomness: false, intervalMin: 30 }, 0)).toBe(from + 30 * MIN)
  })
})

describe('tick', () => {
  it('plans the first check-in 5-10 minutes into the day', () => {
    const now = at(26, 8, 0)
    expect(tick(input(now, null, { random: 0 }), S)).toEqual({ dueAt: now.getTime() + 5 * MIN, ask: false })
    expect(tick(input(now, null, { random: 1 }), S).dueAt).toBe(now.getTime() + 10 * MIN)
  })

  it('waits until it is due', () => {
    const now = at(26, 9)
    const due = now.getTime() + MIN
    expect(tick(input(now, due), S)).toEqual({ dueAt: due, ask: false })
  })

  it('asks when due and plans the next one', () => {
    const now = at(26, 9)
    expect(tick(input(now, now.getTime() - MIN), S)).toEqual({ dueAt: now.getTime() + 60 * MIN, ask: true })
  })

  it('stays quiet while paused, idle, locked or full screen, then asks once', () => {
    const now = at(26, 10)
    const due = now.getTime() - 30 * MIN
    expect(tick(input(now, due, { paused: true }), S)).toEqual({ dueAt: due, ask: false })
    expect(tick(input(now, due, { quiet: true }), S)).toEqual({ dueAt: due, ask: false })
    // Back at the desk: one overdue check-in, then a full interval until the next.
    const back = tick(input(now, due), S)
    expect(back.ask).toBe(true)
    expect(tick(input(now, back.dueAt), S).ask).toBe(false)
  })

  it('never asks outside work time, and forgets the plan', () => {
    expect(tick(input(at(26, 12, 30), at(26, 12, 0).getTime()), S)).toEqual({ dueAt: null, ask: false })
    expect(tick(input(at(26, 18), at(26, 17).getTime()), S)).toEqual({ dueAt: null, ask: false })
    expect(tick(input(at(24, 10), null), S)).toEqual({ dueAt: null, ask: false }) // Saturday
  })

  it('after lunch, starts over with a first check-in', () => {
    const now = at(26, 13, 0)
    expect(tick(input(now, null, { random: 0 }), S)).toEqual({ dueAt: now.getTime() + 5 * MIN, ask: false })
  })
})

describe('settingsError', () => {
  it('accepts good changes', () => {
    expect(settingsError({ intervalMin: 45, workStart: '07:30', workDays: [1, 2, 3], spot: 'tray' })).toBeNull()
  })
  it('names the first bad field', () => {
    expect(settingsError({ intervalMin: 50 })).toBe('intervalMin')
    expect(settingsError({ workEnd: '25:00' })).toBe('workEnd')
    expect(settingsError({ workDays: [7] })).toBe('workDays')
    expect(settingsError({ animations: 'yes' })).toBe('animations')
    expect(settingsError({ codesRow: 1 })).toBe('codesRow')
    expect(settingsError({ hacker: true })).toBe('hacker')
    expect(settingsError({ repos: [{ path: 'C:/code/pong-dar', outputId: null, extra: 1 }] })).toBe('repos')
    expect(settingsError({ repos: [{ path: '', outputId: null }] })).toBe('repos')
  })
  it('accepts repos with or without a task', () => {
    expect(settingsError({ repos: [{ path: 'C:/code/pong-dar', outputId: 3 }, { path: 'D:/pip', outputId: null }] })).toBeNull()
  })
})
