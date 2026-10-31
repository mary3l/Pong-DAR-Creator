// idle.ts: is now a bad moment to ask? Away from the PC, screen locked, asleep,
// or a full-screen app (presentation, video call, game) in front.
// Runs in the MAIN process: powerMonitor and calling Windows (koffi) need Node.
import { powerMonitor } from 'electron'
import { getSettings } from './settings'

const IDLE_SECONDS = 600 // 10 minutes without mouse or keyboard

// lock-screen / suspend: you're gone. unlock-screen / resume: you're back. While gone,
// Pong asks nothing; when you're back, an overdue check-in is asked once (schedule.ts).
let away = false

export function watchPower(): void {
  powerMonitor.on('lock-screen', () => (away = true))
  powerMonitor.on('suspend', () => (away = true))
  powerMonitor.on('unlock-screen', () => (away = false))
  powerMonitor.on('resume', () => (away = false))
}

// ---- full screen, asked of Windows itself
//
// SHQueryUserNotificationState (shell32.dll) is how Windows decides whether apps may
// show notifications. koffi lets JavaScript call it directly, without writing C.
// It writes one number into the pointer we pass:
//   2 QUNS_BUSY                     a full-screen app (not D3D)
//   3 QUNS_RUNNING_D3D_FULL_SCREEN  a full-screen game or video
//   4 QUNS_PRESENTATION_MODE        PowerPoint slideshow, "presentation mode"
//   5 QUNS_ACCEPTS_NOTIFICATIONS    all clear
const BUSY_STATES = [2, 3, 4]
type QueryFn = (out: number[]) => number
let query: QueryFn | null | undefined // undefined = not loaded yet, null = unavailable

function loadQuery(): QueryFn | null {
  try {
    // require() at first use, not import at the top: if koffi is missing or broken,
    // Pong still runs; it just can't see full-screen apps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const shell32 = koffi.load('shell32.dll')
    // _Out_ int *: koffi fills out[0] with the state. Returns an HRESULT (0 = OK).
    return shell32.func('int __stdcall SHQueryUserNotificationState(_Out_ int *pquns)') as QueryFn
  } catch (error) {
    console.warn('Full-screen check unavailable:', error)
    return null
  }
}

export function isFullScreenBusy(): boolean {
  if (process.platform !== 'win32') return false
  if (query === undefined) query = loadQuery()
  if (!query) return false
  const out = [0]
  return query(out) === 0 && BUSY_STATES.includes(out[0])
}

// Why Pong should stay quiet right now, or null if it may ask.
export function quietReason(): 'away' | 'idle' | 'fullscreen' | null {
  const s = getSettings()
  if (away) return 'away'
  if (s.quietWhenIdle && powerMonitor.getSystemIdleTime() >= IDLE_SECONDS) return 'idle'
  if (s.quietFullScreen && isFullScreenBusy()) return 'fullscreen'
  return null
}
