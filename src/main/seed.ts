// seed.ts: dev only. Fills the database from a hand-made DAR sheet, so Pong starts
// with real data and Phase 1 can prove buildGrid rebuilds that sheet exactly.
// Runs in the MAIN process (ExcelJS needs Node's file access).
// Layout: see "DAR sheet format" in CLAUDE.md.
//
// Two halves:
//   readDarSheet()  Excel -> a plain object (ParsedDar). Reads only, writes nothing.
//   seedDatabase()  ParsedDar -> rows in SQLite.
// Keeping them apart means each can be tested and debugged on its own.
import ExcelJS from 'exceljs'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './db'
import { isWeekend, toIso } from '../shared/dates'
import type { Category, DayType, Profile, Progress } from '../shared/types'

// Where things are on the sheet. ExcelJS numbers rows and columns from 1: A = 1, H = 8.
const FIRST_DAY_COL = 8 // H
const DATE_ROW = 16
const FIRST_GRID_ROW = 18

// Day-off text on the sheet (lowercased) -> the day_status type.
const OFF_TYPES: Record<string, DayType> = {
  'rest day': 'rest',
  'sick leave': 'sick',
  'personal leave': 'personal',
  holiday: 'holiday'
}

// Everything readDarSheet finds, before any of it touches the database.
export interface ParsedDar {
  sheetName: string
  profile: Partial<Profile>
  days: { date: string; off: DayType | null }[]
  duties: {
    category: Category
    title: string
    outputs: { title: string; cells: (Progress | null)[] }[]
  }[]
  daysAttended: number | null // what the sheet says, to check against
}

// async + await: reading a file takes time, so readFile returns a Promise.
// `await` pauses this function (not the app) until the file is loaded.
export async function readDarSheet(path: string, sheetName: string): Promise<ParsedDar> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const ws = workbook.getWorksheet(sheetName)
  if (!ws) throw new Error(`No sheet named "${sheetName}" in ${path}`)

  // A cell's text as Excel shows it, without surrounding spaces. '' for an empty cell.
  const text = (row: number, col: number): string => ws.getCell(row, col).text.trim()

  // Row 16: one date per day column, starting at H. Stop at the first cell that isn't a date.
  // `for (...; ; ...)` with no condition loops until `break`.
  const dates: string[] = []
  for (let col = FIRST_DAY_COL; ; col++) {
    const date = toDate(ws.getCell(DATE_ROW, col).value)
    if (!date) break
    dates.push(date)
  }
  if (dates.length === 0) throw new Error(`Row ${DATE_ROW} has no dates from column H`)

  // Find the footer ("Prepared by:" in column A). The grid ends just above it.
  let footerRow = FIRST_GRID_ROW
  while (footerRow <= ws.rowCount && !/^prepared by/i.test(text(footerRow, 1))) footerRow++

  const duties: ParsedDar['duties'] = []
  // Per day column: any text seen (for day-off labels), and whether any % was seen.
  const offText: string[][] = dates.map(() => [])
  const hasPercent: boolean[] = dates.map(() => false)
  let category: Category = 'core'
  let dutyKey = ''

  // Walk the grid one row at a time, top to bottom.
  for (let row = FIRST_GRID_ROW; row < footerRow; row++) {
    // Section rows switch between Core and Support. `continue` skips to the next row.
    const a = text(row, 1)
    if (/^A\.\)/.test(a)) { category = 'core'; continue }
    if (/^B\.\)/.test(a)) { category = 'support'; continue }

    // The duty title is merged down its block (B:D); a new merge master means a new duty.
    // In a merged range every cell reports the same value, and .master is the top-left
    // cell. Its address ('B19') is the same for every row in one block, so a new address
    // means a new duty, even if two duties happened to have the same title.
    const dutyCell = ws.getCell(row, 2)
    const dutyTitle = dutyCell.text.trim()
    if (dutyTitle && dutyCell.master.address !== dutyKey) {
      dutyKey = dutyCell.master.address
      duties.push({ category, title: dutyTitle, outputs: [] })
    }

    // Column E holds the MFO. Skip empty rows and the "Codes for the following:" label.
    const mfo = text(row, 5)
    const duty = duties[duties.length - 1] // the duty this row belongs to
    if (!duty || !mfo || /^codes for the following/i.test(mfo)) continue

    // One cell per day: a number is a %, text might be "Rest Day" etc.
    const cells = dates.map((_, i) => {
      const value = ws.getCell(row, FIRST_DAY_COL + i).value
      if (typeof value === 'number' && value > 0) {
        hasPercent[i] = true
        return toProgress(value)
      }
      if (typeof value === 'string' && value.trim()) offText[i].push(value.trim().toLowerCase())
      return null
    })
    duty.outputs.push({ title: mfo, cells })
  }

  // A day is off when its column has no % at all and carries "Rest Day", "Sick Leave" ...
  // (This skips leftovers like a stray "Rest Day" on a day that has work.)
  const days = dates.map((date, i) => {
    const label = offText[i].find((t) => t in OFF_TYPES) // `in` = "is this a key of OFF_TYPES?"
    return { date, off: !hasPercent[i] && label ? OFF_TYPES[label] : null }
  })

  // Signatories sit two rows under "Prepared by:", their titles one row lower.
  const prepared = footerRow <= ws.rowCount ? footerRow : null
  // L10 reads "Actual No. of Days Attended: 12". (\d+) captures the number.
  const attended = /(\d+)/.exec(text(10, 12))

  return {
    sheetName,
    profile: {
      // `|| null` turns an empty string into null, so blank cells stay "not set".
      name: text(8, 5) || null, // E8
      position: text(9, 5) || null, // E9
      department: text(10, 5) || null, // E10
      unit: text(11, 5) || null, // E11
      teamLeader: text(12, 5) || null, // E12
      confirmedBy: prepared ? text(prepared + 2, 10) || null : null, // column J
      confirmedTitle: prepared ? text(prepared + 3, 10) || null : null,
      notedBy: prepared ? text(prepared + 2, 15) || null : null, // column O
      notedTitle: prepared ? text(prepared + 3, 15) || null : null
    },
    days,
    duties,
    daysAttended: attended ? Number(attended[1]) : null
  }
}

// Replaces everything in the database with the sheet's data. Dev only.
// Wrapped in transaction(): if any insert fails, the database is left exactly as it was.
export function seedDatabase(db: DatabaseSync, dar: ParsedDar): { duties: number; outputs: number; entries: number } {
  return transaction(db, () => {
    // Children before parents: entries point at outputs, outputs at duties.
    // Deleting a duty first would break the foreign keys.
    db.exec('DELETE FROM entries; DELETE FROM outputs; DELETE FROM duties; DELETE FROM day_status; DELETE FROM profile;')

    const p = dar.profile
    db.prepare(
      `INSERT INTO profile (id, name, position, department, unit, team_leader,
         confirmed_by, confirmed_title, noted_by, noted_title) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      p.name ?? null, p.position ?? null, p.department ?? null, p.unit ?? null, p.teamLeader ?? null,
      p.confirmedBy ?? null, p.confirmedTitle ?? null, p.notedBy ?? null, p.notedTitle ?? null
    )

    // Prepare each INSERT once and .run() it many times: faster than preparing per row.
    const createdAt = `${dar.days[0].date}T08:00:00` // same for all, so id keeps the sheet order
    const addDuty = db.prepare(`INSERT INTO duties (category, title, sort) VALUES (?, ?, ?)`)
    const addOutput = db.prepare(`INSERT INTO outputs (duty_id, title, created_at) VALUES (?, ?, ?)`)
    const addEntry = db.prepare(
      `INSERT INTO entries (created_at, work_date, text, output_id, progress, source) VALUES (?, ?, ?, ?, ?, 'seed')`
    )
    let outputs = 0
    let entries = 0

    dar.duties.forEach((duty, i) => {
      const dutyId = addDuty.run(duty.category, duty.title, i + 1).lastInsertRowid
      for (const output of duty.outputs) {
        const outputId = addOutput.run(dutyId, output.title, createdAt).lastInsertRowid
        outputs++
        // One entry per filled % cell: that's all buildGrid needs to rebuild the cell.
        output.cells.forEach((progress, d) => {
          if (progress === null) return // `return` inside forEach = skip to the next cell
          const date = dar.days[d].date
          addEntry.run(`${date}T17:00:00`, date, `From DAR: ${output.title}`, outputId, progress)
          entries++
        })
      }
    })

    // A weekend with no notes is already a rest day; only store what buildGrid can't infer.
    const setStatus = db.prepare(`INSERT INTO day_status (date, type) VALUES (?, ?)`)
    for (const day of dar.days) {
      if (day.off && !(day.off === 'rest' && isWeekend(day.date))) setStatus.run(day.date, day.off)
    }

    return { duties: dar.duties.length, outputs, entries } // shown in the DB check panel
  })
}

// Excel stores dates as serial numbers; ExcelJS usually hands back a Date at UTC midnight.
// Handles the three shapes a date cell can come back as:
//   a Date, a raw serial number (days since 1900), or a formula with a cached result.
function toDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return toIso(value)
  // 25569 = days from Excel's 1900 epoch to 1970. 86400000 = milliseconds in a day.
  if (typeof value === 'number' && value > 40000) return toIso(new Date(Math.round((value - 25569) * 86400000)))
  if (value && typeof value === 'object' && 'result' in value) return toDate(value.result as ExcelJS.CellValue)
  return null
}

// The DAR only shows 25/50/75/100%. Snap anything else to the nearest quarter.
// e.g. 0.3 -> 0.25, 0.6 -> 0.5. Math.min/max keep it between 25% and 100%.
function toProgress(value: number): Progress {
  return Math.min(1, Math.max(0.25, Math.round(value * 4) / 4)) as Progress
}