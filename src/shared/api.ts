// api.ts: the contract between the renderer and the main process.
// Shared by both sides, types only (nothing here runs).
//   preload/index.ts  implements it (`const api: PongApi = { ... }`)
//   preload/index.d.ts says window.pong is a PongApi, so React gets autocomplete
//   main/ipc.ts       has one ipcMain.handle per method
// Adding a feature = one line here, one in the preload, one handler in ipc.ts.
import type { DarGrid } from './cutoff'
import type {
  Category, CheckinRequest, DayStatus, DayType, Duty, Entry, ExportResult, NewEntry, Output, Period, Profile
} from './types'
import type { WindowLabel } from './windowLabel'

// Everything the renderer may ask of the main process. The preload implements this
// as window.pong; each method maps to one ipcMain.handle channel in src/main/ipc.ts.
// Every method returns a Promise: crossing between processes always takes a moment,
// so the renderer must `await` the answer.
export interface PongApi {
  showWindow(label: WindowLabel): Promise<void>
  hideWindow(label: WindowLabel): Promise<void>

  // the check-in window (Phase 3)
  openCheckin(): Promise<void> // shows the entry card for today
  checkinRequest(): Promise<CheckinRequest> // what the card should show right now
  fitCheckin(height: number): Promise<void> // the card's height in px; the window follows
  // Main -> renderer: called each time main opens the card. Returns "stop listening".
  onCheckinOpen(callback: (request: CheckinRequest) => void): () => void

  addEntry(entry: NewEntry): Promise<Entry> // returns the saved note, with its id
  entriesByDate(date: string): Promise<Entry[]>
  entriesInPeriod(period: Period): Promise<Entry[]>
  lastTagged(): Promise<Entry | null> // newest note with an MFO: the card preselects it

  listDuties(): Promise<Duty[]>
  addDuty(category: Category, title: string): Promise<Duty>
  updateDuty(id: number, changes: { title?: string; archived?: boolean }): Promise<void>
  listOutputs(): Promise<Output[]>
  recentOutputs(): Promise<Output[]> // the 5 chips on the check-in card
  addOutput(dutyId: number, title: string): Promise<Output>
  updateOutput(id: number, changes: { title?: string; status?: Output['status'] }): Promise<void>

  getProfile(): Promise<Profile>
  setProfile(changes: Partial<Profile>): Promise<Profile> // Partial = any subset of the fields
  dayStatusInPeriod(period: Period): Promise<DayStatus[]>
  setDayStatus(date: string, type: DayType | null): Promise<void> // null clears the day

  buildGrid(period: Period): Promise<DarGrid>
  exportDar(period: Period, replace: boolean): Promise<ExportResult> // adds the cutoff's sheet (Phase 2)
  seedFromSample(): Promise<{ duties: number; outputs: number; entries: number }> // dev only
}
