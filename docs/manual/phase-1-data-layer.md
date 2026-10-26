# Phase 1 by hand: the data layer

In this phase you give Pong a memory. When you're done, the main window can save a note to SQLite, read it back, fill the database from your real DAR sheet, and rebuild that sheet's grid from the notes.

You'll write about 12 files. Type them rather than pasting if you can: typing is how the patterns stick. Every step ends with a check, so you always know you're still on track.

Time: two or three evenings. Do the steps in order; each one leans on the one before.

## Before you start

- Phase 0 is committed (`git log --oneline` shows "Phase 0: Electron scaffold").
- A **copy** of your DAR workbook is at `docs/reference/MABANO_DAR_sample.xlsx`. Step 6 reads its "October 3 - 17" sheet.
- Optional but nice: work on a branch, so `main` stays clean until the phase works.
  ```
  git switch -c phase-1
  ```
- Keep `npm test` running in a second terminal while you work: `npx vitest` (no `run`) re-runs the tests every time you save.

## The map

Here's where each new file runs. Keep this picture in mind; most Electron confusion is "which process am I in?"

```
renderer (React, Chromium)     preload (bridge)          main (Node.js)
--------------------------     -----------------         ------------------------------
DbCheck.tsx                    preload/index.ts          ipc.ts      checks arguments
  window.pong.addEntry(...) -> ipcRenderer.invoke(...) -> queries.ts  runs SQL
                                                         db.ts       opens pong.db, migrations
                                                         seed.ts     reads the DAR workbook

shared/ (pure TypeScript, imported by both sides, tested with Vitest)
  types.ts   dates.ts   cutoff.ts   api.ts
```

Why the database lives in main: the renderer is a web page. It can't open files, and it shouldn't; if it could, any bug in the UI could read or wipe your data. Main owns the file, and the renderer can only ask through the small, typed door in the preload.

### One change from the dev plan: `node:sqlite`, not better-sqlite3

Electron 44 ships Node 24, which has SQLite built in as `node:sqlite`. Using it means:

- **No native module.** better-sqlite3 has to be compiled for Electron's exact version, and that compile is the most common Electron install failure on Windows.
- **The same database code runs in Vitest**, so you can test queries against an in-memory database. (A better-sqlite3 built for Electron can't load in plain Node.)
- **`backup()` is built in**, which Phase 7 needs for daily backups.

---

## Step 1 · Shared types

**Process:** shared (both sides). **New file:** `src/shared/types.ts`

These are the shapes every other file agrees on. Note the convention: the database uses `snake_case` columns (`work_date`), TypeScript uses `camelCase` (`workDate`). Step 5 does the renaming.

`src/shared/types.ts`

```ts
// Shapes shared by main and renderer. Dates are 'YYYY-MM-DD' strings in local time.

export type Category = 'core' | 'support'
export type Progress = 0.25 | 0.5 | 0.75 | 1
export type DayType = 'rest' | 'sick' | 'personal' | 'holiday'
export type EntrySource = 'checkin' | 'hotkey' | 'manual' | 'seed'

export interface Profile {
  name: string | null
  position: string | null
  department: string | null
  unit: string | null
  teamLeader: string | null
  confirmedBy: string | null
  confirmedTitle: string | null
  notedBy: string | null
  notedTitle: string | null
  workbookPath: string | null
}

export interface Duty {
  id: number
  category: Category
  title: string
  sort: number
  archived: boolean
}

// An MFO (major final output): one row in the DAR grid.
export interface Output {
  id: number
  dutyId: number
  title: string
  short: string | null
  status: 'active' | 'done'
  createdAt: string
}

export interface Entry {
  id: number
  createdAt: string
  workDate: string
  text: string
  outputId: number | null
  progress: Progress | null
  source: EntrySource
}

export interface NewEntry {
  text: string
  workDate?: string
  outputId?: number | null
  progress?: Progress | null
  source?: EntrySource
}

export interface DayStatus {
  date: string
  type: DayType
}

// A cutoff period, both ends included.
export interface Period {
  start: string
  end: string
}
```

**Check:** `npm run typecheck` passes.

## Step 2 · Dates without time-zone bugs

**Process:** shared. **New files:** `src/shared/dates.ts`, `src/shared/dates.test.ts`

Pong stores every day as a `'YYYY-MM-DD'` string. Two rules make that safe:

1. **"Today" comes from local time.** `new Date().toISOString()` is UTC. At 7:30 AM in Davao, UTC is still yesterday, so a morning note would land on the wrong day. `localDate()` reads the local year, month and day instead.
2. **Date math uses UTC.** Adding a day to `'2026-10-31'` is calendar math, not clock math. Doing it with UTC dates means no time zone can shift the answer.

`src/shared/dates.ts`

```ts
// Calendar dates as 'YYYY-MM-DD' strings. Pong only cares about days, never time zones,
// so the math below uses UTC internally: no daylight-saving or midnight surprises.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  return toIso(fromIso(value)) === value
}

// Today's date on this PC's clock. Do NOT use new Date().toISOString().slice(0, 10):
// that is UTC, so a 7:30 AM note in Davao would land on the previous day.
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Local timestamp for entries.created_at, e.g. '2026-10-26T07:30:00'.
export function localTimestamp(now: Date = new Date()): string {
  return `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function addDays(date: string, days: number): string {
  const d = fromIso(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

// 0 = Sunday ... 6 = Saturday
export function dayOfWeek(date: string): number {
  return fromIso(date).getUTCDay()
}

export function isWeekend(date: string): boolean {
  const day = dayOfWeek(date)
  return day === 0 || day === 6
}

export function fromIso(date: string): Date {
  const [, y, m, d] = DATE_RE.exec(date) ?? []
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
}

export function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
```

The test pins both rules down. The first test would fail if anyone "simplifies" `localDate` to `toISOString()`.

`src/shared/dates.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { addDays, dayOfWeek, isIsoDate, isWeekend, localDate, localTimestamp } from './dates'

describe('localDate', () => {
  it('uses the local calendar day, not UTC', () => {
    // 7:30 AM local. In Manila (UTC+8) toISOString() would say the 25th.
    const morning = new Date(2026, 9, 26, 7, 30)
    expect(localDate(morning)).toBe('2026-10-26')
    expect(localTimestamp(morning)).toBe('2026-10-26T07:30:00')
  })
})

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })
})

describe('weekdays', () => {
  it('knows Oct 3, 2026 is a Saturday', () => {
    expect(dayOfWeek('2026-10-03')).toBe(6)
    expect(isWeekend('2026-10-03')).toBe(true)
    expect(isWeekend('2026-10-05')).toBe(false)
  })
})

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2026-10-26')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-10-26T07:30')).toBe(false)
    expect(isIsoDate(20261026)).toBe(false)
  })
})
```

**Check:** `npm test` shows the new tests passing.

## Step 3 · Cutoff math and the DAR grid

**Process:** shared. **New files:** `src/shared/cutoff.test.ts`, then `src/shared/cutoff.ts`

This is the heart of Pong, and it's pure: no database, no Electron, just data in and data out. That's why it can be tested so thoroughly.

Write the **test first** this time. Save it, watch `npx vitest` fail (cutoff.ts doesn't exist yet), then write `cutoff.ts` until everything is green. That red-then-green loop is the fastest way to get date logic right.

`src/shared/cutoff.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildGrid, daysIn, missedDays, periodFor, sheetName } from './cutoff'
import type { Duty, Entry, Output, Progress } from './types'

describe('periodFor', () => {
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
    const entries = [{ workDate: '2026-10-08' }]
    const status = [{ date: '2026-10-09', type: 'sick' as const }]
    expect(missedDays('2026-10-12', entries, status)).toEqual([
      '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
      '2026-10-10', '2026-10-11'
    ])
  })

  it('never includes today or days outside the period', () => {
    expect(missedDays('2026-10-03', [], [])).toEqual([])
  })
})

// Small fixtures for buildGrid
const duty = (id: number, category: Duty['category'], extra: Partial<Duty> = {}): Duty => ({
  id, category, title: `Duty ${id}`, sort: id, archived: false, ...extra
})
const output = (id: number, dutyId: number, extra: Partial<Output> = {}): Output => ({
  id, dutyId, title: `MFO ${id}`, short: null, status: 'active', createdAt: `2026-10-0${id}`, ...extra
})
let nextId = 1
const entry = (workDate: string, outputId: number | null, progress: Progress | null): Entry => ({
  id: nextId++, createdAt: `${workDate}T09:00:00`, workDate, text: 'note', outputId, progress, source: 'manual'
})

describe('buildGrid', () => {
  const period = { start: '2026-10-03', end: '2026-10-17' }
  const duties = [duty(1, 'core'), duty(2, 'support')]
  const outputs = [output(1, 1), output(2, 1), output(3, 2)]

  it('keeps the highest % per MFO per day', () => {
    const grid = buildGrid(period, [entry('2026-10-05', 1, 0.25), entry('2026-10-05', 1, 0.75)], duties, outputs, [])
    const row = grid.core[0].rows[0]
    expect(row.cells[2]).toBe(0.75) // Oct 5 is day 3
    expect(row.cells[3]).toBeNull()
  })

  it('marks weekends as Rest Day unless there was work', () => {
    const grid = buildGrid(period, [entry('2026-10-03', 1, 0.5)], duties, outputs, [])
    expect(grid.days[0]).toMatchObject({ date: '2026-10-03', dayName: 'SAT', off: null })
    expect(grid.days[1]).toMatchObject({ date: '2026-10-04', dayName: 'SUN', off: 'Rest Day' })
  })

  it('uses day_status for leave and leaves those cells blank', () => {
    const grid = buildGrid(
      period,
      [entry('2026-10-06', 1, 1)],
      duties,
      outputs,
      [{ date: '2026-10-06', type: 'sick' }]
    )
    expect(grid.days[3].off).toBe('Sick Leave')
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
    expect(buildGrid(period, entries, duties, outputs, []).daysAttended).toBe(3)
  })

  it('orders core then support, MFOs oldest first', () => {
    const grid = buildGrid(period, [], duties, [output(2, 1), output(1, 1)], [])
    expect(grid.core.map((b) => b.duty.id)).toEqual([1])
    expect(grid.support.map((b) => b.duty.id)).toEqual([2])
    expect(grid.core[0].rows.map((r) => r.output.id)).toEqual([1, 2])
  })

  it('drops finished MFOs and archived duties with nothing in the period', () => {
    const grid = buildGrid(
      period,
      [entry('2026-10-07', 2, 1)],
      [duty(1, 'core'), duty(2, 'support', { archived: true })],
      [output(1, 1, { status: 'done' }), output(2, 1, { status: 'done' }), output(3, 2)],
      []
    )
    expect(grid.core[0].rows.map((r) => r.output.id)).toEqual([2])
    expect(grid.support[0].rows.map((r) => r.output.id)).toEqual([3]) // active MFO keeps its archived duty
  })

  it('names the sheet', () => {
    expect(buildGrid(period, [], [], [], []).sheetName).toBe('October 3 - 17')
  })
})
```

Things to notice while you write `cutoff.ts`:

- `ymd(2026, 13, 2)` relies on `Date.UTC` rolling month 13 over to January of the next year. That one trick handles both December 18 - January 2 and the 1st/2nd of any month.
- `buildGrid` never stores anything. A DAR cell is always recomputed from notes, so fixing a note fixes the DAR.
- A `day_status` row always wins over notes; a weekend with no notes is a rest day; a weekend with notes is a work day (like Saturday, October 3).

`src/shared/cutoff.ts`

```ts
// Cutoff periods and the DAR grid. Pure functions: no database, no Electron, easy to test.
import { addDays, dayOfWeek, fromIso, isWeekend, toIso } from './dates'
import type { DayStatus, DayType, Duty, Entry, Output, Period, Progress } from './types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export const DAY_OFF_LABEL: Record<DayType, string> = {
  rest: 'Rest Day',
  sick: 'Sick Leave',
  personal: 'Personal Leave',
  holiday: 'Holiday'
}

// Date.UTC rolls month 0 back to December and month 13 on to January for us.
function ymd(year: number, month: number, day: number): string {
  return toIso(new Date(Date.UTC(year, month - 1, day)))
}

// Periods run 3rd-17th and 18th-2nd of the next month.
export function periodFor(date: string): Period {
  const [year, month, day] = date.split('-').map(Number)
  if (day >= 3 && day <= 17) return { start: ymd(year, month, 3), end: ymd(year, month, 17) }
  if (day >= 18) return { start: ymd(year, month, 18), end: ymd(year, month + 1, 2) }
  return { start: ymd(year, month - 1, 18), end: ymd(year, month, 2) }
}

export function daysIn(period: Period): string[] {
  const days: string[] = []
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) days.push(d)
  return days
}

// "October 3 - 17" or "October 18 - November 2"
export function sheetName(period: Period): string {
  const start = fromIso(period.start)
  const end = fromIso(period.end)
  const startPart = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`
  const endPart =
    start.getUTCMonth() === end.getUTCMonth()
      ? `${end.getUTCDate()}`
      : `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`
  return `${startPart} - ${endPart}`
}

// Past days in today's period with no notes and no day_status row: Pong asks about these.
export function missedDays(
  today: string,
  entries: Pick<Entry, 'workDate'>[],
  dayStatus: DayStatus[]
): string[] {
  const logged = new Set(entries.map((e) => e.workDate))
  const marked = new Set(dayStatus.map((s) => s.date))
  return daysIn(periodFor(today)).filter((d) => d < today && !logged.has(d) && !marked.has(d))
}

export interface GridDay {
  date: string
  index: number // 1..n, row 15 of the sheet
  dayName: string // SAT, SUN, MON ...
  off: string | null // "Rest Day", "Sick Leave" ... or null on a work day
}

export interface GridRow {
  output: Output
  cells: (Progress | null)[] // one per day, highest % logged that day
}

export interface GridDuty {
  duty: Duty
  rows: GridRow[]
}

export interface DarGrid {
  period: Period
  sheetName: string
  days: GridDay[]
  core: GridDuty[]
  support: GridDuty[]
  daysAttended: number
}

export function buildGrid(
  period: Period,
  entries: Entry[],
  duties: Duty[],
  outputs: Output[],
  dayStatus: DayStatus[]
): DarGrid {
  const inPeriod = entries.filter((e) => e.workDate >= period.start && e.workDate <= period.end)
  const statusByDate = new Map(dayStatus.map((s) => [s.date, s.type]))
  const loggedDates = new Set(inPeriod.map((e) => e.workDate))

  // A day_status row always wins; a weekend with no notes is a rest day.
  const days: GridDay[] = daysIn(period).map((date, i) => {
    const status = statusByDate.get(date)
    const off = status
      ? DAY_OFF_LABEL[status]
      : isWeekend(date) && !loggedDates.has(date)
        ? DAY_OFF_LABEL.rest
        : null
    return { date, index: i + 1, dayName: DAY_NAMES[dayOfWeek(date)], off }
  })

  // Highest progress per MFO per day.
  const best = new Map<string, Progress>()
  for (const e of inPeriod) {
    if (e.outputId === null || e.progress === null) continue
    const key = `${e.outputId}|${e.workDate}`
    const prev = best.get(key)
    if (prev === undefined || e.progress > prev) best.set(key, e.progress)
  }

  const rowsFor = (duty: Duty): GridRow[] =>
    outputs
      .filter((o) => o.dutyId === duty.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
      .map((output) => ({
        output,
        cells: days.map((d) => (d.off ? null : (best.get(`${output.id}|${d.date}`) ?? null)))
      }))
      // Finished MFOs drop off the sheet unless they have a % in this period.
      .filter((row) => row.output.status === 'active' || row.cells.some((c) => c !== null))

  const blocks = (category: Duty['category']): GridDuty[] =>
    duties
      .filter((d) => d.category === category)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((duty) => ({ duty, rows: rowsFor(duty) }))
      .filter((block) => !block.duty.archived || block.rows.length > 0)

  return {
    period,
    sheetName: sheetName(period),
    days,
    core: blocks('core'),
    support: blocks('support'),
    daysAttended: days.filter((d) => loggedDates.has(d.date) && !statusByDate.has(d.date)).length
  }
}
```

**Check:** all cutoff tests pass. If one fails, read the test name. They're written to say exactly which rule broke.

## Step 4 · The database file and migrations

**Process:** main. **New file:** `src/main/db.ts`

`openDb()` opens the file and brings its tables up to date. Migrations are an ordered list of SQL scripts; SQLite's `PRAGMA user_version` remembers how many have run. Next phase, when you need a new column, you add a second string to the array. You never edit the first one: your real database has already run it.

Notice that this file doesn't import Electron. It takes a file path, so tests can pass `':memory:'` and get a throwaway database.

`src/main/db.ts`

```ts
// SQLite via Node's built-in node:sqlite (Electron 44 ships Node 24). No native module to rebuild.
// No Electron import here on purpose: tests open the same database in memory.
import { DatabaseSync } from 'node:sqlite'

// Append-only: never edit a migration that has shipped, add a new one instead.
// PRAGMA user_version remembers how many have run.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT, position TEXT, department TEXT, unit TEXT, team_leader TEXT,
    confirmed_by TEXT, confirmed_title TEXT, noted_by TEXT, noted_title TEXT,
    workbook_path TEXT
  );
  CREATE TABLE duties (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('core','support')),
    title TEXT NOT NULL, sort INTEGER, archived INTEGER DEFAULT 0
  );
  CREATE TABLE outputs (
    id INTEGER PRIMARY KEY,
    duty_id INTEGER NOT NULL REFERENCES duties(id),
    title TEXT NOT NULL, short TEXT,
    status TEXT DEFAULT 'active', created_at TEXT
  );
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    work_date TEXT NOT NULL,
    text TEXT NOT NULL,
    output_id INTEGER REFERENCES outputs(id),
    progress REAL CHECK (progress IN (0.25, 0.5, 0.75, 1)),
    source TEXT DEFAULT 'checkin'
  );
  CREATE TABLE day_status (
    date TEXT PRIMARY KEY,
    type TEXT CHECK (type IN ('rest','sick','personal','holiday'))
  );
  CREATE TABLE exports (
    id INTEGER PRIMARY KEY,
    period_start TEXT, period_end TEXT, sheet_name TEXT, exported_at TEXT
  );
  CREATE INDEX idx_entries_date ON entries(work_date);
  `
]

export function migrate(db: DatabaseSync): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let version = user_version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

// file = a path, or ':memory:' in tests.
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

// Run several writes as one: all of them land, or none do.
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
```

**Check:** `npm run typecheck`. You'll test it properly in the next step.

## Step 5 · Queries, tested against a real database

**Process:** main. **New files:** `src/main/queries.ts`, `src/main/queries.test.ts`

Every SQL statement Pong runs lives here. Three things to look for:

- `?` placeholders, never string concatenation: `.run(text)` can't be tricked by a note that contains a quote.
- `AS` aliases rename columns to camelCase, so rows come out already shaped like the types from Step 1.
- SQLite has no booleans (`archived` is 0 or 1), so `listDuties` converts it.

`src/main/queries.ts`

```ts
// Every SQL statement Pong runs. Columns are snake_case in SQLite and camelCase in TypeScript;
// the AS aliases do the renaming.
import type { DatabaseSync } from 'node:sqlite'
import { localDate, localTimestamp } from '../shared/dates'
import type { Category, DayStatus, DayType, Duty, Entry, NewEntry, Output, Period, Profile } from '../shared/types'

const ENTRY_COLUMNS = `id, created_at AS createdAt, work_date AS workDate, text,
  output_id AS outputId, progress, source`

const OUTPUT_COLUMNS = `id, duty_id AS dutyId, title, short, status, created_at AS createdAt`

// ---- entries

export function addEntry(db: DatabaseSync, entry: NewEntry, now: Date = new Date()): Entry {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO entries (created_at, work_date, text, output_id, progress, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      localTimestamp(now),
      entry.workDate ?? localDate(now),
      entry.text,
      entry.outputId ?? null,
      entry.progress ?? null,
      entry.source ?? 'checkin'
    )
  return db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`).get(lastInsertRowid) as unknown as Entry
}

export function entriesByDate(db: DatabaseSync, date: string): Entry[] {
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE work_date = ? ORDER BY created_at`)
    .all(date) as unknown as Entry[]
}

export function entriesInPeriod(db: DatabaseSync, period: Period): Entry[] {
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE work_date BETWEEN ? AND ? ORDER BY created_at`)
    .all(period.start, period.end) as unknown as Entry[]
}

// ---- duties

export function listDuties(db: DatabaseSync): Duty[] {
  const rows = db
    .prepare(`SELECT id, category, title, sort, archived FROM duties ORDER BY category, sort, id`)
    .all() as unknown as (Omit<Duty, 'archived'> & { archived: number })[]
  // SQLite has no booleans: 0/1 in the table, false/true in TypeScript.
  return rows.map((row) => ({ ...row, archived: row.archived === 1 }))
}

export function addDuty(db: DatabaseSync, category: Category, title: string): Duty {
  const { next } = db
    .prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM duties WHERE category = ?`)
    .get(category) as { next: number }
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO duties (category, title, sort) VALUES (?, ?, ?)`)
    .run(category, title, next)
  return listDuties(db).find((d) => d.id === Number(lastInsertRowid))!
}

export function updateDuty(db: DatabaseSync, id: number, changes: { title?: string; archived?: boolean }): void {
  if (changes.title !== undefined) db.prepare(`UPDATE duties SET title = ? WHERE id = ?`).run(changes.title, id)
  if (changes.archived !== undefined)
    db.prepare(`UPDATE duties SET archived = ? WHERE id = ?`).run(changes.archived ? 1 : 0, id)
}

// ---- outputs (MFOs)

export function listOutputs(db: DatabaseSync): Output[] {
  return db.prepare(`SELECT ${OUTPUT_COLUMNS} FROM outputs ORDER BY created_at, id`).all() as unknown as Output[]
}

export function addOutput(db: DatabaseSync, dutyId: number, title: string, now: Date = new Date()): Output {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO outputs (duty_id, title, created_at) VALUES (?, ?, ?)`)
    .run(dutyId, title, localTimestamp(now))
  return db.prepare(`SELECT ${OUTPUT_COLUMNS} FROM outputs WHERE id = ?`).get(lastInsertRowid) as unknown as Output
}

export function updateOutput(
  db: DatabaseSync,
  id: number,
  changes: { title?: string; status?: Output['status'] }
): void {
  if (changes.title !== undefined) db.prepare(`UPDATE outputs SET title = ? WHERE id = ?`).run(changes.title, id)
  if (changes.status !== undefined) db.prepare(`UPDATE outputs SET status = ? WHERE id = ?`).run(changes.status, id)
}

// ---- profile (always the single row with id = 1)

const EMPTY_PROFILE: Profile = {
  name: null, position: null, department: null, unit: null, teamLeader: null,
  confirmedBy: null, confirmedTitle: null, notedBy: null, notedTitle: null, workbookPath: null
}

export function getProfile(db: DatabaseSync): Profile {
  const row = db
    .prepare(
      `SELECT name, position, department, unit, team_leader AS teamLeader,
         confirmed_by AS confirmedBy, confirmed_title AS confirmedTitle,
         noted_by AS notedBy, noted_title AS notedTitle, workbook_path AS workbookPath
       FROM profile WHERE id = 1`
    )
    .get() as unknown as Profile | undefined
  return row ?? EMPTY_PROFILE
}

export function setProfile(db: DatabaseSync, changes: Partial<Profile>): Profile {
  const p = { ...getProfile(db), ...changes }
  db.prepare(
    `INSERT INTO profile (id, name, position, department, unit, team_leader,
       confirmed_by, confirmed_title, noted_by, noted_title, workbook_path)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, position = excluded.position, department = excluded.department,
       unit = excluded.unit, team_leader = excluded.team_leader,
       confirmed_by = excluded.confirmed_by, confirmed_title = excluded.confirmed_title,
       noted_by = excluded.noted_by, noted_title = excluded.noted_title,
       workbook_path = excluded.workbook_path`
  ).run(
    p.name, p.position, p.department, p.unit, p.teamLeader,
    p.confirmedBy, p.confirmedTitle, p.notedBy, p.notedTitle, p.workbookPath
  )
  return p
}

// ---- day status (rest day, sick leave, personal leave, holiday)

export function dayStatusInPeriod(db: DatabaseSync, period: Period): DayStatus[] {
  return db
    .prepare(`SELECT date, type FROM day_status WHERE date BETWEEN ? AND ? ORDER BY date`)
    .all(period.start, period.end) as unknown as DayStatus[]
}

// type = null clears the day.
export function setDayStatus(db: DatabaseSync, date: string, type: DayType | null): void {
  if (type === null) {
    db.prepare(`DELETE FROM day_status WHERE date = ?`).run(date)
  } else {
    db.prepare(
      `INSERT INTO day_status (date, type) VALUES (?, ?)
       ON CONFLICT (date) DO UPDATE SET type = excluded.type`
    ).run(date, type)
  }
}
```

Each test gets a fresh in-memory database from `beforeEach`, so tests never leak data into each other.

`src/main/queries.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from './db'
import * as q from './queries'

let db: DatabaseSync

beforeEach(() => {
  db = openDb(':memory:') // a fresh, empty database for every test
})

describe('migrations', () => {
  it('creates the tables and sets user_version', () => {
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(user_version).toBe(1)
  })
})

describe('entries', () => {
  it('adds an entry with the local date', () => {
    const entry = q.addEntry(db, { text: 'Fixed the billing lookup' }, new Date(2026, 9, 26, 7, 30))
    expect(entry).toMatchObject({
      workDate: '2026-10-26',
      createdAt: '2026-10-26T07:30:00',
      text: 'Fixed the billing lookup',
      outputId: null,
      progress: null,
      source: 'checkin'
    })
    expect(q.entriesByDate(db, '2026-10-26')).toHaveLength(1)
  })

  it('finds entries in a period', () => {
    q.addEntry(db, { text: 'a', workDate: '2026-10-17' })
    q.addEntry(db, { text: 'b', workDate: '2026-10-18' })
    expect(q.entriesInPeriod(db, { start: '2026-10-03', end: '2026-10-17' }).map((e) => e.text)).toEqual(['a'])
  })

  it('rejects a progress the DAR cannot show', () => {
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
    q.setProfile(db, { unit: 'Planning Unit' })
    expect(q.getProfile(db)).toMatchObject({ name: 'Mariel G. Mabano', unit: 'Planning Unit' })
  })
})

describe('day status', () => {
  it('sets, changes and clears a day', () => {
    q.setDayStatus(db, '2026-10-06', 'sick')
    q.setDayStatus(db, '2026-10-06', 'personal')
    expect(q.dayStatusInPeriod(db, { start: '2026-10-03', end: '2026-10-17' })).toEqual([
      { date: '2026-10-06', type: 'personal' }
    ])
    q.setDayStatus(db, '2026-10-06', null)
    expect(q.dayStatusInPeriod(db, { start: '2026-10-03', end: '2026-10-17' })).toEqual([])
  })
})
```

**Check:** `npm test`. These tests run real SQL against real SQLite. If you mistype a column name, they'll tell you.

## Step 6 · Seed from your real DAR

**Process:** main. **New files:** `src/main/seed.ts`, `src/main/seed.test.ts`. **New package:** ExcelJS.

```
npm install exceljs
```

ExcelJS goes in `dependencies` (npm does that by default), not `devDependencies`, because the main process uses it at runtime and it has to ship in the installer.

`readDarSheet()` walks the sheet the same way you'd read it: dates across row 16, then down the rows. It switches between Core and Support at the "A.)" and "B.)" section rows, starts a new duty wherever the merged title in column B changes, and takes one MFO per row from column E. `seedDatabase()` then replaces everything in the database with what it found.

`src/main/seed.ts`

```ts
// Dev only: fill the database from a hand-made DAR sheet, so Pong starts with real data.
// Layout: see "DAR sheet format" in CLAUDE.md.
import ExcelJS from 'exceljs'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './db'
import { isWeekend, toIso } from '../shared/dates'
import type { Category, DayType, Profile, Progress } from '../shared/types'

const FIRST_DAY_COL = 8 // H
const DATE_ROW = 16
const FIRST_GRID_ROW = 18

const OFF_TYPES: Record<string, DayType> = {
  'rest day': 'rest',
  'sick leave': 'sick',
  'personal leave': 'personal',
  holiday: 'holiday'
}

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

export async function readDarSheet(path: string, sheetName: string): Promise<ParsedDar> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const ws = workbook.getWorksheet(sheetName)
  if (!ws) throw new Error(`No sheet named "${sheetName}" in ${path}`)

  const text = (row: number, col: number): string => ws.getCell(row, col).text.trim()

  // Row 16: one date per day column, starting at H.
  const dates: string[] = []
  for (let col = FIRST_DAY_COL; ; col++) {
    const date = toDate(ws.getCell(DATE_ROW, col).value)
    if (!date) break
    dates.push(date)
  }
  if (dates.length === 0) throw new Error(`Row ${DATE_ROW} has no dates from column H`)

  let footerRow = FIRST_GRID_ROW
  while (footerRow <= ws.rowCount && !/^prepared by/i.test(text(footerRow, 1))) footerRow++

  const duties: ParsedDar['duties'] = []
  const offText: string[][] = dates.map(() => [])
  const hasPercent: boolean[] = dates.map(() => false)
  let category: Category = 'core'
  let dutyKey = ''

  for (let row = FIRST_GRID_ROW; row < footerRow; row++) {
    const a = text(row, 1)
    if (/^A\.\)/.test(a)) { category = 'core'; continue }
    if (/^B\.\)/.test(a)) { category = 'support'; continue }

    // The duty title is merged down its block (B:D); a new merge master means a new duty.
    const dutyCell = ws.getCell(row, 2)
    const dutyTitle = dutyCell.text.trim()
    if (dutyTitle && dutyCell.master.address !== dutyKey) {
      dutyKey = dutyCell.master.address
      duties.push({ category, title: dutyTitle, outputs: [] })
    }

    const mfo = text(row, 5)
    const duty = duties[duties.length - 1]
    if (!duty || !mfo || /^codes for the following/i.test(mfo)) continue

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
    const label = offText[i].find((t) => t in OFF_TYPES)
    return { date, off: !hasPercent[i] && label ? OFF_TYPES[label] : null }
  })

  const prepared = footerRow <= ws.rowCount ? footerRow : null
  const attended = /(\d+)/.exec(text(10, 12))

  return {
    sheetName,
    profile: {
      name: text(8, 5) || null,
      position: text(9, 5) || null,
      department: text(10, 5) || null,
      unit: text(11, 5) || null,
      teamLeader: text(12, 5) || null,
      confirmedBy: prepared ? text(prepared + 2, 10) || null : null,
      confirmedTitle: prepared ? text(prepared + 3, 10) || null : null,
      notedBy: prepared ? text(prepared + 2, 15) || null : null,
      notedTitle: prepared ? text(prepared + 3, 15) || null : null
    },
    days,
    duties,
    daysAttended: attended ? Number(attended[1]) : null
  }
}

// Replaces everything in the database with the sheet's data. Dev only.
export function seedDatabase(db: DatabaseSync, dar: ParsedDar): { duties: number; outputs: number; entries: number } {
  return transaction(db, () => {
    db.exec('DELETE FROM entries; DELETE FROM outputs; DELETE FROM duties; DELETE FROM day_status; DELETE FROM profile;')

    const p = dar.profile
    db.prepare(
      `INSERT INTO profile (id, name, position, department, unit, team_leader,
         confirmed_by, confirmed_title, noted_by, noted_title) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      p.name ?? null, p.position ?? null, p.department ?? null, p.unit ?? null, p.teamLeader ?? null,
      p.confirmedBy ?? null, p.confirmedTitle ?? null, p.notedBy ?? null, p.notedTitle ?? null
    )

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
        output.cells.forEach((progress, d) => {
          if (progress === null) return
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

    return { duties: dar.duties.length, outputs, entries }
  })
}

// Excel stores dates as serial numbers; ExcelJS usually hands back a Date at UTC midnight.
function toDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return toIso(value)
  if (typeof value === 'number' && value > 40000) return toIso(new Date(Math.round((value - 25569) * 86400000)))
  if (value && typeof value === 'object' && 'result' in value) return toDate(value.result as ExcelJS.CellValue)
  return null
}

// The DAR only shows 25/50/75/100%. Snap anything else to the nearest quarter.
function toProgress(value: number): Progress {
  return Math.min(1, Math.max(0.25, Math.round(value * 4) / 4)) as Progress
}
```

The test below is this phase's "Done when". It seeds an in-memory database from your workbook, rebuilds the grid with `buildGrid`, and compares it with the sheet cell by cell. It's skipped automatically if the workbook copy isn't there.

`src/main/seed.test.ts`

```ts
// Phase 1's "Done when": rebuild the October 3 - 17 sheet from the database and compare.
// Skipped until docs/reference/MABANO_DAR_sample.xlsx exists.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { readDarSheet, seedDatabase } from './seed'
import * as q from './queries'
import { buildGrid, DAY_OFF_LABEL, periodFor } from '../shared/cutoff'

const SAMPLE = 'docs/reference/MABANO_DAR_sample.xlsx'

describe.skipIf(!existsSync(SAMPLE))('seed from the sample DAR', () => {
  it('reproduces every % and day off of "October 3 - 17"', async () => {
    const dar = await readDarSheet(SAMPLE, 'October 3 - 17')
    const db = openDb(':memory:')
    seedDatabase(db, dar)

    const period = periodFor(dar.days[0].date)
    const grid = buildGrid(
      period,
      q.entriesInPeriod(db, period),
      q.listDuties(db),
      q.listOutputs(db),
      q.dayStatusInPeriod(db, period)
    )

    expect(grid.sheetName).toBe('October 3 - 17')
    expect(grid.days.map((d) => d.date)).toEqual(dar.days.map((d) => d.date))
    expect(grid.days.map((d) => d.off)).toEqual(
      dar.days.map((d) => (d.off ? DAY_OFF_LABEL[d.off] : null))
    )

    const sheetRows = dar.duties.flatMap((d) => d.outputs.map((o) => [o.title, o.cells]))
    const gridRows = [...grid.core, ...grid.support].flatMap((b) => b.rows.map((r) => [r.output.title, r.cells]))
    expect(gridRows).toEqual(sheetRows)

    expect(dar.daysAttended).toBe(12)
    expect(grid.daysAttended).toBe(12)
  })
})
```

**Check:** `npm test`. The seed test should **run** (not show as skipped) and pass.

If it fails, that's the parser meeting your real sheet for the first time. It was tested against a stand-in sheet built from the format notes in `CLAUDE.md`, not your actual file. The failure message shows the first difference. Common causes:

- **"No sheet named ..."**: the tab name differs slightly (an extra space, say). Check the exact name in Excel.
- **Row or column numbers off by one**: your sheet's dates aren't in row 16, or the grid doesn't start at row 18. Adjust `DATE_ROW` or `FIRST_GRID_ROW`.
- **A duty split in two, or two duties merged into one**: column B isn't merged the way `CLAUDE.md` describes. Look at that block's merges in Excel.
- **`expected 11 to be 12`**: a day with work but no % in the grid. Check what's in that day's column.

## Step 7 · IPC handlers in main

**Process:** main. **New file:** `src/main/ipc.ts`. **Changed:** `src/main/index.ts`

`ipcMain.handle('entries:add', ...)` is like an API route: the renderer calls it by name, main runs it and sends back the result (or the error). The important habit is in `check()`: **every argument is checked before it touches the database**. It comes from a web page; treat it like input from the internet.

Channel names follow `<area>:<verb>`, so you can tell at a glance what each one does.

`src/main/ipc.ts`

```ts
// Every renderer -> main request lands here. Arguments come from a web page, so check
// each one before it reaches the database.
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import * as q from './queries'
import { readDarSheet, seedDatabase } from './seed'
import { hideWindow, showWindow } from './windows'
import { buildGrid } from '../shared/cutoff'
import { isIsoDate } from '../shared/dates'
import { isWindowLabel } from '../shared/windowLabel'
import type { Category, DayType, NewEntry, Period, Profile } from '../shared/types'

const PROGRESS = [0.25, 0.5, 0.75, 1]
const CATEGORIES: Category[] = ['core', 'support']
const DAY_TYPES: DayType[] = ['rest', 'sick', 'personal', 'holiday']
const SOURCES = ['checkin', 'hotkey', 'manual']
const PROFILE_KEYS: (keyof Profile)[] = [
  'name', 'position', 'department', 'unit', 'teamLeader',
  'confirmedBy', 'confirmedTitle', 'notedBy', 'notedTitle', 'workbookPath'
]

function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`Bad argument: ${what}`)
}

const isText = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isPeriod = (v: unknown): v is Period =>
  isObject(v) && isIsoDate(v.start) && isIsoDate(v.end) && v.start <= v.end

function checkNewEntry(v: unknown): asserts v is NewEntry {
  check(isObject(v), 'entry')
  check(isText(v.text), 'entry.text')
  check(v.workDate === undefined || isIsoDate(v.workDate), 'entry.workDate')
  check(v.outputId === undefined || v.outputId === null || isId(v.outputId), 'entry.outputId')
  check(v.progress === undefined || v.progress === null || PROGRESS.includes(v.progress as number), 'entry.progress')
  check(v.source === undefined || SOURCES.includes(v.source as string), 'entry.source')
}

function checkProfile(v: unknown): asserts v is Partial<Profile> {
  check(isObject(v), 'profile')
  for (const [key, value] of Object.entries(v)) {
    check(PROFILE_KEYS.includes(key as keyof Profile), `profile.${key}`)
    check(value === null || (typeof value === 'string' && value.length <= 300), `profile.${key}`)
  }
}

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
    checkNewEntry(entry)
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
    check(type === null || DAY_TYPES.includes(type as DayType), 'type')
    q.setDayStatus(db, date, type as DayType | null)
  })

  // the DAR grid for one cutoff
  ipcMain.handle('grid:build', (_e, period: unknown) => {
    check(isPeriod(period), 'period')
    return buildGrid(
      period,
      q.entriesInPeriod(db, period),
      q.listDuties(db),
      q.listOutputs(db),
      q.dayStatusInPeriod(db, period)
    )
  })

  // dev only: replace everything with the sample DAR's data
  ipcMain.handle('dev:seed', async () => {
    if (app.isPackaged) throw new Error('Seeding is only available in development')
    const path = join(app.getAppPath(), 'docs/reference/MABANO_DAR_sample.xlsx')
    return seedDatabase(db, await readDarSheet(path, 'October 3 - 17'))
  })
}
```

`index.ts` now opens the database once the app is ready (`userData` only exists then), closes it on quit, and passes it to `registerIpc`. The window handlers moved into `ipc.ts`.

`src/main/index.ts`

```ts
import { app } from 'electron'
import { join } from 'node:path'
import { openDb } from './db'
import { registerIpc } from './ipc'
import { createWindows, showWindow } from './windows'

// Dev runs keep their data apart from the installed app: %APPDATA%\Pong-dev vs %APPDATA%\Pong.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Pong-dev'))
}

// Only one Pong: a second launch brings the first one's main window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow('main'))

  app.whenReady().then(() => {
    app.setAppUserModelId('ph.dcwd.pong')
    const db = openDb(join(app.getPath('userData'), 'pong.db'))
    app.on('will-quit', () => db.close())
    registerIpc(db)
    createWindows()
  })
}
```

**Check:** `npm run typecheck`. The renderer can't call any of this yet; the preload is next.

## Step 8 · The preload bridge

**Process:** preload, plus shared. **Changed:** `src/shared/api.ts`, `src/preload/index.ts`

`api.ts` is the contract: the list of everything the renderer may ask for. The preload implements it, one line per method, each forwarding to a channel from Step 7. Because the preload is typed as `PongApi`, TypeScript complains if you forget a method or get its arguments wrong.

`src/shared/api.ts`

```ts
import type { DarGrid } from './cutoff'
import type { Category, DayStatus, DayType, Duty, Entry, NewEntry, Output, Period, Profile } from './types'
import type { WindowLabel } from './windowLabel'

// Everything the renderer may ask of the main process. The preload implements this
// as window.pong; each method maps to one ipcMain.handle channel in src/main/ipc.ts.
export interface PongApi {
  showWindow(label: WindowLabel): Promise<void>
  hideWindow(label: WindowLabel): Promise<void>

  addEntry(entry: NewEntry): Promise<Entry>
  entriesByDate(date: string): Promise<Entry[]>
  entriesInPeriod(period: Period): Promise<Entry[]>

  listDuties(): Promise<Duty[]>
  addDuty(category: Category, title: string): Promise<Duty>
  updateDuty(id: number, changes: { title?: string; archived?: boolean }): Promise<void>
  listOutputs(): Promise<Output[]>
  addOutput(dutyId: number, title: string): Promise<Output>
  updateOutput(id: number, changes: { title?: string; status?: Output['status'] }): Promise<void>

  getProfile(): Promise<Profile>
  setProfile(changes: Partial<Profile>): Promise<Profile>
  dayStatusInPeriod(period: Period): Promise<DayStatus[]>
  setDayStatus(date: string, type: DayType | null): Promise<void>

  buildGrid(period: Period): Promise<DarGrid>
  seedFromSample(): Promise<{ duties: number; outputs: number; entries: number }>
}
```

`src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { PongApi } from '../shared/api'

// The only door from the renderer to the main process. Add one method per feature;
// never expose ipcRenderer itself.
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
  seedFromSample: () => ipcRenderer.invoke('dev:seed')
}

contextBridge.exposeInMainWorld('pong', api)
```

`src/preload/index.d.ts` doesn't change: it already says `window.pong` is a `PongApi`, so React sees the new methods automatically.

**Check:** `npm run typecheck`.

## Step 9 · A DB check panel

**Process:** renderer. **New file:** `src/renderer/src/windows/main/DbCheck.tsx`. **Changed:** `MainWindow.tsx`

A throwaway panel to prove the whole chain works: type a note and it's saved and listed; click Seed and the October 3 - 17 summary appears. Phase 5 replaces it with the real Today and Cutoff screens.

The renderer imports from `shared/` directly (`periodFor`, `localDate`). That's fine: they're pure functions with no Node in them. Only things that need Node (the database, files) go through `window.pong`.

`src/renderer/src/windows/main/DbCheck.tsx`

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { periodFor } from '../../../../shared/cutoff'
import { localDate } from '../../../../shared/dates'
import type { DarGrid } from '../../../../shared/cutoff'
import type { Entry } from '../../../../shared/types'

// Phase 1 only: proves renderer -> preload -> main -> SQLite works. Phase 5 removes it.
export default function DbCheck() {
  const today = localDate()
  const [entries, setEntries] = useState<Entry[]>([])
  const [grid, setGrid] = useState<DarGrid | null>(null)
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')

  async function refresh() {
    setEntries(await window.pong.entriesByDate(today))
    setGrid(await window.pong.buildGrid(periodFor(today)))
  }

  useEffect(() => {
    refresh()
  }, [])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    await window.pong.addEntry({ text, source: 'manual' })
    setText('')
    refresh()
  }

  async function seed() {
    try {
      const result = await window.pong.seedFromSample()
      setMessage(`Seeded ${result.duties} duties, ${result.outputs} MFOs, ${result.entries} entries.`)
      setGrid(await window.pong.buildGrid({ start: '2026-10-03', end: '2026-10-17' }))
    } catch (error) {
      setMessage(String(error))
    }
  }

  const rows = grid ? [...grid.core, ...grid.support].flatMap((b) => b.rows) : []

  return (
    <section
      style={{ background: '#ffffff', border: '1px solid var(--line)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h2 style={{ fontSize: 20 }}>DB check</h2>

      <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`A note for ${today}`} style={{ flex: 1 }} />
        <button className="primary" type="submit">Add</button>
      </form>

      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {entries.map((e) => (
          <li key={e.id}>
            {e.createdAt.slice(11, 16)} {e.text}
          </li>
        ))}
        {entries.length === 0 && <li style={{ color: 'var(--muted)' }}>No notes today yet.</li>}
      </ul>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={seed}>Seed from sample DAR</button>
        <span style={{ color: 'var(--muted)', fontSize: 13.5 }}>{message}</span>
      </div>

      {grid && (
        <p style={{ margin: 0, fontSize: 13.5 }}>
          <strong>{grid.sheetName}</strong>: {rows.length} MFO rows, {grid.daysAttended} days attended,
          days off: {grid.days.filter((d) => d.off).map((d) => `${d.date.slice(5)} ${d.off}`).join(', ') || 'none'}
        </p>
      )}
    </section>
  )
}
```

`src/renderer/src/windows/main/MainWindow.tsx`

```tsx
import Pong from '../../components/Pong'
import DbCheck from './DbCheck'

// Phase 0 placeholder with dev buttons. Phase 5 builds Today and Cutoff from docs/design/boards/App.dc.html.
export default function MainWindow() {
  return (
    <main style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Pong mood="peek" size={64} />
        <div>
          <h1 style={{ fontSize: 30 }}>Pong DAR Buddy</h1>
          <span style={{ color: 'var(--muted)' }}>Phase 0 scaffold. Today, Cutoff and Settings arrive in Phases 5 and 7.</span>
        </div>
      </header>

      <section
        style={{
          background: '#ffffff',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <h2 style={{ fontSize: 20 }}>Dev buttons</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
          Each button calls window.pong (preload), which asks the main process to show or hide a window.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={() => window.pong.showWindow('pong')}>
            Show pong
          </button>
          <button onClick={() => window.pong.hideWindow('pong')}>Hide pong</button>
          <button className="primary" onClick={() => window.pong.showWindow('checkin')}>
            Show check-in
          </button>
        </div>
      </section>

      <DbCheck />
    </main>
  )
}
```

**Check:** `npm run dev`, then in the main window:

1. Type a note, press Enter. It appears under the box with the time.
2. Close the app and run `npm run dev` again. The note is still there: it's in `%APPDATA%\Pong-dev\pong.db`.
3. Click **Seed from sample DAR**. You should see something like "Seeded 3 duties, 6 MFOs, 32 entries", then "October 3 - 17: ... 12 days attended". (Seeding replaces everything, including the note from step 1.)

To see errors from the main process (a failed `check()`, a bad SQL statement), look at the terminal running `npm run dev`. Errors from React show in the window's DevTools: press **Ctrl+Shift+I**.

## Step 10 · Done when, then commit

The plan's check: tests pass, and `buildGrid` on the seeded data reproduces every % and Rest Day of "October 3 - 17", with 12 days attended. Step 6's test checks exactly that.

```
npm test
npm run typecheck
```

Then commit:

```
git add -A
git commit -m "Phase 1: data layer"
```

If you made a branch: `git switch main` then `git merge phase-1`.

## Try it yourself (optional)

Two small exercises in the same patterns, both needed by Phase 5. No answers given; the tests tell you when you're right.

1. **`updateEntry` and `deleteEntry`.** Add the queries and tests (Step 5's pattern), then the IPC handlers with argument checks (Step 7), then the preload methods (Step 8). Add a delete button to each note in the DB check panel.
2. **A second migration.** Add `entries.updated_at TEXT` as migration 2 in `db.ts`. Run the app: your existing `pong.db` goes from `user_version` 1 to 2 and keeps its data. Add a test that `user_version` is now 2.

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| `Cannot find module 'node:sqlite'` | Node older than 22.5. Check `node -v` shows v24. |
| `window.pong.X is not a function` | Missing from `src/preload/index.ts`. Restart `npm run dev`: preload changes need a restart, not just hot reload. |
| `No handler registered for 'x:y'` | Channel name differs between the preload and `ipc.ts`. |
| `Bad argument: ...` in the dev terminal | `check()` working as intended: the renderer sent something wrong. |
| `FOREIGN KEY constraint failed` | An MFO pointing at a duty id that doesn't exist. |
| `database is locked` | Two Pongs running. Close every Pong window and try again. |
