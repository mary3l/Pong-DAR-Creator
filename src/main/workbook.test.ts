// workbook.test.ts: first run reads duties, MFOs and the profile from the sample.
// Skipped until docs/reference/MABANO_DAR_sample.xlsx exists. The sample is only read.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import * as q from './queries'
import { importFromWorkbook, newestSheetName } from './workbook'

const SAMPLE = 'docs/reference/MABANO_DAR_sample.xlsx'

describe.skipIf(!existsSync(SAMPLE))('importFromWorkbook', () => {
  it('finds the newest sheet', async () => {
    expect(await newestSheetName(SAMPLE)).toBe('October 3 - 17')
  }, 30_000)

  it('fills an empty Pong from the newest sheet, and is harmless the second time', async () => {
    const db = openDb(':memory:')
    q.setProfile(db, { name: 'Typed in Settings' })

    const first = await importFromWorkbook(db, SAMPLE)
    expect(first).toEqual({ sheetName: 'October 3 - 17', duties: 4, outputs: 10 })
    expect(q.listDuties(db).map((d) => d.category)).toEqual(['core', 'core', 'core', 'support'])
    const profile = q.getProfile(db)
    expect(profile.name).toBe('Typed in Settings') // never overwritten
    expect(profile.position).toBe('Information Systems Designer')
    expect(profile.workbookPath).toBe(SAMPLE)
    expect(q.entriesInPeriod(db, { start: '2026-10-03', end: '2026-10-17' })).toEqual([]) // no notes

    expect(await importFromWorkbook(db, SAMPLE)).toMatchObject({ duties: 0, outputs: 0 })
    expect(q.listOutputs(db)).toHaveLength(10)
  }, 30_000)
})
