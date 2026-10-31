// scheduler.ts: decides when Pong asks "What are you up to?".
// Runs in the MAIN process. Phase 3: only the pause switch (tray and Ctrl+Alt+P).
// Phase 4 adds the check-in timer.
import { events } from './events'

let pausedUntilMs = 0 // a timestamp; 0 = not paused

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
