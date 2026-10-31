// pong.ts: Pong's mood and speech bubble. Runs in the MAIN process.
// Main owns this state and pushes it to the pong window (window.pong.onPongState);
// the renderer only draws it and reports clicks back (window.pong.pongAction).
//   check-in due:  sleep -> peek (1 s) -> ask + bubble
//   note saved:    happy + "Saved to ..." -> sleep
//   Later:         snooze -> sleep, ask again in 15 min
import type { DatabaseSync } from 'node:sqlite'
import { events } from './events'
import * as q from './queries'
import { pause, snooze } from './scheduler'
import { getSettings } from './settings'
import { getWindow, openCheckin, send, setPongExpanded, showWindow } from './windows'
import { localDate } from '../shared/dates'
import type { Bubble, PongAction, PongMood, PongState } from '../shared/types'

let db: DatabaseSync
let state: PongState = { mood: 'sleep', bubble: null, animations: true }
let timers: NodeJS.Timeout[] = []

// Every change goes through here: remember it, size the window, tell the renderer.
function set(mood: PongMood, bubble: Bubble | null): void {
  state = { mood, bubble, animations: getSettings().animations }
  setPongExpanded(bubble !== null)
  // "Tray icon only": the pong window shows only while there's something to say.
  if (getSettings().spot === 'tray') {
    if (bubble) showWindow('pong')
    else getWindow('pong')?.hide()
  }
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
      snooze(15)
      toast('snooze', "Okay! I'll ask again in 15 minutes", 'Snoozed')
      return
    case 'break':
      pause(30)
      toast('sleep', 'Enjoy your break!', 'Pong will stay quiet for 30 minutes')
      return
    case 'dismiss':
      clearTimers()
      set('sleep', null)
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
}
