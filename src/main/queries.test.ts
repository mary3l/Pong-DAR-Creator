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
    expect(user_version).toBe(1) // one migration in db.ts so far
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

describe('duties and MFOs', () => {
  it('adds, renames and archives', () => {
    const duty = q.addDuty(db, 'core', 'Frontend System Development')
    const mfo = q.addOutput(db, duty.id, 'GIS Location Map for PIPs')
    q.updateDuty(db, duty.id, { archived: true })
    q.updateOutput(db, mfo.id, { title: 'GIS Map', status: 'done' })
    expect(q.listDuties(db)[0]).toMatchObject({ title: 'Frontend System Development', archived: true, sort: 1 })
    expect(q.listOutputs(db)[0]).toMatchObject({ dutyId: duty.id, title: 'GIS Map', status: 'done' })
  })

  it('refuses an MFO under a duty that does not exist', () => {
    expect(() => q.addOutput(db, 999, 'Orphan')).toThrow() // foreign_keys = ON
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