// scheduler.ts: decides when Pong asks "What are you up to?". Runs in the MAIN process.
// Every 30 seconds it hands the current situation to tick() (shared/schedule.ts, pure
// and tested) and does what it says. All the rules live there; this file is the clock.
import type { DatabaseSync } from 'node:sqlite'
import { events } from './events'
import { quietReason } from './idle'
import { ask, isBusy } from './pong'
import * as q from './queries'
import { getSettings } from './settings'
import { missedDays, periodFor } from '../shared/cutoff'
import { localDate } from '../shared/dates'
import { isWorkTime, nextCheckinAt, tick } from '../shared/schedule'

const TICK_MS = 30_000

let dueAt: number | null = null // when the next check-in is due (ms); null = not planned
let pausedUntilMs = 0 // a timestamp; 0 = not paused

// ---- pause (tray, Ctrl+Alt+P, "On a break")

export function pause(minutes: number): void {
  pausedUntilMs = Date.now() + minutes * 60_000
  events.emit('pause-changed')
}

export function resume(): void {
  pausedUntilMs = 0
  events.emit('pause-changed')
}

export function isPaused(now = Date.now()): boolean {
  return now < pausedUntilMs
}

export function pausedUntil(): number {
  return pausedUntilMs
}

// "Later": ask again in a few minutes instead of an hour.
export function snooze(minutes: number): void {
  dueAt = Date.now() + minutes * 60_000
}

// For the Today view: "Next check-in around 3:45 PM". null outside work time.
export function nextCheckin(): number | null {
  return dueAt === null ? null : Math.max(dueAt, pausedUntilMs)
}

// ---- the clock

let database: DatabaseSync

// Asks now: "Good morning!" about missed days first if there are any, else "What are you up to?".
export function askNow(): void {
  const today = localDate()
  const period = periodFor(today)
  const missed = getSettings().askMissedDays
    ? missedDays(today, q.entriesInPeriod(database, period), q.dayStatusInPeriod(database, period), getSettings().startedOn)
    : []
  ask(missed)
}

export function startScheduler(db: DatabaseSync): void {
  database = db
  const step = (): void => {
    const s = getSettings()
    const next = tick(
      {
        now: new Date(),
        dueAt,
        paused: isPaused(),
        quiet: quietReason() !== null || isBusy(),
        random: Math.random()
      },
      s
    )
    dueAt = next.dueAt
    if (next.ask) askNow()
  }

  setInterval(step, TICK_MS)
  setTimeout(step, 3000) // a first look shortly after starting

  // A note saved any other way (hotkey, tray) counts as a check-in: start the hour over.
  events.on('entry-saved', () => {
    const s = getSettings()
    if (isWorkTime(new Date(), s)) dueAt = nextCheckinAt(Date.now(), s, Math.random())
  })
  // New work hours or interval: plan again from scratch.
  events.on('settings-changed', () => (dueAt = null))
}
