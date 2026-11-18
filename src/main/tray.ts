// tray.ts: Pong's icon in the notification area (bottom-right, by the clock).
// Runs in the MAIN process: Tray and Menu are main-only Electron APIs.
//   left-click   opens the check-in card
//   right-click  Log now, Open Pong, Pause 1 hr / Resume, Time in / Lunch / Time out, Quit
import { app, Menu, nativeImage, Tray } from 'electron'
import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
// `?asset` (electron-vite): copy the file into out/ and give us its path at runtime.
import trayIcon from '../../build/tray.png?asset'
import trayIcon2x from '../../build/tray@2x.png?asset'
import { currentSession } from './attendance'
import { events } from './events'
import { act } from './pong'
import * as q from './queries'
import { isPaused, pause, pausedUntil, resume } from './scheduler'
import { getSettings } from './settings'
import { openCheckin, setQuitting, showWindow } from './windows'
import { localDate } from '../shared/dates'

// Kept at module level on purpose: a Tray that is only a local variable gets
// garbage-collected, and the icon vanishes from the taskbar.
let tray: Tray | null = null

// 16 px for 100% scaling and 32 px for 200%; Windows picks the sharper one.
function icon(): Electron.NativeImage {
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(trayIcon) })
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayIcon2x) })
  return image
}

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// Time in, lunch and time out (Phase 9), depending on where today's session stands.
// Each one does exactly what the same button on Pong does (pong.ts act).
function attendanceItems(): Electron.MenuItemConstructorOptions[] {
  const session = currentSession()
  const lunch = getSettings().trackLunch
  switch (session) {
    case 'none':
    case 'declined':
      return [{ label: 'Time in', click: () => act('time-in') }]
    case 'in':
      return [
        ...(lunch ? [{ label: 'Lunch out', click: () => act('lunch-out') }] : []),
        { label: 'Time out', click: () => act('time-out') }
      ]
    case 'lunch':
      return [
        { label: 'Back from lunch', click: () => act('lunch-in') },
        { label: 'Time out', click: () => act('time-out') }
      ]
    default:
      return [] // attendance off, or already timed out
  }
}

export function createTray(db: DatabaseSync): Tray {
  tray = new Tray(icon())
  tray.on('click', () => openCheckin({ mode: 'entry', source: 'checkin' }))

  // Rebuilt whenever something it shows changes: the note count, paused or not.
  const refresh = (): void => {
    if (!tray) return
    const count = q.entriesByDate(db, localDate()).length
    const paused = isPaused()
    const attendance = attendanceItems()
    tray.setToolTip(
      `Pong · ${count} ${count === 1 ? 'note' : 'notes'} today` +
        (paused ? ` · paused until ${clock(pausedUntil())}` : '')
    )
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Log now', accelerator: 'Control+Alt+L', click: () => openCheckin({ mode: 'entry', source: 'checkin' }) },
        { label: 'Open Pong', accelerator: 'Control+Alt+K', click: () => showWindow('main') },
        paused
          ? { label: 'Resume check-ins', click: () => resume() }
          : { label: 'Pause 1 hr', accelerator: 'Control+Alt+P', click: () => pause(60) },
        { type: 'separator' },
        ...attendance,
        ...(attendance.length > 0 ? [{ type: 'separator' as const }] : []),
        {
          label: 'Quit Pong',
          click: () => {
            setQuitting()
            app.quit()
          }
        }
      ])
    )
  }
  refresh()
  events.on('entry-saved', refresh)
  events.on('pause-changed', refresh)
  events.on('attendance-saved', refresh)
  events.on('settings-changed', refresh)
  // The count resets at midnight: refresh every few minutes to catch the new day.
  setInterval(refresh, 5 * 60_000)
  return tray
}

// A small Windows notification from the tray icon, e.g. "Ctrl+Alt+L is taken".
export function trayBalloon(title: string, content: string): void {
  tray?.displayBalloon({ title, content, iconType: 'info' })
}
