import { contextBridge, ipcRenderer } from 'electron'
import type { PongApi } from '../shared/api'

// The only door from the renderer to the main process. Add one method per feature;
// never expose ipcRenderer itself.
const api: PongApi = {
  showWindow: (label) => ipcRenderer.invoke('window:show', label),
  hideWindow: (label) => ipcRenderer.invoke('window:hide', label)
}

contextBridge.exposeInMainWorld('pong', api)
