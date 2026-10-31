// ipc.ts: every renderer -> main request lands here.
// Runs in the MAIN process.
//
// How IPC works:
//   renderer:  await window.pong.addEntry({ text })            (DbCheck.tsx)
//   preload:   ipcRenderer.invoke('entries:add', { text })     (preload/index.ts)
//   main:      ipcMain.handle('entries:add', (event, entry) => ...)   <- this file
// Whatever the handler returns travels back to the renderer as the Promise's value.
// If it throws, the renderer's Promise rejects with the error message.
//
// Arguments come from a web page, so check each one before it reaches the database.
// Treat them like input from the internet: TypeScript types vanish at runtime, so
// nothing stops a buggy renderer from sending { text: 42 }.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { backupNow, lastBackup } from './backup'
import { events } from './events'
import { exportDar, undoExport } from './export'
import { commitsIn, gitInstalled, repoRoot } from './git'
import { act, missedDone, pongState } from './pong'
import * as q from './queries'
import { askNow, nextCheckin } from './scheduler'
import { getSettings, saveSettings } from './settings'
import { importFromWorkbook } from './workbook'
import { readDarSheet, seedDatabase } from './seed'
import { currentCheckinRequest, fitCheckin, hideWindow, openCheckin, send, setPongHover, showWindow } from './windows'
import { buildGrid, periodFor, type DarGrid } from '../shared/cutoff'
import { isIsoDate, localDate, localTimestamp } from '../shared/dates'
import { commitWindow, mergeSuggestions } from '../shared/gitlog'
import { isWindowLabel } from '../shared/windowLabel'
import { isTime, type Settings } from '../shared/settings'
import type { Category, DayType, EntryChanges, ExportResult, NewEntry, PongAction, Period, Profile } from '../shared/types'

// The allowed values, as lists we can check against at runtime.
const PROGRESS = [0.25, 0.5, 0.75, 1]
const CATEGORIES: Category[] = ['core', 'support']
const DAY_TYPES: DayType[] = ['rest', 'sick', 'personal', 'holiday']
const SOURCES = ['checkin', 'hotkey', 'manual'] // not 'seed': only seed.ts may use that
const PONG_ACTIONS: PongAction[] = ['click', 'tell', 'later', 'break', 'fill', 'dismiss']
const PROFILE_KEYS: (keyof Profile)[] = [
  'name', 'position', 'department', 'unit', 'teamLeader',
  'confirmedBy', 'confirmedTitle', 'notedBy', 'notedTitle', 'workbookPath'
]

// Throws if a check fails. `asserts ok` tells TypeScript: after check(x, ...) returns,
// x was true, so it can narrow types the same way an `if` would.
function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`Bad argument: ${what}`)
}

// Small type guards. `v is string` = "if this returns true, v is a string".
const isText = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max // not empty, not huge
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
// typeof null is 'object' in JavaScript (a famous quirk), hence the extra null check.
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isPeriod = (v: unknown): v is Period =>
  isObject(v) && isIsoDate(v.start) && isIsoDate(v.end) && v.start <= v.end
// A real cutoff (3rd-17th or 18th-2nd), not just any two dates: one sheet per cutoff.
const isCutoff = (v: unknown): v is Period =>
  isPeriod(v) && periodFor(v.start).start === v.start && periodFor(v.start).end === v.end

// Checks every field of a NewEntry. Optional fields may be missing (undefined) or null.
function checkNewEntry(v: unknown): asserts v is NewEntry {
  check(isObject(v), 'entry')
  check(isText(v.text), 'entry.text')
  check(v.workDate === undefined || isIsoDate(v.workDate), 'entry.workDate')
  check(v.time === undefined || isTime(v.time), 'entry.time')
  check(v.outputId === undefined || v.outputId === null || isId(v.outputId), 'entry.outputId')
  check(v.progress === undefined || v.progress === null || PROGRESS.includes(v.progress as number), 'entry.progress')
  check(v.source === undefined || SOURCES.includes(v.source as string), 'entry.source')
}

// An edit may change only these fields, each checked like a new note's.
function checkEntryChanges(v: unknown): asserts v is EntryChanges {
  check(isObject(v), 'changes')
  for (const key of Object.keys(v)) check(['text', 'outputId', 'progress', 'time'].includes(key), `changes.${key}`)
  check(v.text === undefined || isText(v.text), 'changes.text')
  check(v.outputId === undefined || v.outputId === null || isId(v.outputId), 'changes.outputId')
  check(v.progress === undefined || v.progress === null || PROGRESS.includes(v.progress as number), 'changes.progress')
  check(v.time === undefined || isTime(v.time), 'changes.time')
}

// A profile update may only contain known fields, each a short string or null.
function checkProfile(v: unknown): asserts v is Partial<Profile> {
  check(isObject(v), 'profile')
  // Object.entries({ a: 1 }) -> [['a', 1]]: loop over every key the renderer sent.
  for (const [key, value] of Object.entries(v)) {
    check(PROFILE_KEYS.includes(key as keyof Profile), `profile.${key}`)
    check(value === null || (typeof value === 'string' && value.length <= 300), `profile.${key}`)
  }
}

// The DAR grid for one cutoff: four queries in, one pure function out.
function gridFor(db: DatabaseSync, period: Period): DarGrid {
  return buildGrid(
    period,
    q.entriesInPeriod(db, period),
    q.listDuties(db),
    q.listOutputs(db),
    q.dayStatusInPeriod(db, period)
  )
}

// Where exports go.
//   Installed app: your DAR workbook (profile.workbookPath, chosen in first run or Settings).
//     export.ts never edits it in place: temp file, re-open check, .bak, then replace.
//   npm run dev: a copy of the sample, %TEMP%\Pong\MABANO_DAR_copy.xlsx, so development
//     never touches the real workbook. Delete the copy to start fresh.
function exportTargetPath(db: DatabaseSync): string | null {
  if (app.isPackaged) return q.getProfile(db).workbookPath
  return join(app.getPath('temp'), 'Pong', 'MABANO_DAR_copy.xlsx')
}

async function exportTarget(db: DatabaseSync): Promise<string> {
  const path = exportTargetPath(db)
  if (!path) throw new Error('Choose your DAR workbook first (Settings, DAR profile).')
  if (!app.isPackaged && !existsSync(path)) {
    const sample = join(app.getAppPath(), 'docs/reference/MABANO_DAR_sample.xlsx')
    await mkdir(join(path, '..'), { recursive: true }) // recursive: no error if it already exists
    await copyFile(sample, path)
  }
  return path
}

// The last export this session, so "Open in Excel" and "Undo" know which file.
let lastResult: (ExportResult & { period: Period }) | null = null

// Called once from index.ts, after the database is open.
// Each handler: (event, ...arguments). `_e` = the event; the _ says "not used here".
// Channel names follow '<area>:<verb>', and must match preload/index.ts exactly.
export function registerIpc(db: DatabaseSync): void {
  // Main -> main window: "notes or days off changed, reload". The check-in card saves
  // in another window, and Today and Cutoff should show it right away.
  const changed = (): void => send('main', 'data:changed')
  events.on('entry-saved', changed)
  events.on('day-status-saved', changed)

  // windows
  ipcMain.handle('window:show', (_e, label: unknown) => {
    check(isWindowLabel(label), 'window label')
    showWindow(label)
  })
  ipcMain.handle('window:hide', (_e, label: unknown) => {
    check(isWindowLabel(label), 'window label')
    hideWindow(label)
  })

  // the check-in window
  ipcMain.handle('checkin:request', () => currentCheckinRequest())
  ipcMain.handle('checkin:open', () => openCheckin({ mode: 'entry', source: 'checkin' }))
  ipcMain.handle('checkin:fit', (_e, height: unknown) => {
    check(typeof height === 'number' && height >= 200 && height <= 900, 'height')
    fitCheckin(height)
  })

  // Pong on the taskbar
  ipcMain.handle('pong:state', () => pongState())
  ipcMain.handle('pong:askNow', () => askNow()) // "Try a check-in" in Settings
  ipcMain.handle('pong:hover', (_e, hover: unknown) => {
    check(typeof hover === 'boolean', 'hover')
    setPongHover(hover)
  })
  ipcMain.handle('pong:action', (_e, action: unknown) => {
    check(PONG_ACTIONS.includes(action as PongAction), 'action')
    act(action as PongAction)
  })
  // The missed-day card is done: a summary like "Sat: Rest Day · Sun: 2 logs added",
  // or null when you closed it early.
  ipcMain.handle('missed:done', (_e, summary: unknown) => {
    check(summary === null || isText(summary, 300), 'summary')
    missedDone(summary)
  })

  // entries
  ipcMain.handle('entries:add', (_e, entry: unknown) => {
    checkNewEntry(entry) // after this line, TypeScript knows entry is a NewEntry
    const saved = q.addEntry(db, entry)
    events.emit('entry-saved', saved) // tray count, scheduler, Pong's happy hop
    return saved
  })
  ipcMain.handle('entries:lastTagged', () => q.lastTagged(db))
  ipcMain.handle('entries:update', (_e, id: unknown, changes: unknown) => {
    check(isId(id), 'id')
    checkEntryChanges(changes)
    return q.updateEntry(db, id, changes)
  })
  ipcMain.handle('entries:delete', (_e, id: unknown) => {
    check(isId(id), 'id')
    q.deleteEntry(db, id)
    changed()
  })
  ipcMain.handle('entries:byDate', (_e, date: unknown) => {
    check(isIsoDate(date), 'date')
    return q.entriesByDate(db, date)
  })
  ipcMain.handle('entries:inPeriod', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return q.entriesInPeriod(db, period)
  })

  // duties and MFOs
  ipcMain.handle('duties:list', () => q.listDuties(db))
  ipcMain.handle('duties:add', (_e, category: unknown, title: unknown) => {
    check(CATEGORIES.includes(category as Category), 'category')
    check(isText(title, 300), 'title')
    return q.addDuty(db, category as Category, title)
  })
  ipcMain.handle('duties:update', (_e, id: unknown, changes: unknown) => {
    check(isId(id), 'id')
    check(isObject(changes), 'changes')
    check(changes.title === undefined || isText(changes.title, 300), 'changes.title')
    check(changes.archived === undefined || typeof changes.archived === 'boolean', 'changes.archived')
    q.updateDuty(db, id, changes as { title?: string; archived?: boolean })
  })
  ipcMain.handle('outputs:list', () => q.listOutputs(db))
  ipcMain.handle('outputs:recent', () => q.recentOutputs(db))
  ipcMain.handle('outputs:add', (_e, dutyId: unknown, title: unknown) => {
    check(isId(dutyId), 'dutyId')
    check(isText(title, 300), 'title')
    return q.addOutput(db, dutyId, title)
  })
  ipcMain.handle('outputs:update', (_e, id: unknown, changes: unknown) => {
    check(isId(id), 'id')
    check(isObject(changes), 'changes')
    check(changes.title === undefined || isText(changes.title, 300), 'changes.title')
    check(changes.status === undefined || changes.status === 'active' || changes.status === 'done', 'changes.status')
    q.updateOutput(db, id, changes as { title?: string; status?: 'active' | 'done' })
  })

  // profile and day status
  ipcMain.handle('profile:get', () => q.getProfile(db))
  ipcMain.handle('profile:set', (_e, changes: unknown) => {
    checkProfile(changes)
    return q.setProfile(db, changes)
  })
  ipcMain.handle('dayStatus:inPeriod', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return q.dayStatusInPeriod(db, period)
  })
  ipcMain.handle('dayStatus:set', (_e, date: unknown, type: unknown) => {
    check(isIsoDate(date), 'date')
    check(type === null || DAY_TYPES.includes(type as DayType), 'type') // null = clear the day
    q.setDayStatus(db, date, type as DayType | null)
    events.emit('day-status-saved', date)
  })

  // the DAR grid for one cutoff
  ipcMain.handle('grid:build', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return gridFor(db, period)
  })

  // Phase 2: add the cutoff's sheet to the workbook. `replace` = overwrite a sheet that
  // already has this name. Async: reading and writing the workbook takes a few seconds.
  ipcMain.handle('dar:export', async (_e, period: unknown, replace: unknown) => {
    check(isCutoff(period), 'period')
    check(typeof replace === 'boolean', 'replace')
    const grid = gridFor(db, period)
    const result = await exportDar(await exportTarget(db), grid, q.getProfile(db), {
      submitted: localDate(),
      replace
    })
    q.recordExport(db, period, grid.sheetName)
    lastResult = { ...result, period }
    return result
  })
  // Where exports go, for the button's label: "Add sheet to MABANO_DAR.xlsx".
  ipcMain.handle('dar:target', () => {
    const path = exportTargetPath(db)
    return { name: path ? basename(path) : 'your workbook', exists: path !== null && existsSync(path) }
  })
  ipcMain.handle('dar:lastExport', (_e, period: unknown) => {
    check(isCutoff(period), 'period')
    return q.lastExport(db, period)
  })
  // shell = Electron's way to open files with their usual app (Excel for .xlsx).
  // Main picks the file; the renderer can't name one.
  ipcMain.handle('dar:open', async () => {
    const path = lastResult?.path ?? exportTargetPath(db)
    if (!path) throw new Error('Choose your DAR workbook first (Settings, DAR profile).')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  // Undo the last export: put the .bak back. Only right after an export, this session.
  ipcMain.handle('dar:undo', async () => {
    if (!lastResult) throw new Error('Nothing to undo')
    await undoExport(lastResult)
    q.forgetLastExport(db, lastResult.period)
    lastResult = null
  })

  ipcMain.handle('schedule:next', () => nextCheckin())

  // settings (Phase 7 screen). saveSettings() checks every field (shared/settings.ts).
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, changes: unknown) => {
    check(isObject(changes), 'settings')
    // The renderer may reorder, remove, or change a repo's task, but never name a new
    // folder: new repos only come from the folder picker below.
    if ('repos' in changes && Array.isArray(changes.repos)) {
      const known = new Set(getSettings().repos.map((r) => r.path))
      check(changes.repos.every((r) => isObject(r) && known.has(r.path as string)), 'repos')
    }
    return saveSettings(changes as Partial<Settings>)
  })

  // ---- git: your commits as note suggestions (local repos only, no GitHub)

  // Settings, Git: pick a folder with Windows' own dialog. Any folder inside a repo is
  // fine; Pong keeps the repo's top folder.
  ipcMain.handle('git:addRepo', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'A git repo you work in', properties: ['openDirectory'] }
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return getSettings()
    const root = await repoRoot(picked.filePaths[0])
    if (!root) throw new Error(`${basename(picked.filePaths[0])} isn't a git repo (no .git folder in it or above it).`)
    const path = join(root) // git answers with forward slashes; join() gives the Windows form
    const repos = getSettings().repos
    if (repos.some((r) => r.path.toLowerCase() === path.toLowerCase())) return getSettings()
    return saveSettings({ repos: [...repos, { path, outputId: null }] })
  })
  ipcMain.handle('git:installed', () => gitInstalled())
  // Commits for one day: today since your last note, or a whole past day (missed days).
  ipcMain.handle('git:suggestions', async (_e, date: unknown) => {
    check(isIsoDate(date), 'date')
    const notes = q.entriesByDate(db, date)
    const { since, until } = commitWindow(date, localTimestamp(), notes)
    const lists = await Promise.all(getSettings().repos.map((repo) => commitsIn(repo, since, until)))
    return mergeSuggestions(lists, notes)
  })
  // First run and Settings: pick the DAR workbook with Windows' own Open dialog. Main
  // shows the dialog and keeps the path, so the renderer never handles file paths. The
  // newest sheet's duties, MFOs and header fill in whatever Pong doesn't have yet.
  ipcMain.handle('workbook:pick', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Your DAR workbook',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    }
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return null
    const path = picked.filePaths[0]
    const imported = await importFromWorkbook(db, path)
    changed()
    return { name: basename(path), ...imported }
  })

  // backups and the data folder (Settings > General)
  ipcMain.handle('backup:now', () => backupNow())
  ipcMain.handle('backup:info', () => ({ last: lastBackup() }))
  ipcMain.handle('data:openFolder', async () => {
    await shell.openPath(app.getPath('userData')) // pong.db, settings.json, backups, logs
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    dataFolder: app.getPath('userData')
  }))

  // dev only: replace everything with the sample DAR's data
  // `async` handler: main awaits the file read, then the renderer gets the counts.
  ipcMain.handle('dev:seed', async () => {
    // app.isPackaged is true in the installed app: seeding must never wipe real data there.
    if (app.isPackaged) throw new Error('Seeding is only available in development')
    // app.getAppPath() = the project folder during `npm run dev`.
    const path = join(app.getAppPath(), 'docs/reference/MABANO_DAR_sample.xlsx')
    return seedDatabase(db, await readDarSheet(path, 'October 3 - 17'))
  })
}
