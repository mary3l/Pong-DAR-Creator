// schedule.ts: "is a check-in due?" as pure functions. No timers, no clock, no Electron:
// main/scheduler.ts calls tick() every 30 seconds with the current time and situation.
// Times are milliseconds (Date.getTime()); `now` is a Date so we can read the local hour.
import { minutesOf, type Settings } from './settings'

type ScheduleSettings = Pick<
  Settings,
  'intervalMin' | 'randomness' | 'workStart' | 'workEnd' | 'lunchStart' | 'lunchEnd' | 'workDays'
>

const MINUTE = 60_000
const JITTER_MIN = 15 // "Add a little randomness": +/- 15 minutes
// The first check-in of the morning (or after lunch) comes 5-10 minutes in, not on the dot.
const FIRST_MIN = 5
const FIRST_SPREAD_MIN = 5

// Pong may ask at this moment: a work day, inside work hours, not lunch.
export function isWorkTime(now: Date, s: ScheduleSettings): boolean {
  if (!s.workDays.includes(now.getDay())) return false
  const m = now.getHours() * 60 + now.getMinutes()
  if (m < minutesOf(s.workStart) || m >= minutesOf(s.workEnd)) return false
  return !(m >= minutesOf(s.lunchStart) && m < minutesOf(s.lunchEnd))
}

// When to ask next, counting from `from`. random is 0..1 (Math.random() in the app,
// fixed numbers in tests): 0 = 15 min early, 0.5 = on time, 1 = 15 min late.
export function nextCheckinAt(from: number, s: ScheduleSettings, random: number): number {
  const jitter = s.randomness ? (random * 2 - 1) * JITTER_MIN : 0
  return from + (s.intervalMin + jitter) * MINUTE
}

export interface TickInput {
  now: Date
  dueAt: number | null // when the next check-in is due; null = not planned yet
  paused: boolean // Pause 1 hr, On a break, Later (snooze)
  quiet: boolean // idle, locked, full-screen app, or Pong is already asking
  random: number // 0..1
}

// One step of the scheduler.
//   Outside work time: forget the plan (dueAt null), never ask.
//   Coming into work time with no plan: plan the first check-in 5-10 minutes from now.
//   Due, but paused or quiet: wait (keep dueAt), and ask at the first good moment.
//     That's also why coming back from a locked screen asks at most once: one check-in
//     was overdue, it's asked, and the next one is planned a full interval later.
//   Due and free: ask, and plan the next one an interval from now.
export function tick(input: TickInput, s: ScheduleSettings): { dueAt: number | null; ask: boolean } {
  const now = input.now.getTime()
  if (!isWorkTime(input.now, s)) return { dueAt: null, ask: false }
  if (input.dueAt === null) {
    return { dueAt: now + (FIRST_MIN + input.random * FIRST_SPREAD_MIN) * MINUTE, ask: false }
  }
  if (now < input.dueAt || input.paused || input.quiet) return { dueAt: input.dueAt, ask: false }
  return { dueAt: nextCheckinAt(now, s, input.random), ask: true }
}
