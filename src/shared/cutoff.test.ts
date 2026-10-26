// cutoff.test.ts: the rules of the DAR, written as checks.
// Each test name says the rule, so when one fails, its name tells you what broke.
import { describe, expect, it } from 'vitest'
import { buildGrid, daysIn, missedDays, periodFor, sheetName } from './cutoff'
import type { Duty, Entry, Output, Progress } from './types'

describe('periodFor', () => {
  // toEqual compares objects by their contents (toBe would need the same object).
  it('splits a month at the 17th/18th', () => {
    expect(periodFor('2026-10-17')).toEqual({ start: '2026-10-03', end: '2026-10-17' })
    expect(periodFor('2026-10-18')).toEqual({ start: '2026-10-18', end: '2026-11-02' })
  })

  it('splits at the 2nd/3rd', () => {
    expect(periodFor('2026-11-02')).toEqual({ start: '2026-10-18', end: '2026-11-02' })
    expect(periodFor('2026-11-03')).toEqual({ start: '2026-11-03', end: '2026-11-17' })
  })

  it('handles February', () => {
    expect(daysIn(periodFor('2027-02-20'))).toHaveLength(13) // Feb 18 - Mar 2, 2027
    expect(daysIn(periodFor('2028-02-20'))).toHaveLength(14) // leap year
  })

  it('crosses the new year', () => {
    // Jan 1 belongs to the Dec 18 - Jan 2 period: the one Phase 8 exports for real.
    const period = periodFor('2027-01-01')
    expect(period).toEqual({ start: '2026-12-18', end: '2027-01-02' })
    expect(daysIn(period)).toHaveLength(16)
  })
})

describe('sheetName', () => {
  it('matches the DAR sheet names', () => {
    expect(sheetName({ start: '2026-10-03', end: '2026-10-17' })).toBe('October 3 - 17')
    expect(sheetName({ start: '2026-10-18', end: '2026-11-02' })).toBe('October 18 - November 2')
    expect(sheetName({ start: '2026-12-18', end: '2027-01-02' })).toBe('December 18 - January 2')
  })
})

describe('missedDays', () => {
  it('lists past days with no notes and no day status', () => {
    // Monday Oct 12: Thu 8 logged, Fri 9 sick, so Sat 10 and Sun 11 are missed.
    // (So are Oct 3-7: nothing was logged then either.)
    const entries = [{ workDate: '2026-10-08' }]
    // `as const` keeps 'sick' as the exact type 'sick', not just any string.
    const status = [{ date: '2026-10-09', type: 'sick' as const }]
    expect(missedDays('2026-10-12', entries, status)).toEqual([
      '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
      '2026-10-10', '2026-10-11'
    ])
  })

  it('never includes today or days outside the period', () => {
    // Oct 3 is the first day of its period, so there's nothing before it to miss.
    expect(missedDays('2026-10-03', [], [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Small fixtures for buildGrid: helpers that build test data with sensible defaults.
// `extra: Partial<Duty> = {}` lets a test override just the fields it cares about,
// e.g. duty(2, 'support', { archived: true }). `...extra` spreads those overrides in last.
// ---------------------------------------------------------------------------
const duty = (id: number, category: Duty['category'], extra: Partial<Duty> = {}): Duty => ({
  id, category, title: `Duty ${id}`, sort: id, archived: false, ...extra
})
const output = (id: number, dutyId: number, extra: Partial<Output> = {}): Output => ({
  id, dutyId, title: `MFO ${id}`, short: null, status: 'active', createdAt: `2026-10-0${id}`, ...extra
})
let nextId = 1 // each fake entry gets a new id
const entry = (workDate: string, outputId: number | null, progress: Progress | null): Entry => ({
  id: nextId++, createdAt: `${workDate}T09:00:00`, workDate, text: 'note', outputId, progress, source: 'manual'
})

describe('buildGrid', () => {
  const period = { start: '2026-10-03', end: '2026-10-17' }
  const duties = [duty(1, 'core'), duty(2, 'support')]
  const outputs = [output(1, 1), output(2, 1), output(3, 2)] // MFOs 1 and 2 under duty 1, MFO 3 under duty 2

  it('keeps the highest % per MFO per day', () => {
    const grid = buildGrid(period, [entry('2026-10-05', 1, 0.25), entry('2026-10-05', 1, 0.75)], duties, outputs, [])
    const row = grid.core[0].rows[0]
    expect(row.cells[2]).toBe(0.75) // Oct 5 is day 3, which is index 2 (arrays count from 0)
    expect(row.cells[3]).toBeNull()
  })

  it('marks weekends as Rest Day unless there was work', () => {
    const grid = buildGrid(period, [entry('2026-10-03', 1, 0.5)], duties, outputs, [])
    // toMatchObject checks only the fields listed and ignores the rest.
    expect(grid.days[0]).toMatchObject({ date: '2026-10-03', dayName: 'SAT', off: null })
    expect(grid.days[1]).toMatchObject({ date: '2026-10-04', dayName: 'SUN', off: 'Rest Day' })
  })

  it('uses day_status for leave and leaves those cells blank', () => {
    const grid = buildGrid(
      period,
      [entry('2026-10-06', 1, 1)], // a note on a sick day...
      duties,
      outputs,
      [{ date: '2026-10-06', type: 'sick' }]
    )
    expect(grid.days[3].off).toBe('Sick Leave') // ...the day_status wins
    expect(grid.core[0].rows[0].cells[3]).toBeNull()
    expect(grid.daysAttended).toBe(0)
  })

  it('counts days attended', () => {
    const entries = [
      entry('2026-10-03', 1, 0.5), // worked Saturday
      entry('2026-10-05', null, null), // a note with no MFO still counts
      entry('2026-10-05', 1, 0.25),
      entry('2026-10-06', 3, 1)
    ]
    expect(buildGrid(period, entries, duties, outputs, []).daysAttended).toBe(3) // Oct 3, 5, 6
  })

  it('orders core then support, MFOs oldest first', () => {
    // Passed in the "wrong" order on purpose: buildGrid must sort them.
    const grid = buildGrid(period, [], duties, [output(2, 1), output(1, 1)], [])
    expect(grid.core.map((b) => b.duty.id)).toEqual([1])
    expect(grid.support.map((b) => b.duty.id)).toEqual([2])
    expect(grid.core[0].rows.map((r) => r.output.id)).toEqual([1, 2])
  })

  it('drops finished MFOs and archived duties with nothing in the period', () => {
    const grid = buildGrid(
      period,
      [entry('2026-10-07', 2, 1)], // only MFO 2 has a % this period
      [duty(1, 'core'), duty(2, 'support', { archived: true })],
      [output(1, 1, { status: 'done' }), output(2, 1, { status: 'done' }), output(3, 2)],
      []
    )
    expect(grid.core[0].rows.map((r) => r.output.id)).toEqual([2]) // done MFO 1 is gone; MFO 2 stays for its %
    expect(grid.support[0].rows.map((r) => r.output.id)).toEqual([3]) // active MFO keeps its archived duty
  })

  it('names the sheet', () => {
    expect(buildGrid(period, [], [], [], []).sheetName).toBe('October 3 - 17')
  })
})