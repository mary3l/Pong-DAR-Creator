// index.ts: the main process starts here (package.json "main" points at its build).
// It runs once per launch, in Node, before any window exists.
import { app } from 'electron'
import { join } from 'node:path'
import { openDb } from './db'
import { startBackups } from './backup'
import { events } from './events'
import { watchPower } from './idle'
import { startLog } from './log'
import { registerIpc } from './ipc'
import { initPong } from './pong'
import { startScheduler } from './scheduler'
import { getSettings, loadSettings } from './settings'
import { registerShortcuts } from './shortcuts'
import { createTray, trayBalloon } from './tray'
import { createWindows, getWindow, setQuitting, showWindow } from './windows'

// Dev runs keep their data apart from the installed app: %APPDATA%\Pong-dev vs %APPDATA%\Pong.
// app.isPackaged is false under `npm run dev`, true in the installed app.
// This must happen before the app is ready, while the userData path can still change.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Pong-dev'))
}

// Only one Pong: a second launch brings the first one's main window forward.
// requestSingleInstanceLock() returns false if another Pong already holds the lock;
// this copy then quits, and the first one gets a 'second-instance' event.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow('main'))

  // whenReady(): Electron has finished starting up. Windows, IPC and most
  // app.getPath() folders are only usable from here on.
  app.whenReady().then(() => {
    app.setAppUserModelId('ph.dcwd.pong') // how Windows groups Pong's windows and notifications
    const userData = app.getPath('userData')
    startLog(join(userData, 'logs')) // from here on, console output also goes to a file

    // Open (or create) pong.db and run migrations, once, for the whole app.
    const db = openDb(join(userData, 'pong.db'))
    // Close it cleanly when Pong quits, so WAL changes are merged into pong.db.
    app.on('will-quit', () => db.close())

    // Order matters: handlers must exist before any window can call window.pong.
    const settings = loadSettings(userData)
    registerIpc(db)
    // Started by Windows at login (--hidden): just the tray and Pong, no main window.
    // The first run always shows it, for the setup form.
    const hidden = process.argv.includes('--hidden') && settings.setupDone
    createWindows(!hidden)
    createTray(db)
    initPong(db)
    // Pong naps on the taskbar from the start (unless you chose "Tray icon only").
    if (getSettings().spot === 'taskbar') getWindow('pong')?.once('ready-to-show', () => showWindow('pong'))
    watchPower()
    startScheduler(db)
    startBackups(db, join(userData, 'backups'))

    // "Start with Windows": a login item that runs Pong with --hidden. Only for the
    // installed app; under npm run dev it would register electron.exe instead.
    const applyAutostart = (): void => {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: getSettings().autostart, args: ['--hidden'] })
    }
    applyAutostart()
    events.on('settings-changed', applyAutostart)
    console.log(`Pong ${app.getVersion()} started${hidden ? ' hidden' : ''}`)

    // Closing a window only hides it. Quitting (tray menu, or Windows shutting down)
    // has to let the windows really close.
    app.on('before-quit', setQuitting)

    const failed = registerShortcuts()
    if (failed.length > 0) {
      trayBalloon('Some Pong hotkeys are taken', `Another app already uses ${failed.join(', ')}.`)
    }
  })
}