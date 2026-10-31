# Phase 2 by hand: the DAR export

In this phase Pong learns to write your DAR. When you're done, a button in the main window adds a correctly formatted cutoff sheet to a copy of your workbook. A test proves that the sheet Pong writes for "October 3 - 17" matches the one you made by hand, cell for cell.

You'll write 2 new files and change 7. Type them rather than pasting if you can. Every step ends with a check, so you always know you're still on track.

Time: two evenings. Do the steps in order; each one leans on the one before.

## Before you start

- Phase 1 is committed (`git log --oneline` shows "Phase 1: data layer").
- Your copy of the workbook is at `docs/reference/MABANO_DAR_sample.xlsx`. The tests skip themselves without it.
- **No new package.** ExcelJS came in with Phase 1 (`seed.ts` reads the sample with it), and it's already in `dependencies`.
- Optional but nice: work on a branch.
  ```
  git switch -c phase-2
  ```
- Keep `npx vitest` running in a second terminal. The export tests are slow, 10-20 seconds each: the sample has 30 sheets, and every export reads and rewrites all of them.

## The map

```
renderer (React)                 preload (bridge)              main (Node.js)
----------------------------     -----------------------       ------------------------------------
DbCheck.tsx                      preload/index.ts              ipc.ts     'dar:export': checks the period,
  [Export to a copy]                                                      builds the grid, picks the file
  window.pong.exportDar(p, r) -> ipcRenderer.invoke(...)  ->   export.ts  writes the sheet with ExcelJS
                                                               seed.ts    readDarSheet() re-checks the result

shared/ (both sides)   cutoff.ts: longDate()   types.ts: ExportResult   api.ts: exportDar()
```

**Why the export runs in main:** writing a file needs Node, and the renderer has none (that's the `sandbox: true` from Phase 0).

**Why main picks the file, not the renderer:** `window.pong.exportDar(period, replace)` has no path argument on purpose. If a web page could say "write a workbook *here*", one bug or injected script in the UI could overwrite any file you own. Main decides where the workbook is (in this phase, always a copy in `%TEMP%`).

### How `export.ts` works (read this once before you type it)

One call to `exportDar()` runs these steps in order. Each one is a function in the file.

| Step | Function | What it does |
|---|---|---|
| 1 | `checkNotLocked()` | Is the workbook open in Excel? Stop now, with a clear message. |
| 2 | `copySheet()` | Copy the newest sheet into a new one. ExcelJS has no "duplicate sheet". |
| 3 | `takeFooter()` | Remember the signature block, so it can move under the new grid. |
| 4 | `clearGrid()` | Wipe row 20 down: values, styles, merges, the template's leftovers too. |
| 5 | `writeHeader()` | Stretch the header merges to the last day column, fill in rows 8-17. |
| 6 | `writeGrid()` | Duties, MFOs, % cells, the grey day-off boxes. |
| 7 | `writeFooter()` + `saveSafely()` | Put the signatures back, then save without risking the original. |

Three ideas carry the whole file:

1. **Copying a sheet = copying its model.** `worksheet.model` is the whole sheet as plain data: cells, styles, merges, column widths, row heights, page setup, print area. You deep-copy it with `structuredClone` and set it on a new sheet. One ExcelJS quirk: reading `.model` names the merges `merges`, but setting `.model` reads them from `mergeCells`. Forget that line and the copy has no merged cells.
2. **The header is copied, the grid is written.** Rows 1-19 come from the template untouched. That's how the light-blue theme fills survive: Pong never writes them, so it can't get them wrong. From row 20 down, everything is cleared and written fresh with the styles in `STYLE`. The sample's own grid styles are hand-made and inconsistent (borders differ from cell to cell), and CLAUDE.md gives the exact fills for % and day-off cells.
3. **Never edit the workbook in place.** Write `<name>.pong-tmp.xlsx`, read it back, keep `<name>.bak.xlsx`, then rename the temp file over the original. If anything fails along the way, the original is exactly as it was.

### One change from the phase prompt

PHASES.md says `exportDar(workbookPath, period)`. Here it's `exportDar(path, grid, profile, options)`. `export.ts` gets ready-made data, and `ipc.ts` does the database part, the same way `'grid:build'` does. The reason: `export.ts` then never touches the database or Electron, so a test can hand it a grid directly. The renderer still just calls `window.pong.exportDar(period, replace)`.

### What the sample taught (checked before this guide was written)

- The template is "October 3 - 17": it's the last tab.
- In each Core duty, the first MFO's % box also covers the "Codes for the following:" row above it (J20:J21). The hand-made sheet forgot this in a few columns (Q25:Q26, H30:H31 ...). Pong merges them all the same way.
- H20 has a leftover "Rest Day" in white on white, on Oct 3, which was a work day. Pong clears it.
- A40:C42 is an empty merged box below the print area. Pong drops it.
- ExcelJS rewrites the whole workbook, so an export takes about 6 seconds. It drops `printerSettings*.bin` (printer-driver blobs; paper size, orientation, margins and scale are kept) and `calcChain.xml` (Excel rebuilds it). So the file shrinks from about 2.0 MB to 1.5 MB. That's expected, not lost data.
- ExcelJS crashes if you read `.text` from a cell merged into an *empty* cell. The test's `shown()` helper works around it.

---

## Step 1 · The 30-minute spike

**Process:** a plain Node script, not part of the app. **New file:** `spike.mjs` in the project folder (don't commit it).

Before building 400 lines on one idea, prove the idea works: copy a sheet with ExcelJS, save, and open the result in Excel. If Excel complains here, everything after this step would be wasted.

`spike.mjs`

```js
// spike.mjs: Phase 2, step 1. A throwaway test of the one risky idea in this phase:
// can ExcelJS copy a DAR sheet so that Excel still opens the workbook happily?
// Run it from the project folder with:  node spike.mjs   Delete it once you've looked.
import ExcelJS from 'exceljs'
import { copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Work on a copy in %TEMP%: the sample itself is only ever read.
const out = join(tmpdir(), 'pong-spike.xlsx')
await copyFile('docs/reference/MABANO_DAR_sample.xlsx', out)

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(out)
const template = workbook.worksheets.at(-1) // the newest sheet: the last tab

// The whole trick: read the sheet as plain data, deep-copy it, load it into a new sheet.
// ExcelJS calls the merges `merges` when reading the model but `mergeCells` when setting it.
const model = structuredClone(template.model)
const copy = workbook.addWorksheet('Spike copy')
copy.model = { ...model, name: 'Spike copy', mergeCells: model.merges }

await workbook.xlsx.writeFile(out)
console.log(`Copied "${template.name}" to "Spike copy" in ${out}`)
console.log(`Merges: ${model.merges.length} in the template, ${copy.model.merges.length} in the copy`)
```

Run it:

```
node spike.mjs
```

It should print `Merges: 69 in the template, 69 in the copy`.

**Check:** open `%TEMP%\pong-spike.xlsx` in Excel (paste that path into File > Open). This check is yours: Excel can't be opened from the tests.

1. No "We found a problem with some content" prompt.
2. The "Spike copy" tab looks like "October 3 - 17": light-blue header fills (rows 14-17), the title merged across, borders, blue % cells, grey Rest Day boxes.
3. File > Print preview on "Spike copy": landscape, same page as the original.
4. Spot-check two older tabs: they look as they did.

**If something breaks** (a repair prompt, missing colours, broken merges): stop here. The fallback from PHASES.md is writing a standalone "October 3 - 17.xlsx" instead of a new tab. Bring the symptom to your next session before building the rest.

When it looks right, delete `spike.mjs` and `%TEMP%\pong-spike.xlsx`.

## Step 2 · The "Date Submitted" text

**Process:** shared. **Changed:** `src/shared/cutoff.test.ts`, then `src/shared/cutoff.ts`

L9 reads "Date Submitted: October 22, 2026". Turning a date into that text is pure date logic, so it goes in `cutoff.ts` next to `sheetName()`, which already has the month names. Test first, as with every rule in `cutoff.ts`.

In `src/shared/cutoff.test.ts`, add `longDate` to the import at the top:

```ts
import { buildGrid, daysIn, longDate, missedDays, periodFor, sheetName } from './cutoff'
```

and add this block right after the `describe('sheetName', ...)` block:

```ts
describe('longDate', () => {
  it('writes the date the way L9 shows it', () => {
    expect(longDate('2026-10-22')).toBe('October 22, 2026')
    expect(longDate('2027-01-02')).toBe('January 2, 2027') // no leading zero
  })
})
```

Watch it fail (`longDate is not a function`). Then in `src/shared/cutoff.ts`, add this right after the `sheetName()` function:

```ts
// "Date Submitted" in L9: '2026-10-22' -> "October 22, 2026".
export function longDate(date: string): string {
  const d = fromIso(date)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
```

Why `getUTC...`: `fromIso()` makes a Date at midnight UTC (see `dates.ts`). Reading it back in UTC gives the same day everywhere, in any time zone.

**Check:** `npx vitest run src/shared/cutoff.test.ts` passes.

## Step 3 · The result type

**Process:** shared. **Changed:** `src/shared/types.ts`

The renderer needs to know what happened: which sheet was added, and where the files are. Shared, because main returns it and React reads it.

Add this to the end of `src/shared/types.ts`:

```ts
// What an export tells the renderer: which sheet it added, and where the files are.
export interface ExportResult {
  sheetName: string // "October 18 - November 2"
  path: string // the workbook that now has the new sheet
  backupPath: string // <name>.bak.xlsx, the workbook as it was before
}
```

## Step 4 · The sheet writer

**Process:** main. **New file:** `src/main/export.ts`

This is the heart of the phase. It's long, but it's the seven steps from the table above, top to bottom, each with its own heading comment. Type it one section at a time, and read each section's comments before you type its code.

Things to notice as you go:

- **Row and column numbers, not letters.** ExcelJS accepts `mergeCells(top, left, bottom, right)` with numbers, so the code never builds strings like `'H20:H31'`. It only needs a letter once, for the print area: `ws.getColumn(23).letter` gives `'W'`.
- **`merge()` skips single cells.** A 1x1 "merge" is one of the things that makes Excel say the file needs repair.
- **`styleBox()` styles every cell before merging.** Excel draws a merged box's border from all the cells in it, not just the top-left one. `structuredClone` gives each cell its own copy of the style: in ExcelJS, cells that share one style object can change each other.
- **Row heights are estimated.** Excel auto-fits row heights when you type; ExcelJS can't. So `setHeights()` counts characters: about 50 fit on one line of E:G.
- **The template might be the sheet being replaced.** When you export the same cutoff twice, the old sheet *is* the newest sheet. That's why `exportDar()` copies the model before removing the old sheet.

`src/main/export.ts`

```ts
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
export async function exportDar(
  path: string,
  grid: DarGrid,
  profile: Profile,
  options: { submitted: string; replace?: boolean }
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
  const footerTop = writeGrid(ws, grid, lastCol)
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
function writeGrid(ws: ExcelJS.Worksheet, grid: DarGrid, lastCol: number): number {
  // A.) Core duties. Their section title is part of the template (rows 18-19).
  let row = FIRST_GRID_ROW
  for (const [i, block] of grid.core.entries()) row = writeDuty(ws, grid, block, i + 1, row, true)
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

// One duty block. Core duties (withCodes) start with a "Codes for the following:" row;
// support duties don't. Returns the first row after the block.
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
```

**Check:** `npm run typecheck` passes.

## Step 5 · The test: regenerate your real sheet

**Process:** main (tests run in Node). **New file:** `src/main/export.test.ts`

This is Phase 2's "Done when", as a test. It seeds a database from "October 3 - 17" (Phase 1), exports that cutoff back into a copy of the workbook, then compares the new sheet with the original in three ways:

1. **The data**, read back with Phase 1's `readDarSheet()`: every %, day off, duty, MFO and profile field.
2. **Every cell's text** in the print area, A1:V38. The only exceptions are the two leftover cells, named in `LEFTOVERS`.
3. **Every merged box** of the original. This check runs one way only, because Pong adds the few merges the hand-made sheet forgot.

There are also tests for a 16-day period (column W), for refusing to overwrite a sheet, and for a missing file.

`src/main/export.test.ts`

```ts
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
```

Notice the `60_000` at the end of the slow tests. Vitest gives each test 5 seconds by default, and an export takes about 6. (`60_000` is just `60000`; the `_` makes it easier to read.)

**Check:** `npx vitest run src/main/export.test.ts` shows 4 passed. If a cell differs, the failure names it: `H22: expected '' to be '50%'`.

## Step 6 · The IPC handler

**Process:** main. **Changed:** `src/main/ipc.ts`

What's new in this file:

- **`isCutoff()`**: a real cutoff (3rd-17th or 18th-2nd), not just any two dates. `isPeriod()` would accept Oct 1-31, which would write a 31-day sheet that matches no cutoff.
- **`gridFor()`**: the four queries plus `buildGrid()`, moved out of `'grid:build'` so `'dar:export'` can use them too.
- **`exportTarget()`**: the Phase 2 safety rule, written as code. The first export copies the sample to `%TEMP%\Pong\MABANO_DAR_copy.xlsx`; later exports add to that copy. Your real workbook isn't reachable from here at all. Phase 8 changes this one function.
- **The `'dar:export'` handler**: `async`, because reading and writing the workbook takes seconds. The renderer's `await` simply waits for it.

`src/main/ipc.ts`

```ts
// ipc.ts: every renderer -> main request lands here.
// Runs in the MAIN process.
//
// How IPC works:
//   renderer:  await window.pong.addEntry({ text })            (DbCheck.tsx)
//   preload:   ipcRenderer.invoke('entries:add', { text })     (preload/index.ts)
//   main:      ipcMain.handle('entries:add', (event, entry) => ...)   <- this file
// Whatever the handler returns travels back to the renderer as the Promise's value.
// If it throws, the renderer's Promise rejects with the error message.
//
// Arguments come from a web page, so check each one before it reaches the database.
// Treat them like input from the internet: TypeScript types vanish at runtime, so
// nothing stops a buggy renderer from sending { text: 42 }.
import { app, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { exportDar } from './export'
import * as q from './queries'
import { readDarSheet, seedDatabase } from './seed'
import { hideWindow, showWindow } from './windows'
import { buildGrid, periodFor, type DarGrid } from '../shared/cutoff'
import { isIsoDate, localDate } from '../shared/dates'
import { isWindowLabel } from '../shared/windowLabel'
import type { Category, DayType, NewEntry, Period, Profile } from '../shared/types'

// The allowed values, as lists we can check against at runtime.
const PROGRESS = [0.25, 0.5, 0.75, 1]
const CATEGORIES: Category[] = ['core', 'support']
const DAY_TYPES: DayType[] = ['rest', 'sick', 'personal', 'holiday']
const SOURCES = ['checkin', 'hotkey', 'manual'] // not 'seed': only seed.ts may use that
const PROFILE_KEYS: (keyof Profile)[] = [
  'name', 'position', 'department', 'unit', 'teamLeader',
  'confirmedBy', 'confirmedTitle', 'notedBy', 'notedTitle', 'workbookPath'
]

// Throws if a check fails. `asserts ok` tells TypeScript: after check(x, ...) returns,
// x was true, so it can narrow types the same way an `if` would.
function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`Bad argument: ${what}`)
}

// Small type guards. `v is string` = "if this returns true, v is a string".
const isText = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max // not empty, not huge
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
// typeof null is 'object' in JavaScript (a famous quirk), hence the extra null check.
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isPeriod = (v: unknown): v is Period =>
  isObject(v) && isIsoDate(v.start) && isIsoDate(v.end) && v.start <= v.end
// A real cutoff (3rd-17th or 18th-2nd), not just any two dates: one sheet per cutoff.
const isCutoff = (v: unknown): v is Period =>
  isPeriod(v) && periodFor(v.start).start === v.start && periodFor(v.start).end === v.end

// Checks every field of a NewEntry. Optional fields may be missing (undefined) or null.
function checkNewEntry(v: unknown): asserts v is NewEntry {
  check(isObject(v), 'entry')
  check(isText(v.text), 'entry.text')
  check(v.workDate === undefined || isIsoDate(v.workDate), 'entry.workDate')
  check(v.outputId === undefined || v.outputId === null || isId(v.outputId), 'entry.outputId')
  check(v.progress === undefined || v.progress === null || PROGRESS.includes(v.progress as number), 'entry.progress')
  check(v.source === undefined || SOURCES.includes(v.source as string), 'entry.source')
}

// A profile update may only contain known fields, each a short string or null.
function checkProfile(v: unknown): asserts v is Partial<Profile> {
  check(isObject(v), 'profile')
  // Object.entries({ a: 1 }) -> [['a', 1]]: loop over every key the renderer sent.
  for (const [key, value] of Object.entries(v)) {
    check(PROFILE_KEYS.includes(key as keyof Profile), `profile.${key}`)
    check(value === null || (typeof value === 'string' && value.length <= 300), `profile.${key}`)
  }
}

// The DAR grid for one cutoff: four queries in, one pure function out.
function gridFor(db: DatabaseSync, period: Period): DarGrid {
  return buildGrid(
    period,
    q.entriesInPeriod(db, period),
    q.listDuties(db),
    q.listOutputs(db),
    q.dayStatusInPeriod(db, period)
  )
}

// Phase 2: exports go ONLY into a copy of the sample, %TEMP%\Pong\MABANO_DAR_copy.xlsx.
// The first export makes the copy; later ones add to it. Delete it to start fresh.
// Phase 8 switches this to your real workbook (profile.workbookPath).
async function exportTarget(): Promise<string> {
  const sample = join(app.getAppPath(), 'docs/reference/MABANO_DAR_sample.xlsx')
  const dir = join(app.getPath('temp'), 'Pong')
  const path = join(dir, 'MABANO_DAR_copy.xlsx')
  if (!existsSync(path)) {
    await mkdir(dir, { recursive: true }) // recursive: no error if it already exists
    await copyFile(sample, path)
  }
  return path
}

// Called once from index.ts, after the database is open.
// Each handler: (event, ...arguments). `_e` = the event; the _ says "not used here".
// Channel names follow '<area>:<verb>', and must match preload/index.ts exactly.
export function registerIpc(db: DatabaseSync): void {
  // windows
  ipcMain.handle('window:show', (_e, label: unknown) => {
    check(isWindowLabel(label), 'window label')
    showWindow(label)
  })
  ipcMain.handle('window:hide', (_e, label: unknown) => {
    check(isWindowLabel(label), 'window label')
    hideWindow(label)
  })

  // entries
  ipcMain.handle('entries:add', (_e, entry: unknown) => {
    checkNewEntry(entry) // after this line, TypeScript knows entry is a NewEntry
    return q.addEntry(db, entry)
  })
  ipcMain.handle('entries:byDate', (_e, date: unknown) => {
    check(isIsoDate(date), 'date')
    return q.entriesByDate(db, date)
  })
  ipcMain.handle('entries:inPeriod', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return q.entriesInPeriod(db, period)
  })

  // duties and MFOs
  ipcMain.handle('duties:list', () => q.listDuties(db))
  ipcMain.handle('duties:add', (_e, category: unknown, title: unknown) => {
    check(CATEGORIES.includes(category as Category), 'category')
    check(isText(title, 300), 'title')
    return q.addDuty(db, category as Category, title)
  })
  ipcMain.handle('duties:update', (_e, id: unknown, changes: unknown) => {
    check(isId(id), 'id')
    check(isObject(changes), 'changes')
    check(changes.title === undefined || isText(changes.title, 300), 'changes.title')
    check(changes.archived === undefined || typeof changes.archived === 'boolean', 'changes.archived')
    q.updateDuty(db, id, changes as { title?: string; archived?: boolean })
  })
  ipcMain.handle('outputs:list', () => q.listOutputs(db))
  ipcMain.handle('outputs:add', (_e, dutyId: unknown, title: unknown) => {
    check(isId(dutyId), 'dutyId')
    check(isText(title, 300), 'title')
    return q.addOutput(db, dutyId, title)
  })
  ipcMain.handle('outputs:update', (_e, id: unknown, changes: unknown) => {
    check(isId(id), 'id')
    check(isObject(changes), 'changes')
    check(changes.title === undefined || isText(changes.title, 300), 'changes.title')
    check(changes.status === undefined || changes.status === 'active' || changes.status === 'done', 'changes.status')
    q.updateOutput(db, id, changes as { title?: string; status?: 'active' | 'done' })
  })

  // profile and day status
  ipcMain.handle('profile:get', () => q.getProfile(db))
  ipcMain.handle('profile:set', (_e, changes: unknown) => {
    checkProfile(changes)
    return q.setProfile(db, changes)
  })
  ipcMain.handle('dayStatus:inPeriod', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return q.dayStatusInPeriod(db, period)
  })
  ipcMain.handle('dayStatus:set', (_e, date: unknown, type: unknown) => {
    check(isIsoDate(date), 'date')
    check(type === null || DAY_TYPES.includes(type as DayType), 'type') // null = clear the day
    q.setDayStatus(db, date, type as DayType | null)
  })

  // the DAR grid for one cutoff
  ipcMain.handle('grid:build', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return gridFor(db, period)
  })

  // Phase 2: add the cutoff's sheet to the workbook. `replace` = overwrite a sheet that
  // already has this name. Async: reading and writing the workbook takes a few seconds.
  ipcMain.handle('dar:export', async (_e, period: unknown, replace: unknown) => {
    check(isCutoff(period), 'period')
    check(typeof replace === 'boolean', 'replace')
    if (app.isPackaged) throw new Error('Export is only available in development until Phase 8')
    return exportDar(await exportTarget(), gridFor(db, period), q.getProfile(db), {
      submitted: localDate(),
      replace
    })
  })

  // dev only: replace everything with the sample DAR's data
  // `async` handler: main awaits the file read, then the renderer gets the counts.
  ipcMain.handle('dev:seed', async () => {
    // app.isPackaged is true in the installed app: seeding must never wipe real data there.
    if (app.isPackaged) throw new Error('Seeding is only available in development')
    // app.getAppPath() = the project folder during `npm run dev`.
    const path = join(app.getAppPath(), 'docs/reference/MABANO_DAR_sample.xlsx')
    return seedDatabase(db, await readDarSheet(path, 'October 3 - 17'))
  })
}
```

## Step 7 · The bridge

**Process:** shared + preload. **Changed:** `src/shared/api.ts`, `src/preload/index.ts`

Same pattern as every Phase 1 method: one line in the contract, one line in the preload. After this, TypeScript knows `window.pong.exportDar` exists in React.

`src/shared/api.ts`

```ts
// api.ts: the contract between the renderer and the main process.
// Shared by both sides, types only (nothing here runs).
//   preload/index.ts  implements it (`const api: PongApi = { ... }`)
//   preload/index.d.ts says window.pong is a PongApi, so React gets autocomplete
//   main/ipc.ts       has one ipcMain.handle per method
// Adding a feature = one line here, one in the preload, one handler in ipc.ts.
import type { DarGrid } from './cutoff'
import type {
  Category, DayStatus, DayType, Duty, Entry, ExportResult, NewEntry, Output, Period, Profile
} from './types'
import type { WindowLabel } from './windowLabel'

// Everything the renderer may ask of the main process. The preload implements this
// as window.pong; each method maps to one ipcMain.handle channel in src/main/ipc.ts.
// Every method returns a Promise: crossing between processes always takes a moment,
// so the renderer must `await` the answer.
export interface PongApi {
  showWindow(label: WindowLabel): Promise<void>
  hideWindow(label: WindowLabel): Promise<void>

  addEntry(entry: NewEntry): Promise<Entry> // returns the saved note, with its id
  entriesByDate(date: string): Promise<Entry[]>
  entriesInPeriod(period: Period): Promise<Entry[]>

  listDuties(): Promise<Duty[]>
  addDuty(category: Category, title: string): Promise<Duty>
  updateDuty(id: number, changes: { title?: string; archived?: boolean }): Promise<void>
  listOutputs(): Promise<Output[]>
  addOutput(dutyId: number, title: string): Promise<Output>
  updateOutput(id: number, changes: { title?: string; status?: Output['status'] }): Promise<void>

  getProfile(): Promise<Profile>
  setProfile(changes: Partial<Profile>): Promise<Profile> // Partial = any subset of the fields
  dayStatusInPeriod(period: Period): Promise<DayStatus[]>
  setDayStatus(date: string, type: DayType | null): Promise<void> // null clears the day

  buildGrid(period: Period): Promise<DarGrid>
  exportDar(period: Period, replace: boolean): Promise<ExportResult> // adds the cutoff's sheet (Phase 2)
  seedFromSample(): Promise<{ duties: number; outputs: number; entries: number }> // dev only
}
```

`src/preload/index.ts`

```ts
// preload/index.ts: the bridge. Runs in the PRELOAD context: just before each window's
// page loads, with access to a few Electron APIs (ipcRenderer) the page itself can't use.
//
// contextBridge.exposeInMainWorld('pong', api) makes `window.pong` exist in React.
// The page gets ONLY these functions, never ipcRenderer itself. If it had ipcRenderer,
// any bug or injected script in the UI could call any channel with any argument.
//
// Changes here need a restart of `npm run dev`; hot reload only covers the renderer.
import { contextBridge, ipcRenderer } from 'electron'
import type { PongApi } from '../shared/api'

// The only door from the renderer to the main process. Add one method per feature;
// never expose ipcRenderer itself.
// Typed as PongApi, so TypeScript errors if a method is missing or has the wrong arguments.
// Each line forwards to one channel in main/ipc.ts. invoke() returns a Promise of the
// handler's return value. Channel names must match ipc.ts exactly.
const api: PongApi = {
  showWindow: (label) => ipcRenderer.invoke('window:show', label),
  hideWindow: (label) => ipcRenderer.invoke('window:hide', label),

  addEntry: (entry) => ipcRenderer.invoke('entries:add', entry),
  entriesByDate: (date) => ipcRenderer.invoke('entries:byDate', date),
  entriesInPeriod: (period) => ipcRenderer.invoke('entries:inPeriod', period),

  listDuties: () => ipcRenderer.invoke('duties:list'),
  addDuty: (category, title) => ipcRenderer.invoke('duties:add', category, title),
  updateDuty: (id, changes) => ipcRenderer.invoke('duties:update', id, changes),
  listOutputs: () => ipcRenderer.invoke('outputs:list'),
  addOutput: (dutyId, title) => ipcRenderer.invoke('outputs:add', dutyId, title),
  updateOutput: (id, changes) => ipcRenderer.invoke('outputs:update', id, changes),

  getProfile: () => ipcRenderer.invoke('profile:get'),
  setProfile: (changes) => ipcRenderer.invoke('profile:set', changes),
  dayStatusInPeriod: (period) => ipcRenderer.invoke('dayStatus:inPeriod', period),
  setDayStatus: (date, type) => ipcRenderer.invoke('dayStatus:set', date, type),

  buildGrid: (period) => ipcRenderer.invoke('grid:build', period),
  exportDar: (period, replace) => ipcRenderer.invoke('dar:export', period, replace),
  seedFromSample: () => ipcRenderer.invoke('dev:seed')
}

contextBridge.exposeInMainWorld('pong', api)
```

Remember: preload changes need a full restart of `npm run dev`, not just a hot reload.

## Step 8 · An export button

**Process:** renderer. **Changed:** `src/renderer/src/windows/main/DbCheck.tsx`

The DB check panel gets an **Export to a copy** button. It exports whichever cutoff the panel shows: today's when the app starts, "October 3 - 17" after you click **Seed**.

`exportOrReplace()` shows the safe order: first try *without* replacing. Only if that fails because the sheet exists does it ask you, and only then does it try again with `replace: true`. Overwriting a sheet is never the default.

`src/renderer/src/windows/main/DbCheck.tsx`

```tsx
// DbCheck.tsx: a throwaway panel in the main window. Runs in the RENDERER (React).
// It has no database access of its own: every read and write goes through window.pong.
import { useEffect, useState, type FormEvent } from "react";
// Pure functions from shared/ are fine to import here: they don't need Node.
// (Four ../ to climb from windows/main/ up to src/, then into shared/.)
import { periodFor } from "../../../../shared/cutoff";
import { localDate } from "../../../../shared/dates";
import type { DarGrid } from "../../../../shared/cutoff";
import type { Entry } from "../../../../shared/types";

// Phase 1 only: proves renderer -> preload -> main -> SQLite works. Phase 5 removes it.
// Phase 2 adds the "Export to a copy" button.
export default function DbCheck() {
  const today = localDate();

  // useState = a value React remembers between renders; calling the setter redraws the panel.
  const [entries, setEntries] = useState<Entry[]>([]); // today's notes
  const [grid, setGrid] = useState<DarGrid | null>(null); // null until loaded
  const [text, setText] = useState(""); // what's typed in the box
  const [message, setMessage] = useState(""); // seed result or error

  // Reload today's notes and this period's grid from main.
  async function refresh() {
    setEntries(await window.pong.entriesByDate(today));
    setGrid(await window.pong.buildGrid(periodFor(today)));
  }

  // useEffect with [] = run once, right after the panel first appears.
  useEffect(() => {
    refresh();
  }, []);

  // Pressing Enter in the box submits the form.
  async function add(event: FormEvent) {
    event.preventDefault(); // stop the browser's default form submit (a page reload)
    if (!text.trim()) return;
    await window.pong.addEntry({ text, source: "manual" }); // main fills in today's date
    setText(""); // clear the box
    refresh();
  }

  async function seed() {
    // try/catch: if main throws (e.g. the workbook isn't there), the Promise rejects
    // and we show the error instead of crashing.
    try {
      const result = await window.pong.seedFromSample();
      setMessage(
        `Seeded ${result.duties} duties, ${result.outputs} MFOs, ${result.entries} entries.`,
      );
      setGrid(
        await window.pong.buildGrid({ start: "2026-10-03", end: "2026-10-17" }),
      );
    } catch (error) {
      setMessage(String(error));
    }
  }

  // Phase 2: add the grid's cutoff as a new sheet in a copy of the sample workbook
  // (%TEMP%\Pong\MABANO_DAR_copy.xlsx). Main does the work; this only asks and reports.
  async function exportCopy() {
    if (!grid) return;
    setMessage("Exporting... (a few seconds: the whole workbook is rewritten)");
    try {
      const result = await exportOrReplace(grid);
      setMessage(`Added "${result.sheetName}" to ${result.path}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  // First try without replacing. If that cutoff already has a sheet, ask before
  // overwriting it. confirm() shows a simple OK/Cancel box.
  async function exportOrReplace(g: DarGrid) {
    try {
      return await window.pong.exportDar(g.period, false);
    } catch (error) {
      const exists = String(error).includes("already has a sheet");
      if (!exists || !confirm(`Replace the sheet "${g.sheetName}"?`)) throw error;
      return await window.pong.exportDar(g.period, true);
    }
  }

  // All MFO rows, core and support together, for the summary line.
  const rows = grid
    ? [...grid.core, ...grid.support].flatMap((b) => b.rows)
    : [];

  return (
    <section
      style={{
        background: "#ffffff",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h2 style={{ fontSize: 20 }}>DB check</h2>

      {/* A "controlled" input: React holds the value (text) and updates it on every keystroke. */}
      <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`A note for ${today}`}
          style={{ flex: 1 }}
        />
        <button className="primary" type="submit">
          Add
        </button>
      </form>

      {/* key={e.id} helps React track list items; each one needs a unique key. */}
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {entries.map((e) => (
          <li key={e.id}>
            {e.createdAt.slice(11, 16)} {e.text}
          </li>
        ))}
        {entries.length === 0 && (
          <li style={{ color: "var(--muted)" }}>No notes today yet.</li>
        )}
      </ul>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button onClick={seed}>Seed from sample DAR</button>
        <button onClick={exportCopy} disabled={!grid}>
          Export to a copy
        </button>
        <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{message}</span>
      </div>

      {/* {grid && (...)} = only render this once the grid has loaded. */}
      {grid && (
        <p style={{ margin: 0, fontSize: 13.5 }}>
          <strong>{grid.sheetName}</strong>: {rows.length} MFO rows,{" "}
          {grid.daysAttended} days attended, days off:{" "}
          {grid.days
            .filter((d) => d.off)
            .map((d) => `${d.date.slice(5)} ${d.off}`)
            .join(", ") || "none"}
        </p>
      )}
    </section>
  );
}
```

## Step 9 · Try it in the app

`npm run dev`, then in the main window:

1. **A new sheet for today's cutoff.** The panel shows today's cutoff, for example "November 3 - 17". Add a note or two with the box first, if you like. Click **Export to a copy**. After a few seconds you should see `Added "November 3 - 17" to ...\Temp\Pong\MABANO_DAR_copy.xlsx`. Open that file in Excel. The new last tab has grey Rest Day boxes on the weekends. It runs to column V for a 3rd-17th cutoff, or W for an 18th-2nd one; Step 5's test covers W either way.
2. **The lock message.** Leave the workbook open in Excel and click **Export to a copy** again. You should get `MABANO_DAR_copy.xlsx is open in Excel. Close it there, then export again.` Close Excel and click again. This time it asks whether to replace the sheet. Click OK.
3. **Your real sheet, rebuilt.** Click **Seed from sample DAR** (the panel now shows "October 3 - 17"), then **Export to a copy**, then OK to replace. Open the copy and the sample side by side in Excel and compare the two "October 3 - 17" tabs.
4. **The safe-save files.** In `%TEMP%\Pong` you should see `MABANO_DAR_copy.xlsx` and `MABANO_DAR_copy.bak.xlsx`, and no `.pong-tmp.xlsx`.

To start over with a fresh copy, delete `%TEMP%\Pong\MABANO_DAR_copy.xlsx`. The next export makes a new one.

## Step 10 · Done when, then commit

The plan's check: **Excel opens the generated sheet with no repair prompt, and it matches the original sheet cell for cell.** Step 5's test checks the "cell for cell" part. Step 9's item 3 is your eyes on the "no repair prompt" part.

```
npm test
npm run typecheck
```

Then commit:

```
git add -A
git commit -m "Phase 2: DAR export"
```

If you made a branch: `git switch main` then `git merge phase-2`.

## Try it yourself (optional)

Two small exercises in the same patterns. No answers given.

1. **An "Open in Excel" button.** Add a `'dar:open'` channel that calls Electron's `shell.openPath(path)` on the export copy (main: import `shell` from 'electron'). Then add the preload line and a button. Why main: `shell` is a main-process API.
2. **Remember exports.** The `exports` table has been waiting since Phase 1. Add a query that records `period_start`, `period_end`, `sheet_name` and `exported_at` after a successful export (Phase 1's Step 5 pattern, with a test). Then show "last exported" in the panel. Phase 5's Cutoff window will want it.

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Excel says "We found a problem with some content" | Re-run the spike (Step 1). If the spike is fine, look for a merge that's 1x1 or overlaps another. The `.bak.xlsx` is the workbook from before. |
| `Cannot merge already merged cells` | Two merges overlap. Usually a day-off column that `writeDuty()` also merged: check the `if (day.off) return`. |
| The copy has no merged cells at all | `mergeCells: model.merges` is missing in `copySheet()`. |
| Column W's header is white | The style-copy loop in `writeHeader()` didn't run: check `templateLastCol + 1 <= lastCol`. |
| `... is open in Excel` | Working as intended: close the workbook in Excel. |
| `... already has a sheet named ...` | Working as intended: the panel asks before replacing. |
| `Cannot read properties of null (reading 'toString')` | ExcelJS reading `.text` from a cell merged into an empty one. Check `cell.master.value` first, like `shown()` in the test. |
| A test fails with `Test timed out in 5000ms` | The `60_000` timeout argument is missing from that `it(...)`. |
| `Bad argument: period` | Not a real cutoff, so `isCutoff()` refused it. |
| `window.pong.exportDar is not a function` | Restart `npm run dev`: preload changes need a restart. |
