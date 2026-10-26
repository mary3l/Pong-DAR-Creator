import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { isWindowLabel } from '../shared/windowLabel'
import { createWindows, hideWindow, showWindow } from './windows'

// Dev runs keep their data apart from the installed app: %APPDATA%\Pong-dev vs %APPDATA%\Pong.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Pong-dev'))
}

function registerIpc(): void {
  // Arguments come from the renderer: check them before acting.
  ipcMain.handle('window:show', (_event, label: unknown) => {
    if (!isWindowLabel(label)) throw new Error(`Unknown window: ${String(label)}`)
    showWindow(label)
  })
  ipcMain.handle('window:hide', (_event, label: unknown) => {
    if (!isWindowLabel(label)) throw new Error(`Unknown window: ${String(label)}`)
    hideWindow(label)
  })
}

// Only one Pong: a second launch brings the first one's main window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow('main'))

  app.whenReady().then(() => {
    app.setAppUserModelId('ph.dcwd.pong')
    registerIpc()
    createWindows()
  })
}
