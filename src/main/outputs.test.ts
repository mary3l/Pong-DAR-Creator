// outputs.test.ts: moving and merging MFOs (Tasks tab), checked through the DAR grid.
// Fixed fake entries in an in-memory database -> buildGrid: the exact cells, in order,
// for the right dates, with no duplicate rows.
// A failing test here is an app bug, left failing on purpose; comments name the finding.
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './db'
import * as q from './queries'
import { buildGrid } from '../shared/cutoff'
import type { Period, Progress } from '../shared/types'

const NOV_3: Period = { start: '2026-11-03', end: '2026-11-17' } // 15 days, Tue Nov 3 .. Tue Nov 17
let db: DatabaseSync

beforeEach(() => {
  db = openDb(':memory:')
})

const note = (outputId: number, date: string, progress: Progress, time = '09:00') =>
  q.addEntry(db, { text: `note ${date} ${time}`, outputId, progress, workDate: date, time, source: 'manual' })

const grid = (period: Period = NOV_3) =>
  buildGrid(period, q.entriesInPeriod(db, period), q.listDuties(db), q.listOutputs(db), q.dayStatusInPeriod(db, period))

// Every row title in the grid, in sheet order.
const rowTitles = (g: ReturnType<typeof grid>): string[] =>
  [...g.core, ...g.support].flatMap((d) => d.rows.map((r) => `${d.duty.title} / ${r.output.title}`))

describe('moving an MFO', () => {
  it('carries its notes to the new duty block, one row, same cells', () => {
    const a = q.addDuty(db, 'core', 'Duty A')
    const b = q.addDuty(db, 'support', 'Duty B')
    const mfo = q.addOutput(db, a.id, 'Coverage', new Date(2026, 10, 3))
    note(mfo.id, '2026-11-04', 0.25)
    note(mfo.id, '2026-11-04', 0.75, '15:00')
    note(mfo.id, '2026-11-05', 0.5)
    q.moveOutput(db, mfo.id, b.id)
    const g = grid()
    expect(rowTitles(g)).toEqual(['Duty B / Coverage'])
    const cells = g.support[0].rows[0].cells
    expect(cells[1]).toBe(0.75) // Nov 4 = day 2
    expect(cells[2]).toBe(0.5) // Nov 5 = day 3
    expect(cells.filter((c) => c !== null)).toHaveLength(2)
  })

  // Finding 7: moving under a duty that already has the same title makes two DAR rows
  // with the same name. A merge or a refusal is fine; a twin row is not.
  it('never gives the DAR two rows with the same name under one duty', () => {
    const a = q.addDuty(db, 'core', 'Duty A')
    const b = q.addDuty(db, 'support', 'Duty B')
    const moving = q.addOutput(db, a.id, 'Coverage', new Date(2026, 10, 3))
    const there = q.addOutput(db, b.id, 'Coverage', new Date(2026, 10, 3))
    note(moving.id, '2026-11-04', 0.5)
    note(there.id, '2026-11-05', 0.25)
    try {
      q.moveOutput(db, moving.id, b.id)
    } catch {
      // refusing is acceptable
    }
    const titles = rowTitles(grid())
    expect(new Set(titles).size).toBe(titles.length)
  })
})

describe('merging a duplicate MFO', () => {
  it('leaves one row holding the higher % per day, and no notes are lost', () => {
    const a = q.addDuty(db, 'core', 'Duty A')
    const b = q.addDuty(db, 'support', 'Duty B')
    const from = q.addOutput(db, a.id, 'Coverage', new Date(2026, 10, 3))
    const into = q.addOutput(db, b.id, 'Coverage', new Date(2026, 10, 3))
    note(from.id, '2026-11-04', 0.75)
    note(into.id, '2026-11-04', 0.25)
    note(from.id, '2026-11-06', 1)
    const before = q.entriesInPeriod(db, NOV_3).length
    q.mergeOutput(db, from.id, into.id)
    expect(q.entriesInPeriod(db, NOV_3)).toHaveLength(before)
    const g = grid()
    expect(rowTitles(g)).toEqual(['Duty B / Coverage'])
    expect(g.support[0].rows[0].cells[1]).toBe(0.75)
    expect(g.support[0].rows[0].cells[3]).toBe(1)
  })

  it('does nothing when merging an MFO into itself', () => {
    const a = q.addDuty(db, 'core', 'Duty A')
    const mfo = q.addOutput(db, a.id, 'Coverage')
    note(mfo.id, '2026-11-04', 0.5)
    q.mergeOutput(db, mfo.id, mfo.id)
    expect(q.listOutputs(db)).toHaveLength(1)
    expect(q.entriesInPeriod(db, NOV_3)).toHaveLength(1)
  })
})
