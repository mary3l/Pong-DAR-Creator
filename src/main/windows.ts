// windows.ts: creates the three windows and shows, hides and talks to them.
// Runs in the MAIN process: only main can make windows.
import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { events } from './events'
import { PONG_SIZE, startPlacement } from './placement'
import type { CheckinRequest } from '../shared/types'
import type { WindowLabel } from '../shared/windowLabel'

const windows = new Map<WindowLabel, BrowserWindow>()

// Closing a window only hides it; Pong keeps running in the tray. Quit (tray menu)
// sets this first, so the windows really close and the app can exit.
let quitting = false
export function setQuitting(): void {
  quitting = true
}

const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
}

// One renderer bundle for every window; ?window= tells React which screen to draw.
function load(win: BrowserWindow, label: WindowLabel): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    win.loadURL(`${devUrl}?window=${label}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: label } })
  }
}

// Pong is local only: no popups, no navigating away from our own page.
function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
}

function create(label: WindowLabel, options: BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({ ...options, show: false, webPreferences })
  lockDown(win)
  load(win, label)
  windows.set(label, win)
  // The X button (or Alt+F4) hides instead of closing, unless we're quitting.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => windows.delete(label))
  return win
}

function bottomRight(width: number, height: number, margin: number): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin
  }
}

// The pong window: the turtle (140x150), growing up and left while a bubble shows.
// placement.ts parks it on the taskbar and keeps it there.
function createPongWindow(): BrowserWindow {
  const win = create('pong', {
    ...PONG_SIZE,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false // clicks work, but it never takes the keyboard from your app
  })
  // Click-through: clicks pass to whatever is behind the window, except over Pong and
  // his bubble. forward: true still sends mouse moves, so the page can tell main
  // when the cursor is over Pong (setPongHover below).
  win.setIgnoreMouseEvents(true, { forward: true })
  startPlacement(win)
  return win
}

// The renderer says the cursor is over Pong or his bubble (true) or not (false).
export function setPongHover(hover: boolean): void {
  const win = windows.get('pong')
  if (hover) win?.setIgnoreMouseEvents(false)
  else win?.setIgnoreMouseEvents(true, { forward: true })
}

const CHECKIN_WIDTH = 440

function createCheckinWindow(): BrowserWindow {
  const win = create('checkin', {
    width: CHECKIN_WIDTH,
    height: 520,
    ...bottomRight(CHECKIN_WIDTH, 520, 24),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#FFFFFF'
  })
  // Pong listens while the card is open (pong.ts).
  win.on('show', () => events.emit('checkin-shown'))
  win.on('hide', () => events.emit('checkin-hidden'))
  return win
}

function createMainWindow(): BrowserWindow {
  return create('main', {
    width: 1000,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: '#FFFCF7',
    title: 'Pong'
  })
}

// showMain: false when Pong starts with Windows (--hidden): only the tray and Pong appear.
export function createWindows(showMain = true): void {
  createPongWindow()
  createCheckinWindow()
  const main = createMainWindow()
  if (showMain) main.once('ready-to-show', () => main.show())
}

// How to build each window, so one that got destroyed anyway (a crash, or the page
// calling window.close(), which skips the 'close' event) can be rebuilt on demand.
const FACTORIES: Record<WindowLabel, () => BrowserWindow> = {
  pong: createPongWindow,
  checkin: createCheckinWindow,
  main: createMainWindow
}

export function getWindow(label: WindowLabel): BrowserWindow | undefined {
  return windows.get(label)
}

export function showWindow(label: WindowLabel): void {
  let win = windows.get(label)
  if (!win && !quitting) {
    win = FACTORIES[label]()
    // A fresh window has no page yet: show it once it's drawn, not as a white box.
    const ready = win
    ready.once('ready-to-show', () => showWindow(label))
    return
  }
  if (!win) return
  if (label === 'pong') {
    // Never steal focus from what the user is typing in.
    win.showInactive()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function hideWindow(label: WindowLabel): void {
  windows.get(label)?.hide()
}

// Main -> renderer messages. The renderer listens with window.pong.on...() (preload).
// A window that is still loading gets the message once it's ready.
export function send(label: WindowLabel, channel: string, payload?: unknown): void {
  const win = windows.get(label)
  if (!win) return
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send(channel, payload))
  } else {
    win.webContents.send(channel, payload)
  }
}

// ---- the check-in window

// What the check-in window should show. Kept here too, so a window that loads late
// can ask for it (window.pong.checkinRequest()) instead of missing the message.
let checkinRequest: CheckinRequest = { mode: 'entry', source: 'checkin' }

export function currentCheckinRequest(): CheckinRequest {
  return checkinRequest
}

// Only ever called after a click or a hotkey: this window takes the keyboard focus.
export function openCheckin(request: CheckinRequest): void {
  checkinRequest = request
  send('checkin', 'checkin:open', request)
  placeCheckin()
  showWindow('checkin')
}

// The card reports its height; the window follows, keeping its bottom edge in place.
export function fitCheckin(height: number): void {
  const win = windows.get('checkin')
  if (!win) return
  win.setContentSize(CHECKIN_WIDTH, Math.round(height))
  placeCheckin()
}

// Just above and left of where Pong sits, like the board; never off the top of the screen.
function placeCheckin(): void {
  const win = windows.get('checkin')
  if (!win) return
  const [width, height] = win.getSize()
  const { workArea } = screen.getPrimaryDisplay()
  win.setPosition(
    Math.round(workArea.x + workArea.width - width - 150),
    Math.round(Math.max(workArea.y + 8, workArea.y + workArea.height - height - 130))
  )
}
