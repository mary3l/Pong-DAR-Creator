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
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import * as q from './queries'
import { readDarSheet, seedDatabase } from './seed'
import { hideWindow, showWindow } from './windows'
import { buildGrid } from '../shared/cutoff'
import { isIsoDate } from '../shared/dates'
import { isWindowLabel } from '../shared/windowLabel'
import type { Category, DayType, NewEntry, Period, Profile } from '../shared/types'

// The allowed values, as lists we can check against at runtime.
const PROGRESS = [0.25, 0.5, 0.75, 1]
const CATEGORIES: Category[] = ['core', 'support']
const DAY_TYPES: DayType[] = ['rest', 'sick', 'personal', 'holiday']
const SOURCES = ['checkin', 'hotkey', 'manual'] // not 'seed': only seed.ts may use that
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

// Checks every field of a NewEntry. Optional fields may be missing (undefined) or null.
function checkNewEntry(v: unknown): asserts v is NewEntry {
  check(isObject(v), 'entry')
  check(isText(v.text), 'entry.text')
  check(v.workDate === undefined || isIsoDate(v.workDate), 'entry.workDate')
  check(v.outputId === undefined || v.outputId === null || isId(v.outputId), 'entry.outputId')
  check(v.progress === undefined || v.progress === null || PROGRESS.includes(v.progress as number), 'entry.progress')
  check(v.source === undefined || SOURCES.includes(v.source as string), 'entry.source')
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

// Called once from index.ts, after the database is open.
// Each handler: (event, ...arguments). `_e` = the event; the _ says "not used here".
// Channel names follow '<area>:<verb>', and must match preload/index.ts exactly.
export function registerIpc(db: DatabaseSync): void {
  // windows
  ipcMain.handle('window:show', (_e, label: unknown) => {
    check(isWindowLabel(label), 'window label')
    showWindow(label)
  })
  ipcMain.handle('window:hide', (_e, label: unknown) => {
    check(isWindowLabel(label), 'window label')
    hideWindow(label)
  })

  // entries
  ipcMain.handle('entries:add', (_e, entry: unknown) => {
    checkNewEntry(entry) // after this line, TypeScript knows entry is a NewEntry
    return q.addEntry(db, entry)
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
  })

  // the DAR grid for one cutoff: four queries in, one pure function out
  ipcMain.handle('grid:build', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return buildGrid(
      period,
      q.entriesInPeriod(db, period),
      q.listDuties(db),
      q.listOutputs(db),
      q.dayStatusInPeriod(db, period)
    )
  })

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