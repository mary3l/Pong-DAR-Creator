// ipc.test.ts: the argument checks in main/ipc.ts for the handlers this change added
// (attendance:set, outputs:move). Electron is replaced by a stub that only records the
// ipcMain.handle() callbacks; windows/pong/scheduler are stubbed because they need a
// real Electron. No export handler is called, so no workbook is ever opened.
// A failing test here is an app bug, left failing on purpose; comments name the finding.
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getAppPath: () => '', getVersion: () => '0.0.0' },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) }
}))
vi.mock('./windows', () => ({
  currentCheckinRequest: vi.fn(), fitCheckin: vi.fn(), hideWindow: vi.fn(), openCheckin: vi.fn(),
  send: vi.fn(), setPongHover: vi.fn(), showWindow: vi.fn()
}))
vi.mock('./pong', () => ({ act: vi.fn(), missedDone: vi.fn(), pongState: vi.fn() }))
vi.mock('./scheduler', () => ({ askNow: vi.fn(), nextCheckin: vi.fn() }))

let db: DatabaseSync
let q: typeof import('./queries')
const call = (channel: string, ...args: unknown[]): unknown => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({ sender: null }, ...args)
}

beforeEach(async () => {
  vi.resetModules()
  h.handlers.clear()
  const { openDb } = await import('./db')
  q = await import('./queries')
  const { initAttendance } = await import('./attendance')
  const { registerIpc } = await import('./ipc')
  db = openDb(':memory:')
  initAttendance(db)
  registerIpc(db)
})

describe('outputs:move (finding 7)', () => {
  it('moves an MFO to another active duty', () => {
    const a = q.addDuty(db, 'core', 'A')
    const b = q.addDuty(db, 'support', 'B')
    const mfo = q.addOutput(db, a.id, 'Coverage')
    call('outputs:move', mfo.id, b.id)
    expect(q.listOutputs(db)[0]).toMatchObject({ id: mfo.id, dutyId: b.id })
  })

  it('refuses to move an MFO into an archived duty', () => {
    const a = q.addDuty(db, 'core', 'A')
    const old = q.addDuty(db, 'support', 'Old')
    q.updateDuty(db, old.id, { archived: true })
    const mfo = q.addOutput(db, a.id, 'Coverage')
    expect(() => call('outputs:move', mfo.id, old.id)).toThrow()
    expect(q.listOutputs(db)[0].dutyId).toBe(a.id)
  })

  // Either a refusal or a merge is fine; two rows with the same name under one duty is not
  // (addOutput already promises "the same title under the same duty is never added twice").
  it('never leaves two MFOs with the same title under one duty', () => {
    const a = q.addDuty(db, 'core', 'A')
    const b = q.addDuty(db, 'support', 'B')
    const moving = q.addOutput(db, a.id, 'Expanded Service Coverage')
    q.addOutput(db, b.id, 'expanded service coverage ')
    try {
      call('outputs:move', moving.id, b.id)
    } catch {
      // refusing is acceptable
    }
    const titles = q.listOutputs(db).filter((o) => o.dutyId === b.id).map((o) => o.title.trim().toLowerCase())
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('rejects bad ids', () => {
    expect(() => call('outputs:move', 0, 1)).toThrow()
    expect(() => call('outputs:move', 1, '2')).toThrow()
  })
})

describe('attendance:set', () => {
  const FRI = '2026-11-06'

  it('saves a fix from the Today view', () => {
    const saved = call('attendance:set', FRI, { timeIn: `${FRI}T07:52:00`, timeOut: '2026-11-07T00:30:00' })
    expect(saved).toMatchObject({ date: FRI, timeIn: `${FRI}T07:52:00`, timeOut: '2026-11-07T00:30:00' })
    expect(q.attendanceFor(db, FRI)?.timeOut).toBe('2026-11-07T00:30:00') // after midnight, same row
  })

  it('rejects a time-out before the time-in, and lunch back before lunch out', () => {
    call('attendance:set', FRI, { timeIn: `${FRI}T08:00:00` })
    expect(() => call('attendance:set', FRI, { timeOut: `${FRI}T07:00:00` })).toThrow()
    expect(() =>
      call('attendance:set', FRI, { lunchOut: `${FRI}T12:30:00`, lunchIn: `${FRI}T12:00:00` })
    ).toThrow()
    expect(q.attendanceFor(db, FRI)).toMatchObject({ timeOut: null, lunchOut: null })
  })

  it('rejects a session of 24 hours or more, and lunch outside the session', () => {
    call('attendance:set', FRI, { timeIn: `${FRI}T08:00:00` })
    expect(() => call('attendance:set', FRI, { timeOut: '2026-11-07T08:00:00' })).toThrow()
    expect(() => call('attendance:set', FRI, { lunchOut: `${FRI}T07:30:00` })).toThrow()
    call('attendance:set', FRI, { timeOut: `${FRI}T17:00:00` })
    expect(() => call('attendance:set', FRI, { lunchIn: `${FRI}T17:30:00` })).toThrow()
    expect(q.attendanceFor(db, FRI)).toMatchObject({ timeOut: `${FRI}T17:00:00`, lunchOut: null, lunchIn: null })
  })

  it('rejects a time-in on another day, bad stamps and unknown fields', () => {
    expect(() => call('attendance:set', FRI, { timeIn: '2026-11-07T08:00:00' })).toThrow()
    expect(() => call('attendance:set', FRI, { timeIn: `${FRI}T24:00:00` })).toThrow()
    expect(() => call('attendance:set', FRI, { timeIn: `${FRI} 08:00` })).toThrow()
    expect(() => call('attendance:set', FRI, { approved: 'maybe' })).toThrow()
    expect(() => call('attendance:set', FRI, { lastSeen: `${FRI}T08:00:00` })).toThrow()
    expect(() => call('attendance:set', '2026-02-30', {})).toThrow()
    expect(q.attendanceFor(db, FRI)).toBeNull()
  })
})
