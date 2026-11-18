// pong.ts: Pong's mood and speech bubble. Runs in the MAIN process.
// Main owns this state and pushes it to the pong window (window.pong.onPongState);
// the renderer only draws it and reports clicks back (window.pong.pongAction).
//   check-in due:  sleep -> peek (1 s) -> ask + bubble
//   note saved:    happy + "Saved to ..." -> sleep
//   Later:         snooze -> sleep, ask again in 15 min
//   attendance:    time-in, forgotten time-out, "Still working?", lunch (Phase 9)
import type { DatabaseSync } from 'node:sqlite'
import {
  attendanceBubble, currentSession, lunchIn, lunchOut, notWorkingToday, overtimeYes, snoozeAttendance, timeIn, timeOut
} from './attendance'
import { events } from './events'
import * as q from './queries'
import { pause, snooze } from './scheduler'
import { getSettings } from './settings'
import { setPongExpanded } from './placement'
import { getWindow, openCheckin, send, showWindow } from './windows'
import { hhmm, type AttendanceDue } from '../shared/attendance'
import { localDate, time12 } from '../shared/dates'
import type { Bubble, PongAction, PongMood, PongState } from '../shared/types'

let db: DatabaseSync
let state: PongState = { mood: 'sleep', bubble: null, animations: true, session: 'off', trackLunch: false }
let timers: NodeJS.Timeout[] = []

// Every change goes through here: remember it, size the window, tell the renderer.
function set(mood: PongMood, bubble: Bubble | null): void {
  const s = getSettings()
  state = { mood, bubble, animations: s.animations, session: currentSession(), trackLunch: s.trackLunch }
  setPongExpanded(bubble !== null)
  // "Tray icon only": the pong window shows only while there's something to say.
  if (getSettings().spot === 'tray' && !bubble) getWindow('pong')?.hide()
  else showWindow('pong')
  send('pong', 'pong:state', state)
}

// Runs `fn` after `ms`, unless the mood changes first (clearTimers).
function later(ms: number, fn: () => void): void {
  timers.push(setTimeout(fn, ms))
}
function clearTimers(): void {
  timers.forEach(clearTimeout)
  timers = []
}

function toast(mood: PongMood, title: string, sub: string, ms = 3600): void {
  clearTimers()
  set(mood, { kind: 'toast', title, sub })
  later(Math.min(1800, ms), () => set('sleep', state.bubble)) // back to napping, toast still up
  later(ms, () => set('sleep', null))
}

export function pongState(): PongState {
  return state
}

// Pong is mid-conversation: asking, or the check-in card is open. The scheduler waits.
export function isBusy(): boolean {
  const asking = state.bubble !== null && state.bubble.kind !== 'toast'
  return asking || getWindow('checkin')?.isVisible() === true
}

// The scheduler says it's time. Missed days come first (the "Good morning!" bubble).
export function ask(missed: string[]): void {
  clearTimers()
  set('peek', null)
  later(1000, () => {
    set('ask', missed.length > 0 ? { kind: 'missed', days: missed } : { kind: 'ask', sub: sinceLastNote() })
    // Nobody answered in 10 minutes: go back to sleep. The next check-in comes as usual.
    later(10 * 60_000, () => set('sleep', null))
  })
}

// The scheduler says an attendance question is due: same peek, then that bubble.
// No answer in 10 minutes: back to sleep, and no attendance questions for half an hour.
export function askAttendance(due: NonNullable<AttendanceDue>): void {
  clearTimers()
  set('peek', null)
  later(1000, () => {
    const bubble = attendanceBubble(due)
    if (!bubble) return set('sleep', null) // answered some other way in the meantime
    set('ask', bubble)
    later(10 * 60_000, () => {
      snoozeAttendance(30)
      set('sleep', null)
    })
  })
}

const ATTENDANCE_BUBBLES = ['time-in', 'forgot-out', 'ot-ask', 'lunch-back']

// Time out, then either "See you tomorrow!" or, with OT / extended hours, the card that
// asks about approval (a click started this, so the card may take focus).
function timeOutAndAsk(how: 'now' | 'end' | 'last-seen', date?: string): void {
  clearTimers()
  const result = timeOut(how, date)
  if (!result) return set('sleep', null)
  const { record, minutes } = result
  if (minutes > 0) return openCheckin({ mode: 'extra', date: record.date })
  const today = record.date === localDate()
  toast('happy', `Timed out at ${time12(hhmm(record.timeOut!))}`, today ? 'See you tomorrow!' : 'All set. Have a good day!')
}

// "It's been about an hour since your last note." from today's newest note.
function sinceLastNote(): string {
  const today = q.entriesByDate(db, localDate())
  const last = today.at(-1)
  if (!last) return 'Nothing logged yet today.'
  const minutes = Math.round((Date.now() - new Date(last.createdAt).getTime()) / 60_000)
  if (minutes < 50) return `Your last note was ${minutes} minutes ago.`
  if (minutes < 80) return "It's been about an hour since your last note."
  return `It's been about ${Math.round(minutes / 60)} hours since your last note.`
}

// A click in the pong window. `detail` is only used by 'fill' (none) for now.
export function act(action: PongAction): void {
  const bubble = state.bubble
  switch (action) {
    case 'click': // the turtle itself
    case 'tell':
    case 'fill':
      clearTimers()
      if (bubble?.kind === 'missed' && action !== 'tell') openCheckin({ mode: 'missed', days: bubble.days })
      else openCheckin({ mode: 'entry', source: 'checkin' })
      return
    case 'later':
      if (bubble && ATTENDANCE_BUBBLES.includes(bubble.kind)) snoozeAttendance(15)
      else snooze(15)
      toast('snooze', "Okay! I'll ask again in 15 minutes", 'Snoozed')
      return
    case 'break':
      pause(30)
      toast('sleep', 'Enjoy your break!', 'Pong will stay quiet for 30 minutes')
      return
    case 'dismiss':
      clearTimers()
      set('sleep', null)
      return

    // ---- attendance (Phase 9)
    case 'time-in': {
      const rec = timeIn()
      const sub = rec.nonWorkDay
        ? 'This counts as extended hours. Remember your ATWEH.'
        : "Have a good day! I'll check in now and then."
      toast('happy', `Timed in at ${time12(hhmm(rec.timeIn!))}`, sub, 4600)
      return
    }
    case 'not-working':
      notWorkingToday()
      toast('sleep', 'Okay, no check-ins today', 'Hover over me and click Time in if that changes', 4600)
      return
    case 'time-out':
      return timeOutAndAsk('now')
    case 'left-at':
      return timeOutAndAsk('end')
    case 'use-last-seen':
      return timeOutAndAsk('last-seen', bubble?.kind === 'forgot-out' ? bubble.date : undefined)
    case 'fix-today':
      clearTimers()
      snoozeAttendance(30)
      set('sleep', null)
      showWindow('main')
      return
    case 'ot-yes':
      overtimeYes()
      toast('happy', 'Got it, OT it is', "I'll keep checking in until you time out", 4200)
      return
    case 'lunch-out':
      lunchOut()
      toast('sleep', 'Enjoy your lunch!', "Check-ins pause until you're back")
      return
    case 'lunch-in':
      lunchIn()
      toast('happy', 'Welcome back!', 'Check-ins are on again')
  }
}

// The check-in card tells Pong how the missed days went.
export function missedDone(summary: string | null): void {
  if (summary === null) toast('sleep', "Okay, I'll ask again at your next check-in", 'Missed days stay on my list until they are filled')
  else toast('happy', 'All caught up! Your DAR has no gaps.', summary, 4600)
}

export function initPong(database: DatabaseSync): void {
  db = database
  state.animations = getSettings().animations

  // The card is open: Pong listens. Closed without saving: back to sleep.
  events.on('checkin-shown', () => {
    clearTimers()
    set('listen', null)
  })
  events.on('checkin-hidden', () => {
    if (state.mood === 'listen') set('sleep', null)
  })

  events.on('entry-saved', (entry) => {
    const today = entry.workDate === localDate()
    const output = entry.outputId === null ? undefined : q.listOutputs(db).find((o) => o.id === entry.outputId)
    const title = output
      ? `Saved to ${output.short || output.title}${entry.progress ? ` · ${entry.progress * 100}%` : ''}`
      : 'Saved your note'
    if (!today) return // a missed day's log: the card shows it, no toast needed
    const count = q.entriesByDate(db, entry.workDate).length
    toast('happy', title, `${count} ${count === 1 ? 'note' : 'notes'} today · see you in about an hour`, 3800)
  })

  events.on('settings-changed', () => set(state.mood, state.bubble))
  // Timed in or out from the tray or the Today view: the hover buttons follow, and an
  // attendance question still up is now stale (answered elsewhere): put it away, so a
  // late click on it can't overwrite what was saved.
  events.on('attendance-saved', () => {
    if (state.bubble && ATTENDANCE_BUBBLES.includes(state.bubble.kind)) {
      clearTimers()
      set('sleep', null)
    } else set(state.mood, state.bubble)
  })
}
