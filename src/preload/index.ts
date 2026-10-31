// preload/index.ts: the bridge. Runs in the PRELOAD context: just before each window's
// page loads, with access to a few Electron APIs (ipcRenderer) the page itself can't use.
//
// contextBridge.exposeInMainWorld('pong', api) makes `window.pong` exist in React.
// The page gets ONLY these functions, never ipcRenderer itself. If it had ipcRenderer,
// any bug or injected script in the UI could call any channel with any argument.
//
// Changes here need a restart of `npm run dev`; hot reload only covers the renderer.
import { contextBridge, ipcRenderer } from 'electron'
import type { PongApi } from '../shared/api'
import type { CheckinRequest, PongState } from '../shared/types'

// The only door from the renderer to the main process. Add one method per feature;
// never expose ipcRenderer itself.
// Typed as PongApi, so TypeScript errors if a method is missing or has the wrong arguments.
// Each line forwards to one channel in main/ipc.ts. invoke() returns a Promise of the
// handler's return value. Channel names must match ipc.ts exactly.
const api: PongApi = {
  showWindow: (label) => ipcRenderer.invoke('window:show', label),
  hideWindow: (label) => ipcRenderer.invoke('window:hide', label),

  openCheckin: () => ipcRenderer.invoke('checkin:open'),
  checkinRequest: () => ipcRenderer.invoke('checkin:request'),
  fitCheckin: (height) => ipcRenderer.invoke('checkin:fit', height),
  // The other direction: main sends, the page listens. The page still never sees
  // ipcRenderer: it gets a function that removes its own listener, nothing more.
  onCheckinOpen: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, request: CheckinRequest): void => callback(request)
    ipcRenderer.on('checkin:open', listener)
    return () => ipcRenderer.removeListener('checkin:open', listener)
  },
  missedDone: (summary) => ipcRenderer.invoke('missed:done', summary),

  pongState: () => ipcRenderer.invoke('pong:state'),
  onPongState: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, state: PongState): void => callback(state)
    ipcRenderer.on('pong:state', listener)
    return () => ipcRenderer.removeListener('pong:state', listener)
  },
  pongAction: (action) => ipcRenderer.invoke('pong:action', action),
  askNow: () => ipcRenderer.invoke('pong:askNow'),

  addEntry: (entry) => ipcRenderer.invoke('entries:add', entry),
  entriesByDate: (date) => ipcRenderer.invoke('entries:byDate', date),
  entriesInPeriod: (period) => ipcRenderer.invoke('entries:inPeriod', period),
  lastTagged: () => ipcRenderer.invoke('entries:lastTagged'),

  listDuties: () => ipcRenderer.invoke('duties:list'),
  addDuty: (category, title) => ipcRenderer.invoke('duties:add', category, title),
  updateDuty: (id, changes) => ipcRenderer.invoke('duties:update', id, changes),
  listOutputs: () => ipcRenderer.invoke('outputs:list'),
  recentOutputs: () => ipcRenderer.invoke('outputs:recent'),
  addOutput: (dutyId, title) => ipcRenderer.invoke('outputs:add', dutyId, title),
  updateOutput: (id, changes) => ipcRenderer.invoke('outputs:update', id, changes),

  getProfile: () => ipcRenderer.invoke('profile:get'),
  setProfile: (changes) => ipcRenderer.invoke('profile:set', changes),
  dayStatusInPeriod: (period) => ipcRenderer.invoke('dayStatus:inPeriod', period),
  setDayStatus: (date, type) => ipcRenderer.invoke('dayStatus:set', date, type),

  buildGrid: (period) => ipcRenderer.invoke('grid:build', period),
  exportDar: (period, replace) => ipcRenderer.invoke('dar:export', period, replace),
  seedFromSample: () => ipcRenderer.invoke('dev:seed')
}

contextBridge.exposeInMainWorld('pong', api)
