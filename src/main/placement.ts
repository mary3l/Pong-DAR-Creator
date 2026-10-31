// placement.ts: parks the pong window on the taskbar, and keeps it there when screens
// change (scaling, resolution, a monitor plugged in or out).
// Runs in the MAIN process: only main can read the screen and move windows.
// The math is in shared/placement.ts (pure, tested); this file feeds it real numbers.
import { screen, type BrowserWindow } from 'electron'
import { pongBounds } from '../shared/placement'

let expanded = false
let target: BrowserWindow | null = null
const SIZE = { width: 140, height: 150 }
const EXPANDED = { width: 460, height: 330 }

export function placePong(): void {
  if (!target || target.isDestroyed()) return
  const { bounds, workArea } = screen.getPrimaryDisplay()
  target.setBounds(pongBounds(bounds, workArea, expanded ? EXPANDED : SIZE))
  // Windows sometimes drops "always on top" after display changes; ask again.
  // 'screen-saver' is the highest level: above the taskbar itself.
  target.setAlwaysOnTop(true, 'screen-saver')
}

// Grow for a speech bubble, shrink back after. Bottom-right corner stays put.
export function setPongExpanded(value: boolean): void {
  if (expanded === value) return
  expanded = value
  placePong()
}

export function startPlacement(win: BrowserWindow): void {
  target = win
  placePong()
  // DPI or resolution changed, monitor added or removed: place again.
  screen.on('display-metrics-changed', placePong)
  screen.on('display-added', placePong)
  screen.on('display-removed', placePong)
}

export const PONG_SIZE = SIZE
