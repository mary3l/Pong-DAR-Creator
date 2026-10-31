// workbook.ts: first run. Reads your DAR workbook's newest sheet and fills in your
// profile, duties and MFOs, so Pong starts with the same rows as your DAR.
// Runs in the MAIN process. Only READS the workbook; nothing is written to it here.
// Never imports electron, so Vitest tests it against the sample.
import ExcelJS from 'exceljs'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './db'
import { readDarSheet } from './seed'
import * as q from './queries'
import type { Profile } from '../shared/types'

// The newest (last) visible sheet: the one exports copy their look from.
export async function newestSheetName(path: string): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const sheets = workbook.worksheets.filter((s) => s.state === 'visible')
  const last = sheets[sheets.length - 1]
  if (!last) throw new Error('This workbook has no sheets')
  return last.name
}

// Adds the sheet's duties and MFOs that Pong doesn't have yet (matched by title), and
// fills profile fields that are still empty. Never deletes or overwrites anything, so
// running it twice is harmless. No notes are imported: your DAR history stays in Excel.
export async function importFromWorkbook(
  db: DatabaseSync,
  path: string
): Promise<{ sheetName: string; duties: number; outputs: number }> {
  const sheetName = await newestSheetName(path)
  const dar = await readDarSheet(path, sheetName)

  return transaction(db, () => {
    let duties = 0
    let outputs = 0
    for (const parsed of dar.duties) {
      let duty = q.listDuties(db).find((d) => d.category === parsed.category && d.title === parsed.title)
      if (!duty) {
        duty = q.addDuty(db, parsed.category, parsed.title)
        duties++
      }
      const existing = q.listOutputs(db).filter((o) => o.dutyId === duty.id)
      for (const output of parsed.outputs) {
        if (existing.some((o) => o.title === output.title)) continue
        q.addOutput(db, duty.id, output.title)
        outputs++
      }
    }

    // Only empty fields: what you've typed in Settings always wins.
    const profile = q.getProfile(db)
    const fill: Partial<Profile> = { workbookPath: path }
    for (const [key, value] of Object.entries(dar.profile) as [keyof Profile, string | null][]) {
      if (value && !profile[key]) fill[key] = value
    }
    q.setProfile(db, fill)
    return { sheetName, duties, outputs }
  })
}
