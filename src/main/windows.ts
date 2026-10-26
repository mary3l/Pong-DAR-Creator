import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { WindowLabel } from '../shared/windowLabel'

const windows = new Map<WindowLabel, BrowserWindow>()

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

// Phase 0: rough bottom-right spot. Phase 6 parks it on the taskbar edge (placement.ts).
function createPongWindow(): BrowserWindow {
  const win = create('pong', {
    width: 140,
    height: 150,
    ...bottomRight(140, 150, 16),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  return win
}

function createCheckinWindow(): BrowserWindow {
  return create('checkin', {
    width: 440,
    height: 520,
    ...bottomRight(440, 520, 24),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#FFFCF7'
  })
}

function createMainWindow(): BrowserWindow {
  const win = create('main', {
    width: 1000,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: '#FFFCF7',
    title: 'Pong'
  })
  win.once('ready-to-show', () => win.show())
  // Phase 0: closing the main window quits. Phase 3 changes this to hide, once the tray exists.
  win.on('closed', () => app.quit())
  return win
}

export function createWindows(): void {
  createPongWindow()
  createCheckinWindow()
  createMainWindow()
}

export function showWindow(label: WindowLabel): void {
  const win = windows.get(label)
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
