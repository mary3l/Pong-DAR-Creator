// queries.test.ts: real SQL against a real (in-memory) SQLite database.
// This is why db.ts and queries.ts never import Electron: Vitest runs in plain Node.
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from './db'
// `import * as q` = every export of queries.ts under one name: q.addEntry, q.listDuties ...
import * as q from './queries'

let db: DatabaseSync

// beforeEach runs before every it(): each test starts with a fresh, empty database,
// so no test can leak data into another.
beforeEach(() => {
  db = openDb(':memory:') // a fresh, empty database for every test
})

describe('migrations', () => {
  it('creates the tables and sets user_version', () => {
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(user_version).toBe(2) // two migrations in db.ts so far
  })
})

describe('attendance', () => {
  const now = new Date(2026, 10, 6, 7, 52)
  it('creates a day on time-in and changes only what you pass', () => {
    q.setAttendance(db, '2026-11-06', { timeIn: '2026-11-06T07:52:00' }, now)
    q.setAttendance(db, '2026-11-06', { timeOut: '2026-11-06T17:00:00', approved: 'pending' }, now)
    expect(q.attendanceFor(db, '2026-11-06')).toEqual({
      date: '2026-11-06',
      timeIn: '2026-11-06T07:52:00',
      lunchOut: null,
      lunchIn: null,
      timeOut: '2026-11-06T17:00:00',
      lastSeen: null,
      nonWorkDay: false,
      approved: 'pending'
    })
    expect(q.attendanceFor(db, '2026-11-07')).toBeNull()
  })
  it('stores "Not working today" as a row with no time-in', () => {
    q.setAttendance(db, '2026-11-06', {}, now)
    expect(q.attendanceFor(db, '2026-11-06')?.timeIn).toBeNull()
  })
  it('finds an earlier day that was never timed out', () => {
    q.setAttendance(db, '2026-11-04', { timeIn: '2026-11-04T08:00:00', timeOut: '2026-11-04T17:00:00' }, now)
    q.setAttendance(db, '2026-11-05', { timeIn: '2026-11-05T08:00:00', nonWorkDay: true }, now)
    q.touchAttendance(db, '2026-11-05', '2026-11-05T17:42:00')
    const open = q.openSessionBefore(db, '2026-11-06')
    expect(open).toMatchObject({ date: '2026-11-05', lastSeen: '2026-11-05T17:42:00', nonWorkDay: true })
    expect(q.openSessionBefore(db, '2026-11-05')).toBeNull()
    expect(q.attendanceInPeriod(db, { start: '2026-11-03', end: '2026-11-17' }).map((a) => a.date)).toEqual([
      '2026-11-04',
      '2026-11-05'
    ])
  })
  it('refuses an unknown approval', () => {
    expect(() => q.setAttendance(db, '2026-11-06', { approved: 'maybe' as never }, now)).toThrow()
  })
})

describe('entries', () => {
  it('adds an entry with the local date', () => {
    // Passing a fixed `now` makes the test give the same result whenever it runs.
    const entry = q.addEntry(db, { text: 'Fixed the billing lookup' }, new Date(2026, 9, 26, 7, 30))
    expect(entry).toMatchObject({
      workDate: '2026-10-26',
      createdAt: '2026-10-26T07:30:00',
      text: 'Fixed the billing lookup',
      outputId: null, // left out -> null
      progress: null,
      source: 'checkin' // the default
    })
    expect(q.entriesByDate(db, '2026-10-26')).toHaveLength(1)
  })

  it('finds entries in a period', () => {
    q.addEntry(db, { text: 'a', workDate: '2026-10-17' }) // last day of the period
    q.addEntry(db, { text: 'b', workDate: '2026-10-18' }) // first day of the next one
    expect(q.entriesInPeriod(db, { start: '2026-10-03', end: '2026-10-17' }).map((e) => e.text)).toEqual(['a'])
  })

  it('rejects a progress the DAR cannot show', () => {
    // Raw SQL on purpose, to prove the table's CHECK rule itself blocks 0.3.
    // toThrow() passes when the function inside throws an error.
    expect(() => db.prepare(`INSERT INTO entries (created_at, work_date, text, progress) VALUES ('x', 'y', 'z', 0.3)`).run()).toThrow()
  })
})

describe('editing notes', () => {
  it('adds a note for an earlier time', () => {
    const entry = q.addEntry(db, { text: 'Standup', workDate: '2026-10-26', time: '08:15' })
    expect(entry.createdAt).toBe('2026-10-26T08:15:00')
  })

  it('edits text, task, % and time, and deletes', () => {
    const duty = q.addDuty(db, 'core', 'Frontend')
    const mfo = q.addOutput(db, duty.id, 'GIS map')
    const entry = q.addEntry(db, { text: 'typo', workDate: '2026-10-26', time: '09:00' })
    expect(q.updateEntry(db, entry.id, { text: 'Fixed', outputId: mfo.id, progress: 0.75, time: '09:30' })).toMatchObject({
      text: 'Fixed',
      outputId: mfo.id,
      progress: 0.75,
      createdAt: '2026-10-26T09:30:00',
      workDate: '2026-10-26'
    })
    // Untagging drops the % too: a plain note has no cell in the DAR.
    expect(q.updateEntry(db, entry.id, { outputId: null })).toMatchObject({ outputId: null, progress: null })
    q.deleteEntry(db, entry.id)
    expect(q.entriesByDate(db, '2026-10-26')).toEqual([])
    expect(q.updateEntry(db, 999, { text: 'x' })).toBeNull()
  })
})

describe('exports', () => {
  it('remembers the newest export of a cutoff', () => {
    const period = { start: '2026-10-18', end: '2026-11-02' }
    expect(q.lastExport(db, period)).toBeNull()
    q.recordExport(db, period, 'October 18 - November 2', new Date(2026, 10, 3, 9))
    q.recordExport(db, period, 'October 18 - November 2', new Date(2026, 10, 3, 10))
    expect(q.lastExport(db, period)).toEqual({ periodStart: '2026-10-18', periodEnd: '2026-11-02',
      sheetName: 'October 18 - November 2', exportedAt: '2026-11-03T10:00:00' })
    q.forgetLastExport(db, period) // Undo
    expect(q.lastExport(db, period)?.exportedAt).toBe('2026-11-03T09:00:00')
  })
})

describe('duties and MFOs', () => {
  it('adds, renames and archives', () => {
    const duty = q.addDuty(db, 'core', 'Frontend System Development')
    const mfo = q.addOutput(db, duty.id, 'GIS Location Map for PIPs')
    q.updateDuty(db, duty.id, { archived: true })
    q.updateOutput(db, mfo.id, { title: 'GIS Map', status: 'done' })
    expect(q.listDuties(db)[0]).toMatchObject({ title: 'Frontend System Development', archived: true, sort: 1 })
    expect(q.listOutputs(db)[0]).toMatchObject({ dutyId: duty.id, title: 'GIS Map', status: 'done' })
  })

  it('reopens the MFO already there instead of adding the same title twice', () => {
    const duty = q.addDuty(db, 'support', 'PIP Consolidation')
    const first = q.addOutput(db, duty.id, 'Expanded Service Coverage')
    q.updateOutput(db, first.id, { status: 'done' })
    const again = q.addOutput(db, duty.id, ' expanded service coverage ')
    expect(again).toMatchObject({ id: first.id, status: 'active' })
    expect(q.listOutputs(db)).toHaveLength(1)
    // The same title under another duty is a different DAR row: allowed.
    const other = q.addDuty(db, 'core', 'PIP Maintenance')
    expect(q.addOutput(db, other.id, 'Expanded Service Coverage').id).not.toBe(first.id)
  })

  it('moves an MFO and its notes to another duty', () => {
    const a = q.addDuty(db, 'core', 'A')
    const b = q.addDuty(db, 'support', 'B')
    const mfo = q.addOutput(db, a.id, 'Coverage')
    const note = q.addEntry(db, { text: 'x', outputId: mfo.id, progress: 0.5 })
    q.moveOutput(db, mfo.id, b.id)
    expect(q.listOutputs(db)[0]).toMatchObject({ id: mfo.id, dutyId: b.id })
    expect(q.lastTagged(db)).toMatchObject({ id: note.id, outputId: mfo.id })
  })

  it('merges a duplicate MFO: its notes move over and it is deleted', () => {
    const a = q.addDuty(db, 'core', 'A')
    const b = q.addDuty(db, 'support', 'B')
    const from = q.addOutput(db, a.id, 'Coverage')
    const into = q.addOutput(db, b.id, 'Coverage')
    q.updateOutput(db, into.id, { status: 'done' })
    q.addEntry(db, { text: 'x', outputId: from.id, progress: 0.25 })
    q.addEntry(db, { text: 'y', outputId: from.id, progress: 0.75 })
    q.mergeOutput(db, from.id, into.id)
    expect(q.listOutputs(db)).toEqual([expect.objectContaining({ id: into.id, status: 'active' })])
    const tagged = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE output_id = ?').get(into.id) as { n: number }
    expect(tagged.n).toBe(2)
  })

  it('refuses an MFO under a duty that does not exist', () => {
    expect(() => q.addOutput(db, 999, 'Orphan')).toThrow() // foreign_keys = ON
  })
})

describe('check-in card', () => {
  it('lists recently logged MFOs first, then the newest unused ones', () => {
    const duty = q.addDuty(db, 'core', 'Frontend')
    const a = q.addOutput(db, duty.id, 'A', new Date(2026, 9, 1))
    const b = q.addOutput(db, duty.id, 'B', new Date(2026, 9, 2))
    q.addOutput(db, duty.id, 'C', new Date(2026, 9, 3))
    const done = q.addOutput(db, duty.id, 'Done', new Date(2026, 9, 4))
    q.updateOutput(db, done.id, { status: 'done' }) // finished MFOs never show as chips
    q.addEntry(db, { text: 'x', outputId: a.id, progress: 0.25 }, new Date(2026, 9, 5, 9))
    q.addEntry(db, { text: 'y', outputId: b.id, progress: 0.5 }, new Date(2026, 9, 5, 10))
    expect(q.recentOutputs(db).map((o) => o.title)).toEqual(['B', 'A', 'C'])
    expect(q.recentOutputs(db, 1).map((o) => o.title)).toEqual(['B'])
    expect(q.lastTagged(db)).toMatchObject({ outputId: b.id, progress: 0.5 })
  })

  it('shows an MFO added after your last note as the first chip', () => {
    const duty = q.addDuty(db, 'core', 'Frontend')
    const a = q.addOutput(db, duty.id, 'A', new Date(2026, 9, 1))
    q.addEntry(db, { text: 'x', outputId: a.id, progress: 0.25 }, new Date(2026, 9, 5, 9))
    q.addOutput(db, duty.id, 'Just added', new Date(2026, 9, 5, 14))
    expect(q.recentOutputs(db).map((o) => o.title)).toEqual(['Just added', 'A'])
  })

  it('has no last tagged note on a fresh install', () => {
    q.addEntry(db, { text: 'a plain note' })
    expect(q.lastTagged(db)).toBeNull()
  })
})

describe('profile', () => {
  it('starts empty and merges changes', () => {
    expect(q.getProfile(db).name).toBeNull()
    q.setProfile(db, { name: 'Mariel G. Mabano' })
    q.setProfile(db, { unit: 'Planning Unit' }) // must not wipe the name
    expect(q.getProfile(db)).toMatchObject({ name: 'Mariel G. Mabano', unit: 'Planning Unit' })
  })
})

describe('day status', () => {
  it('sets, changes and clears a day', () => {
    q.setDayStatus(db, '2026-10-06', 'sick')
    q.setDayStatus(db, '2026-10-06', 'personal') // same date: updates, doesn't duplicate
    expect(q.dayStatusInPeriod(db, { start: '2026-10-03', end: '2026-10-17' })).toEqual([
      { date: '2026-10-06', type: 'personal' }
    ])
    q.setDayStatus(db, '2026-10-06', null) // null clears it
    expect(q.dayStatusInPeriod(db, { start: '2026-10-03', end: '2026-10-17' })).toEqual([])
  })
})