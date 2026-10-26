// seed.test.ts: Phase 1's "Done when", as a test.
// Rebuild the October 3 - 17 sheet from the database and compare.
// Skipped until docs/reference/MABANO_DAR_sample.xlsx exists.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { readDarSheet, seedDatabase } from './seed'
import * as q from './queries'
import { buildGrid, DAY_OFF_LABEL, periodFor } from '../shared/cutoff'

// Relative to the project root: Vitest runs from there.
const SAMPLE = 'docs/reference/MABANO_DAR_sample.xlsx'

// describe.skipIf(condition): the whole group shows as "skipped" instead of failing
// when your workbook copy isn't there yet.
describe.skipIf(!existsSync(SAMPLE))('seed from the sample DAR', () => {
  // `async` because readDarSheet has to wait for the file to load.
  it('reproduces every % and day off of "October 3 - 17"', async () => {
    // 1. Excel -> database
    const dar = await readDarSheet(SAMPLE, 'October 3 - 17')
    const db = openDb(':memory:')
    seedDatabase(db, dar)

    // 2. Database -> grid, the same way the app does it (ipc.ts 'grid:build')
    const period = periodFor(dar.days[0].date)
    const grid = buildGrid(
      period,
      q.entriesInPeriod(db, period),
      q.listDuties(db),
      q.listOutputs(db),
      q.dayStatusInPeriod(db, period)
    )

    // 3. Compare the grid with what the sheet says
    expect(grid.sheetName).toBe('October 3 - 17')
    expect(grid.days.map((d) => d.date)).toEqual(dar.days.map((d) => d.date))
    // Same day-off labels on the same days ('sick' on the sheet -> 'Sick Leave' in the grid).
    expect(grid.days.map((d) => d.off)).toEqual(
      dar.days.map((d) => (d.off ? DAY_OFF_LABEL[d.off] : null))
    )

    // Every MFO row, in order, as [title, cells]. flatMap = map, then flatten one level.
    const sheetRows = dar.duties.flatMap((d) => d.outputs.map((o) => [o.title, o.cells]))
    const gridRows = [...grid.core, ...grid.support].flatMap((b) => b.rows.map((r) => [r.output.title, r.cells]))
    expect(gridRows).toEqual(sheetRows)

    // The sheet's own L10 and Pong's count must both say 12.
    expect(dar.daysAttended).toBe(12)
    expect(grid.daysAttended).toBe(12)
  })
})