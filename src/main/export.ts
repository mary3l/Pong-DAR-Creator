// export.ts: writes one cutoff's DAR sheet into the workbook.
// Runs in the MAIN process: ExcelJS reads and writes files, which only Node can do.
// Like db.ts and seed.ts it never imports electron, so Vitest can test it directly.
// Layout: see "DAR sheet format" and "Export rules" in CLAUDE.md.
//
// The steps, in order (each is one function below):
//   checkNotLocked()  is the workbook open in Excel? Stop before doing any work.
//   copySheet()       ExcelJS has no "duplicate sheet", so copy the newest sheet by hand
//   takeFooter()      remember the signature block, so it can move under the new grid
//   clearGrid()       wipe row 20 down: values, styles, merges (old leftovers too)
//   writeHeader()     widen the merges to the last day column, fill rows 8-17
//   writeGrid()       duties, MFOs, % cells and day-off merges
//   writeFooter()     put the signature block back, under the grid
//   saveSafely()      temp file -> re-open check -> .bak -> replace
import ExcelJS from 'exceljs'
import { copyFile, open, rename, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { readDarSheet } from './seed'
import { longDate, type DarGrid, type GridDuty } from '../shared/cutoff'
import { fromIso } from '../shared/dates'
import type { ExportResult, Profile } from '../shared/types'

// Where things are on the sheet. ExcelJS numbers rows and columns from 1: A = 1, H = 8.
const FIRST_DAY_COL = 8 // H
const TITLE_ROWS = [2, 3, 4, 5] // "Republic of the Philippines" ... merged A:last day column
const PERCENT_ROW = 14 // "DAYS/PERCENTAGE COMPLETION", merged H:last day column
const INDEX_ROW = 15 // 1, 2, 3 ...
const DATE_ROW = 16 // 3-Oct, 4-Oct ...
const DAY_NAME_ROW = 17 // SAT, SUN ...
const SECTION_A_ROW = 18 // "A.) SPECIFIC DUTIES AND RESPONSIBILITIES", merged over rows 18-19
const FIRST_GRID_ROW = 20 // everything from here down is rewritten

// The grid's styles. The header (rows 1-19) keeps the template's own styles, theme fills
// included; only these cells, which Pong fills in, get a style written from code.
// Partial<ExcelJS.Style> = a style object where every part (font, border ...) is optional.
const THIN: Partial<ExcelJS.Border> = { style: 'thin' }
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const TEXT: Partial<ExcelJS.Style> = {
  font: { name: 'Calibri', size: 10 },
  border: BORDER,
  alignment: { vertical: 'middle', wrapText: true }
}
const DAY: Partial<ExcelJS.Style> = {
  font: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }, // white bold 10 pt
  border: BORDER,
  numFmt: '0%', // 0.75 shows as 75%
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
}
// solid('FF8497B0') = a plain fill in that colour. ARGB: FF = fully opaque, then RGB.
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

// `...TEXT` copies every part of TEXT, then the lines after it add or override parts.
const STYLE = {
  number: { ...TEXT, numFmt: '0.', alignment: { horizontal: 'center', vertical: 'middle' } }, // 1 shows as "1."
  duty: TEXT,
  codes: TEXT,
  mfo: { ...TEXT, alignment: { vertical: 'middle', wrapText: true, indent: 1 } }, // indented under "Codes for"
  emptyDay: DAY, // a work day with no % for this MFO
  percent: { ...DAY, fill: solid('FF8497B0') },
  dayOff: { ...DAY, fill: solid('FF808080') }
} satisfies Record<string, Partial<ExcelJS.Style>> // `satisfies`: check the shape, keep the exact keys

// ExcelJS can't auto-fit row heights the way Excel does, so estimate them: about 50
// characters fit on one line of the MFO box (E:G), about 24 in the duty box (B:D),
// and each line of 10 pt text is 13.5 points tall.
const LINE_HEIGHT = 13.5
const MIN_HEIGHT = 15 // Excel's default row height
const SECTION_B_HEIGHT = 22.5 // as in the sample
const lineCount = (text: string, perLine: number): number => Math.max(1, Math.ceil(text.length / perLine))

// A rectangle of cells, in row/column numbers.
interface Box {
  top: number
  left: number
  bottom: number
  right: number
}

// What takeFooter() remembers about one row of the signature block.
interface FooterRow {
  height: number | undefined
  cells: { value: ExcelJS.CellValue; style: Partial<ExcelJS.Style> }[]
}

// Adds the sheet for `grid` to the workbook at `path`.
// grid comes from buildGrid() and profile from getProfile(): ipc.ts reads the database,
// this file only writes Excel. `submitted` is the 'YYYY-MM-DD' for "Date Submitted".
// `replace: true` swaps out a sheet with the same name (export again after fixing notes).
// `codesRow: false` leaves out the "Codes for the following:" rows (Settings, default on).
export async function exportDar(
  path: string,
  grid: DarGrid,
  profile: Profile,
  options: { submitted: string; replace?: boolean; codesRow?: boolean }
): Promise<ExportResult> {
  await checkNotLocked(path)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)

  // The template is the newest (last) visible sheet: it has this year's look and duties.
  const sheets = workbook.worksheets.filter((s) => s.state === 'visible')
  const template = sheets[sheets.length - 1]
  if (!template) throw new Error(`${basename(path)} has no sheets to copy`)

  const existing = workbook.getWorksheet(grid.sheetName)
  if (existing && !options.replace) {
    throw new Error(`${basename(path)} already has a sheet named "${grid.sheetName}"`)
  }

  const templateLastCol = lastDayColumn(template)
  // Copy first, then remove the old sheet: when you export the same cutoff again,
  // the old sheet IS the template.
  const model = structuredClone(template.model)
  if (existing) workbook.removeWorksheet(existing.id)
  const ws = copySheet(workbook, model, grid.sheetName)

  const lastCol = FIRST_DAY_COL + grid.days.length - 1 // V for 15 days, W for 16
  const footer = takeFooter(ws, templateLastCol)
  clearGrid(ws)
  writeHeader(ws, grid, profile, options.submitted, templateLastCol, lastCol)
  const footerTop = writeGrid(ws, grid, lastCol, options.codesRow ?? true)
  const lastRow = writeFooter(ws, footer, footerTop, profile)

  // Print area: A1 to the last day column and the last footer row, e.g. "A1:W38".
  ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${lastRow}`
  // Open the workbook on the new sheet next time.
  if (workbook.views[0]) workbook.views[0].activeTab = workbook.worksheets.indexOf(ws)

  return saveSafely(workbook, path, grid)
}

// ---------------------------------------------------------------------------
// 1. Locked?
// ---------------------------------------------------------------------------

// Excel keeps the workbook open for writing while you have it open, so Windows refuses
// anyone else: opening it fails with EBUSY or EPERM. Try it now, before any work.
// 'r+' = open for reading AND writing, without emptying the file.
async function checkNotLocked(path: string): Promise<void> {
  try {
    const file = await open(path, 'r+')
    await file.close()
  } catch (error) {
    throw friendly(error, path)
  }
}

// Turns Windows' lock errors into a message you can act on. Other errors pass through.
// `error` is `unknown` in a catch: anything can be thrown. NodeJS.ErrnoException is the
// shape of Node's file errors, which carry a `code` like 'EBUSY' or 'ENOENT'.
function friendly(error: unknown, path: string): unknown {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EBUSY' || code === 'EPERM') {
    return new Error(`${basename(path)} is open in Excel. Close it there, then export again.`)
  }
  if (code === 'ENOENT') return new Error(`Can't find the workbook: ${path}`)
  return error
}

// ---------------------------------------------------------------------------
// 2. Copy the template
// ---------------------------------------------------------------------------

// worksheet.model is the whole sheet as plain data: cells, styles, merges, column
// widths, row heights, page setup, print area. Setting it on a new sheet rebuilds
// all of that. structuredClone (in exportDar) made it a deep copy, so changing the new
// sheet can never change the template.
function copySheet(workbook: ExcelJS.Workbook, model: ExcelJS.WorksheetModel, name: string): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(name) // added last, so next time it's the template
  // ExcelJS quirk: reading .model gives the merges as `merges`, but setting .model
  // reads them from `mergeCells`. Without this line the copy has no merged cells.
  ws.model = { ...model, name, mergeCells: model.merges } as ExcelJS.WorksheetModel
  return ws
}

// The template's last day column: walk row 16 from H while there's a date.
function lastDayColumn(ws: ExcelJS.Worksheet): number {
  let col = FIRST_DAY_COL
  while (ws.getCell(DATE_ROW, col + 1).text) col++
  if (!ws.getCell(DATE_ROW, FIRST_DAY_COL).text) {
    throw new Error(`"${ws.name}" doesn't look like a DAR sheet: row ${DATE_ROW} has no dates from column H`)
  }
  return col
}

// Every merged range on the sheet, as numbers. ws.model.merges gives strings like 'A2:V2';
// getCell('A2') turns each corner into its row and column. (ExcelJS's types call
// those strings, but they're numbers at runtime; Number() keeps TypeScript happy.)
function merges(ws: ExcelJS.Worksheet): Box[] {
  return ws.model.merges.map((range) => {
    const [from, to] = range.split(':').map((address) => ws.getCell(address))
    return { top: Number(from.row), left: Number(from.col), bottom: Number(to.row), right: Number(to.col) }
  })
}

// Merges a box, skipping single cells: a 1x1 "merge" is one of the things that makes
// Excel say the file needs repair.
function merge(ws: ExcelJS.Worksheet, top: number, left: number, bottom: number, right: number): void {
  if (bottom > top || right > left) ws.mergeCells(top, left, bottom, right)
}

// Unmerges whatever starts at (row, col), then merges it again with a new size.
// Used for the header rows that stretch to the last day column.
function remerge(ws: ExcelJS.Worksheet, top: number, left: number, bottom: number, right: number): void {
  ws.unMergeCells(top, left, top, left)
  merge(ws, top, left, bottom, right)
}

// ---------------------------------------------------------------------------
// 3. Footer and clearing
// ---------------------------------------------------------------------------

// The signature block runs from "Prepared by:" down to the end of the print area.
// Remember its values, styles, heights and merges, so writeFooter() can put it back
// lower or higher, wherever the new grid ends.
function takeFooter(ws: ExcelJS.Worksheet, lastCol: number): { rows: FooterRow[]; merges: Box[] } {
  let top = FIRST_GRID_ROW
  while (top <= ws.rowCount && !/^prepared by/i.test(ws.getCell(top, 1).text.trim())) top++
  if (top > ws.rowCount) throw new Error(`"${ws.name}" has no "Prepared by:" row to copy`)

  // printArea is like 'A1:V38': its last number is the bottom row. No print area: 5 rows.
  const match = /(\d+)$/.exec((ws.pageSetup.printArea ?? '').split(',')[0].replace(/\$/g, ''))
  const bottom = match && Number(match[1]) > top ? Number(match[1]) : top + 4

  const rows: FooterRow[] = []
  for (let r = top; r <= bottom; r++) {
    const cells: FooterRow['cells'] = []
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c)
      // In a merged range every cell reports the master's value; keep it only on the master.
      const value = cell.master.address === cell.address ? cell.value : null
      cells.push({ value, style: structuredClone(cell.style) })
    }
    rows.push({ height: ws.getRow(r).height, cells })
  }
  // Merges inside the block, stored relative to its first row (0 = the "Prepared by:" row).
  const inside = merges(ws)
    .filter((m) => m.top >= top && m.bottom <= bottom)
    .map((m) => ({ ...m, top: m.top - top, bottom: m.bottom - top }))
  return { rows, merges: inside }
}

// Wipes everything from row 20 down: merges first (a merged cell can't be cleared
// on its own), then every value and style. This also removes the template's
// leftovers, like the white-on-white "Rest Day" in H20.
function clearGrid(ws: ExcelJS.Worksheet): void {
  for (const m of merges(ws)) {
    if (m.top >= FIRST_GRID_ROW) ws.unMergeCells(m.top, m.left, m.bottom, m.right)
  }
  // includeEmpty: visit blank cells too, since they can still carry borders and fills.
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber < FIRST_GRID_ROW) return
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null
      cell.style = {}
    })
  })
}

// ---------------------------------------------------------------------------
// 4. Header: rows 2-19
// ---------------------------------------------------------------------------

function writeHeader(
  ws: ExcelJS.Worksheet,
  grid: DarGrid,
  profile: Profile,
  submitted: string,
  templateLastCol: number,
  lastCol: number
): void {
  // Merges that stretch to the last day column: one column wider (or narrower) than
  // the template when the period length changes.
  for (const row of TITLE_ROWS) remerge(ws, row, 1, row, lastCol)
  remerge(ws, PERCENT_ROW, FIRST_DAY_COL, PERCENT_ROW, lastCol)
  remerge(ws, SECTION_A_ROW, 1, SECTION_A_ROW + 1, lastCol)

  // A new day column (16 days after a 15-day template) copies the last one's width and
  // its header styles, theme colours included. A column no longer needed is emptied.
  for (let col = templateLastCol + 1; col <= lastCol; col++) {
    ws.getColumn(col).width = ws.getColumn(templateLastCol).width
    for (const row of [INDEX_ROW, DATE_ROW, DAY_NAME_ROW]) {
      ws.getCell(row, col).style = structuredClone(ws.getCell(row, templateLastCol).style)
    }
  }
  for (let col = lastCol + 1; col <= templateLastCol; col++) {
    ws.getColumn(col).width = ws.getColumn(templateLastCol + 1).width
    for (const row of [INDEX_ROW, DATE_ROW, DAY_NAME_ROW]) {
      ws.getCell(row, col).value = null
      ws.getCell(row, col).style = {}
    }
  }

  // Rows 15-17: day number, date, day name. A Date at UTC midnight is how ExcelJS
  // writes a plain date; the template's d-mmm format makes it show as 3-Oct.
  grid.days.forEach((day, i) => {
    const col = FIRST_DAY_COL + i
    ws.getCell(INDEX_ROW, col).value = day.index
    ws.getCell(DATE_ROW, col).value = fromIso(day.date)
    ws.getCell(DAY_NAME_ROW, col).value = day.dayName
  })

  // Your details in E8:E12. A field you haven't filled in keeps the template's text.
  const details = [profile.name, profile.position, profile.department, profile.unit, profile.teamLeader]
  details.forEach((value, i) => {
    if (value) ws.getCell(8 + i, 5).value = value
  })
  ws.getCell('L8').value = `Period Covered: ${grid.sheetName}`
  ws.getCell('L9').value = `Date Submitted: ${longDate(submitted)}`
  ws.getCell('L10').value = `Actual No. of Days Attended: ${grid.daysAttended}`
}

// ---------------------------------------------------------------------------
// 5. The grid: row 20 down
// ---------------------------------------------------------------------------

// Writes both sections and returns the first row after the grid (where the footer goes).
function writeGrid(ws: ExcelJS.Worksheet, grid: DarGrid, lastCol: number, codesRow: boolean): number {
  // A.) Core duties. Their section title is part of the template (rows 18-19).
  let row = FIRST_GRID_ROW
  for (const [i, block] of grid.core.entries()) row = writeDuty(ws, grid, block, i + 1, row, codesRow)
  writeDaysOff(ws, grid, FIRST_GRID_ROW, row - 1)

  // B.) Support functions: a title row styled like section A's, then the duties.
  for (let col = 1; col <= lastCol; col++) {
    ws.getCell(row, col).style = structuredClone(ws.getCell(SECTION_A_ROW, col).style)
  }
  ws.getCell(row, 1).value = 'B.) SUPPORT FUNCTIONS'
  merge(ws, row, 1, row, lastCol)
  ws.getRow(row).height = SECTION_B_HEIGHT
  row++

  const supportTop = row
  for (const [i, block] of grid.support.entries()) row = writeDuty(ws, grid, block, i + 1, row, false)
  writeDaysOff(ws, grid, supportTop, row - 1)
  return row
}

// One duty block. Core duties (withCodes) start with a "Codes for the following:" row,
// unless it's turned off in Settings; support duties never do. Returns the first row after the block.
//
//   A    B:D          E:G                        H  I  J ...
//   1.   Frontend...  Codes for the following:   (the first MFO's % box spans
//                     GIS Location Map ...        this row and the one below)
//                     Standardized API ...
function writeDuty(
  ws: ExcelJS.Worksheet,
  grid: DarGrid,
  block: GridDuty,
  number: number,
  top: number,
  withCodes: boolean
): number {
  const firstMfoRow = withCodes ? top + 1 : top
  // A duty with no MFOs yet still takes one row, so its title shows.
  const bottom = Math.max(top, firstMfoRow + block.rows.length - 1)

  // Number in A and title in B:D, each one box down the whole block.
  // Style every cell before merging: Excel draws a merged box's border from all its cells.
  styleBox(ws, top, 1, bottom, 1, STYLE.number)
  styleBox(ws, top, 2, bottom, 4, STYLE.duty)
  ws.getCell(top, 1).value = number
  ws.getCell(top, 2).value = block.duty.title
  merge(ws, top, 1, bottom, 1)
  merge(ws, top, 2, bottom, 4)

  if (withCodes) {
    styleBox(ws, top, 5, top, 7, STYLE.codes)
    ws.getCell(top, 5).value = 'Codes for the following:'
    merge(ws, top, 5, top, 7)
  }

  // One MFO per row in E:G, then its % cells.
  block.rows.forEach((gridRow, i) => {
    const row = firstMfoRow + i
    styleBox(ws, row, 5, row, 7, STYLE.mfo)
    ws.getCell(row, 5).value = gridRow.output.title
    merge(ws, row, 5, row, 7)

    grid.days.forEach((day, d) => {
      if (day.off) return // writeDaysOff() fills the whole column for the section
      const col = FIRST_DAY_COL + d
      // The first MFO's box also covers the "Codes for the following:" row, as in the sample.
      const boxTop = withCodes && i === 0 ? top : row
      const value = gridRow.cells[d]
      styleBox(ws, boxTop, col, row, col, value === null ? STYLE.emptyDay : STYLE.percent)
      ws.getCell(boxTop, col).value = value // a number like 0.75; the 0% format shows 75%
      merge(ws, boxTop, col, row, col)
    })
  })
  // A core duty with no MFOs: give its codes row empty, bordered day cells.
  if (block.rows.length === 0) {
    grid.days.forEach((day, d) => {
      if (!day.off) styleBox(ws, top, FIRST_DAY_COL + d, top, FIRST_DAY_COL + d, STYLE.emptyDay)
    })
  }

  setHeights(ws, block, top, firstMfoRow, bottom)
  return bottom + 1
}

// A day off is one grey box down the whole section for that day: "Rest Day", "Sick Leave" ...
function writeDaysOff(ws: ExcelJS.Worksheet, grid: DarGrid, top: number, bottom: number): void {
  if (bottom < top) return // an empty section has no rows to cover
  grid.days.forEach((day, d) => {
    if (!day.off) return
    const col = FIRST_DAY_COL + d
    styleBox(ws, top, col, bottom, col, STYLE.dayOff)
    ws.getCell(top, col).value = day.off
    merge(ws, top, col, bottom, col)
  })
}

// Row heights for one block: each MFO row tall enough for its text, then the last row
// grows if the duty title (B:D) needs more room than the rows give it.
function setHeights(ws: ExcelJS.Worksheet, block: GridDuty, top: number, firstMfoRow: number, bottom: number): void {
  const heights: number[] = []
  for (let row = top; row <= bottom; row++) {
    const mfo = block.rows[row - firstMfoRow] // undefined for the codes row
    heights.push(mfo ? Math.max(MIN_HEIGHT, lineCount(mfo.output.title, 50) * LINE_HEIGHT) : MIN_HEIGHT)
  }
  const needed = lineCount(block.duty.title, 24) * LINE_HEIGHT
  const total = heights.reduce((sum, h) => sum + h, 0)
  if (total < needed) heights[heights.length - 1] += needed - total
  heights.forEach((h, i) => (ws.getRow(top + i).height = h))
}

// Gives every cell in a box the same style. structuredClone gives each cell its own
// copy: cells sharing one style object can change each other in ExcelJS.
function styleBox(
  ws: ExcelJS.Worksheet,
  top: number,
  left: number,
  bottom: number,
  right: number,
  style: Partial<ExcelJS.Style>
): void {
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) ws.getCell(row, col).style = structuredClone(style)
  }
}

// ---------------------------------------------------------------------------
// 6. Footer
// ---------------------------------------------------------------------------

// Puts the signature block back with `top` as its "Prepared by:" row, fills in the
// names from your profile, and returns the block's last row.
function writeFooter(
  ws: ExcelJS.Worksheet,
  footer: { rows: FooterRow[]; merges: Box[] },
  top: number,
  profile: Profile
): number {
  footer.rows.forEach((saved, i) => {
    const row = ws.getRow(top + i)
    row.height = saved.height ?? MIN_HEIGHT
    saved.cells.forEach((cell, c) => {
      row.getCell(c + 1).value = cell.value
      row.getCell(c + 1).style = cell.style
    })
  })
  for (const m of footer.merges) merge(ws, top + m.top, m.left, top + m.bottom, m.right)

  // Names two rows under "Prepared by:", titles one row lower; A, J (10) and O (15).
  const put = (rowOffset: number, col: number, value: string | null): void => {
    if (value) ws.getCell(top + rowOffset, col).value = value
  }
  put(2, 1, profile.name)
  put(3, 1, profile.position)
  put(2, 10, profile.confirmedBy)
  put(3, 10, profile.confirmedTitle)
  put(2, 15, profile.notedBy)
  put(3, 15, profile.notedTitle)
  return top + footer.rows.length - 1
}

// ---------------------------------------------------------------------------
// 7. Save without ever leaving a half-written workbook
// ---------------------------------------------------------------------------

// 1. Write everything to <name>.pong-tmp.xlsx. If that fails, the real file is untouched.
// 2. Re-open the temp file with readDarSheet (Phase 1's reader) and check the new sheet.
// 3. Copy the current workbook to <name>.bak.xlsx: one step back if Excel shows a problem.
// 4. Rename the temp file over the workbook. A rename is all or nothing.
async function saveSafely(workbook: ExcelJS.Workbook, path: string, grid: DarGrid): Promise<ExportResult> {
  const tempPath = path.replace(/\.xlsx$/i, '.pong-tmp.xlsx')
  const backupPath = path.replace(/\.xlsx$/i, '.bak.xlsx')
  try {
    await workbook.xlsx.writeFile(tempPath)

    const check = await readDarSheet(tempPath, grid.sheetName)
    const expectedRows = [...grid.core, ...grid.support].reduce((n, b) => n + b.rows.length, 0)
    const writtenRows = check.duties.reduce((n, d) => n + d.outputs.length, 0)
    if (check.days.length !== grid.days.length || writtenRows !== expectedRows) {
      throw new Error(`The new sheet didn't read back correctly (${writtenRows} of ${expectedRows} MFO rows)`)
    }

    await copyFile(path, backupPath)
    await rename(tempPath, path) // on Windows, rename replaces the old file
  } catch (error) {
    await rm(tempPath, { force: true }) // force: no error if it was never written
    throw friendly(error, path)
  }
  return { sheetName: grid.sheetName, path, backupPath }
}

// Puts the workbook back as it was before an export, from the .bak saveSafely() kept.
export async function undoExport(result: ExportResult): Promise<void> {
  await checkNotLocked(result.path)
  try {
    await copyFile(result.backupPath, result.path)
  } catch (error) {
    throw friendly(error, result.path)
  }
}
