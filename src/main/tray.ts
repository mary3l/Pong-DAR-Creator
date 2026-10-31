// tray.ts: Pong's icon in the notification area (bottom-right, by the clock).
// Runs in the MAIN process: Tray and Menu are main-only Electron APIs.
//   left-click   opens the check-in card
//   right-click  Log now, Open Pong, Pause 1 hr / Resume, Quit
import { app, Menu, nativeImage, Tray } from 'electron'
import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
// `?asset` (electron-vite): copy the file into out/ and give us its path at runtime.
import trayIcon from '../../build/tray.png?asset'
import trayIcon2x from '../../build/tray@2x.png?asset'
import { events } from './events'
import * as q from './queries'
import { isPaused, pause, pausedUntil, resume } from './scheduler'
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

export function createTray(db: DatabaseSync): Tray {
  tray = new Tray(icon())
  tray.on('click', () => openCheckin({ mode: 'entry', source: 'checkin' }))

  // Rebuilt whenever something it shows changes: the note count, paused or not.
  const refresh = (): void => {
    if (!tray) return
    const count = q.entriesByDate(db, localDate()).length
    const paused = isPaused()
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
  // The count resets at midnight: refresh every few minutes to catch the new day.
  setInterval(refresh, 5 * 60_000)
  return tray
}

// A small Windows notification from the tray icon, e.g. "Ctrl+Alt+L is taken".
export function trayBalloon(title: string, content: string): void {
  tray?.displayBalloon({ title, content, iconType: 'info' })
}
