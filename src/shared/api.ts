import type { WindowLabel } from './windowLabel'

// Everything the renderer may ask of the main process. The preload implements this
// as window.pong; each method maps to one ipcMain.handle channel in src/main.
export interface PongApi {
  showWindow(label: WindowLabel): Promise<void>
  hideWindow(label: WindowLabel): Promise<void>
}
