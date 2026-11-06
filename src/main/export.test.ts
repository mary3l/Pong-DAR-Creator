// export.test.ts: Phase 2's "Done when", as tests.
// Every test works on a fresh copy of the sample in a temp folder; the sample itself
// is only ever read. Skipped until docs/reference/MABANO_DAR_sample.xlsx exists.
// Slow-ish (10-20 s each): the sample has 30 sheets, and each export rewrites them all.
import ExcelJS from 'exceljs'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './db'
import { exportDar } from './export'
import * as q from './queries'
import { readDarSheet, seedDatabase } from './seed'
import { buildGrid } from '../shared/cutoff'
import type { Period } from '../shared/types'

const SAMPLE = 'docs/reference/MABANO_DAR_sample.xlsx'
const OCT_3 = { start: '2026-10-03', end: '2026-10-17' } // 15 days: H to V
const OCT_18 = { start: '2026-10-18', end: '2026-11-02' } // 16 days: H to W

// Cells where the sample has old leftovers that Pong clears on purpose:
// a white-on-white "Rest Day" on Oct 3, which was a work day.
const LEFTOVERS = ['H20', 'H21']

// What a cell shows, with runs of spaces squeezed to one ("Period Covered:  October" in
// the sample has two). ExcelJS crashes reading .text from a cell merged into an empty
// one, hence the check on master.value first.
const shown = (cell: ExcelJS.Cell): string =>
  cell.master.value == null ? '' : cell.text.replace(/\s+/g, ' ').trim()

async function openSheet(path: string, name: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const ws = workbook.getWorksheet(name)
  if (!ws) throw new Error(`No sheet "${name}" in ${path}`)
  return ws
}

describe.skipIf(!existsSync(SAMPLE))('exportDar', () => {
  let dir: string
  let copy: string

  // Before each test: a fresh temp folder with a copy of the sample in it.
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pong-export-'))
    copy = join(dir, 'dar.xlsx')
    await copyFile(SAMPLE, copy)
  })
  // After each: delete the folder, so temp doesn't fill up with workbooks.
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // The database Phase 1 builds from the sample, and the grid for one period.
  async function seeded() {
    const db = openDb(':memory:')
    seedDatabase(db, await readDarSheet(SAMPLE, 'October 3 - 17'))
    const gridFor = (period: Period) =>
      buildGrid(period, q.entriesInPeriod(db, period), q.listDuties(db), q.listOutputs(db), q.dayStatusInPeriod(db, period))
    return { db, gridFor }
  }

  it('regenerates "October 3 - 17" cell for cell', async () => {
    const { db, gridFor } = await seeded()
    // replace: the copy already has this sheet. Same submitted date as the sample's L9.
    const result = await exportDar(copy, gridFor(OCT_3), q.getProfile(db), { submitted: '2026-10-22', replace: true })

    // The safe-save steps left a backup and no temp file.
    expect(existsSync(result.backupPath)).toBe(true)
    expect(existsSync(join(dir, 'dar.pong-tmp.xlsx'))).toBe(false)

    // 1. Same data, read back the way Phase 1 reads a DAR.
    expect(await readDarSheet(copy, 'October 3 - 17')).toEqual(await readDarSheet(SAMPLE, 'October 3 - 17'))

    // 2. Every cell in the print area (A1:V38) shows the same text.
    const original = await openSheet(SAMPLE, 'October 3 - 17')
    const generated = await openSheet(copy, 'October 3 - 17')
    expect(generated.pageSetup.printArea).toBe('A1:V38')
    for (let row = 1; row <= 38; row++) {
      for (let col = 1; col <= 22; col++) {
        const cell = original.getCell(row, col)
        if (LEFTOVERS.includes(cell.address)) continue
        // The second argument names the cell in the failure message.
        expect(shown(generated.getCell(row, col)), cell.address).toBe(shown(cell))
      }
    }

    // 3. Every merged box of the original's print area is there too. (Pong adds a few the
    //    hand-made sheet forgot, like Q25:Q26, so this checks one direction only.)
    const merged = new Set(generated.model.merges)
    const inPrintArea = original.model.merges.filter((range) => Number(original.getCell(range.split(':')[1]).row) <= 38)
    for (const range of inPrintArea) expect(merged.has(range), range).toBe(true)
  }, 60_000)

  it('writes a 16-day period out to column W', async () => {
    const { db, gridFor } = await seeded()
    q.addEntry(db, { text: 'Fixed the export', workDate: '2026-10-19', outputId: 1, progress: 0.5 })
    await exportDar(copy, gridFor(OCT_18), q.getProfile(db), { submitted: '2026-11-03' })

    const ws = await openSheet(copy, 'October 18 - November 2')
    expect(ws.workbook.worksheets.at(-1)?.name).toBe('October 18 - November 2') // added last
    expect(ws.pageSetup.printArea).toBe('A1:W38')
    // Header merges stretch to W, and W has the 16th day.
    for (const range of ['A2:W2', 'A5:W5', 'H14:W14', 'A18:W19', 'A32:W32']) {
      expect(ws.model.merges, range).toContain(range)
    }
    expect(ws.getCell('W15').value).toBe(16)
    expect(ws.getCell('W16').value).toEqual(new Date(Date.UTC(2026, 10, 2))) // Nov 2 (month 10 = November)
    expect(ws.getCell('W17').value).toBe('MON')
    // W's header colour is the template's theme colour, copied from V, not hard-coded.
    expect(ws.getCell('W16').fill).toEqual(ws.getCell('V16').fill)
    // Sunday Oct 18 is a rest day: one grey box down the whole core block (rows 20-31).
    expect(ws.model.merges).toContain('H20:H31')
    expect(ws.getCell('H20').value).toBe('Rest Day')
    // Monday Oct 19: 50% on the first MFO, whose box also covers the "Codes for" row.
    expect(ws.getCell('I20').value).toBe(0.5)
    expect(ws.getCell('L10').value).toBe('Actual No. of Days Attended: 1')
    expect(ws.getCell('L9').value).toBe('Date Submitted: November 3, 2026')
  }, 60_000)

  it('can leave out the "Codes for the following:" rows', async () => {
    const { db, gridFor } = await seeded()
    await exportDar(copy, gridFor(OCT_3), q.getProfile(db), { submitted: '2026-10-22', replace: true, codesRow: false })

    const ws = await openSheet(copy, 'October 3 - 17')
    const texts: string[] = []
    ws.eachRow((row) => row.eachCell((cell) => texts.push(String(cell.value))))
    expect(texts.filter((t) => /codes for the following/i.test(t))).toEqual([])
    // The first core MFO moves up into row 20, and the duties and % read back the same.
    expect(ws.getCell('E20').value).toBe(gridFor(OCT_3).core[0].rows[0].output.title)
    expect(await readDarSheet(copy, 'October 3 - 17')).toEqual(await readDarSheet(SAMPLE, 'October 3 - 17'))
  }, 60_000)

  it('refuses to overwrite a sheet unless asked', async () => {
    const { db, gridFor } = await seeded()
    // rejects.toThrow: the Promise must fail, with a message matching the pattern.
    await expect(
      exportDar(copy, gridFor(OCT_3), q.getProfile(db), { submitted: '2026-10-22' })
    ).rejects.toThrow(/already has a sheet named "October 3 - 17"/)
    // Nothing was written: no backup, the workbook still has its 30 sheets.
    expect(existsSync(join(dir, 'dar.bak.xlsx'))).toBe(false)
    expect((await openSheet(copy, 'October 3 - 17')).workbook.worksheets).toHaveLength(30)
  }, 60_000)

  it('says clearly when the workbook is missing', async () => {
    const { db, gridFor } = await seeded()
    await expect(
      exportDar(join(dir, 'nope.xlsx'), gridFor(OCT_3), q.getProfile(db), { submitted: '2026-10-22' })
    ).rejects.toThrow(/Can't find the workbook/)
  })
})
