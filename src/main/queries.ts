// queries.ts: every SQL statement Pong runs, one small function each.
// Runs in the MAIN process. Each function takes the open database as its first
// argument, so tests can pass an in-memory one (see queries.test.ts).
//
// Columns are snake_case in SQLite and camelCase in TypeScript;
// the AS aliases do the renaming.
//
// The pattern used everywhere:
//   db.prepare(sql)   compiles the SQL once into a "statement"
//   .run(a, b)        INSERT/UPDATE/DELETE   -> { changes, lastInsertRowid }
//   .get(a)           SELECT, first row      -> one object, or undefined
//   .all(a)           SELECT, every row      -> an array of objects
// Each ? in the SQL is filled by the arguments, in order. NEVER build SQL by gluing
// strings: a note like  it's done  would break the quotes. ? placeholders are always safe.
import type { DatabaseSync } from 'node:sqlite'
import { localDate, localTimestamp } from '../shared/dates'
import type { Category, DayStatus, DayType, Duty, Entry, NewEntry, Output, Period, Profile } from '../shared/types'

// The column list for entries, renamed to match the Entry type. Written once, reused below.
const ENTRY_COLUMNS = `id, created_at AS createdAt, work_date AS workDate, text,
  output_id AS outputId, progress, source`

const OUTPUT_COLUMNS = `id, duty_id AS dutyId, title, short, status, created_at AS createdAt`

// ---- entries

// Saves one note and returns it as stored (with its new id).
// `now` defaults to the current time; tests pass a fixed one.
export function addEntry(db: DatabaseSync, entry: NewEntry, now: Date = new Date()): Entry {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO entries (created_at, work_date, text, output_id, progress, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      localTimestamp(now),
      entry.workDate ?? localDate(now), // ?? = "use the right side if the left is null/undefined"
      entry.text,
      entry.outputId ?? null, // SQLite needs null, not undefined, for an empty value
      entry.progress ?? null,
      entry.source ?? 'checkin'
    )
  // lastInsertRowid = the id SQLite just gave the new row. Read the row back to return it.
  // `as unknown as Entry`: SQLite returns plain objects it can't type; we vouch for the shape.
  return db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`).get(lastInsertRowid) as unknown as Entry
}

// All notes for one day, oldest first. Fast thanks to idx_entries_date (db.ts).
export function entriesByDate(db: DatabaseSync, date: string): Entry[] {
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE work_date = ? ORDER BY created_at`)
    .all(date) as unknown as Entry[]
}

// All notes in a cutoff. BETWEEN includes both ends, and works because the dates are
// 'YYYY-MM-DD' strings, which sort like dates.
export function entriesInPeriod(db: DatabaseSync, period: Period): Entry[] {
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE work_date BETWEEN ? AND ? ORDER BY created_at`)
    .all(period.start, period.end) as unknown as Entry[]
}

// ---- duties

export function listDuties(db: DatabaseSync): Duty[] {
  // Omit<Duty, 'archived'> & { archived: number } = "a Duty, except archived is a number".
  const rows = db
    .prepare(`SELECT id, category, title, sort, archived FROM duties ORDER BY category, sort, id`)
    .all() as unknown as (Omit<Duty, 'archived'> & { archived: number })[]
  // SQLite has no booleans: 0/1 in the table, false/true in TypeScript.
  return rows.map((row) => ({ ...row, archived: row.archived === 1 }))
}

// Adds a duty at the end of its section.
export function addDuty(db: DatabaseSync, category: Category, title: string): Duty {
  // Next sort number: highest so far + 1. COALESCE(x, 0) = x, or 0 when the section is empty.
  const { next } = db
    .prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM duties WHERE category = ?`)
    .get(category) as { next: number }
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO duties (category, title, sort) VALUES (?, ?, ?)`)
    .run(category, title, next)
  // lastInsertRowid can be a bigint; Number() makes it comparable with id.
  // The ! tells TypeScript "this find() can't come back empty: we just inserted it".
  return listDuties(db).find((d) => d.id === Number(lastInsertRowid))!
}

// Changes only the fields you pass: updateDuty(db, 3, { archived: true }).
export function updateDuty(db: DatabaseSync, id: number, changes: { title?: string; archived?: boolean }): void {
  if (changes.title !== undefined) db.prepare(`UPDATE duties SET title = ? WHERE id = ?`).run(changes.title, id)
  if (changes.archived !== undefined)
    db.prepare(`UPDATE duties SET archived = ? WHERE id = ?`).run(changes.archived ? 1 : 0, id) // true/false -> 1/0
}

// ---- outputs (MFOs)

export function listOutputs(db: DatabaseSync): Output[] {
  return db.prepare(`SELECT ${OUTPUT_COLUMNS} FROM outputs ORDER BY created_at, id`).all() as unknown as Output[]
}

// Adds an MFO under a duty. If dutyId doesn't exist, SQLite throws
// "FOREIGN KEY constraint failed" (foreign_keys is ON, see db.ts).
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

// The check-in card's chips: active MFOs (of duties still in use), most recently
// logged first. MFOs never logged come after, newest first, so a fresh install
// still shows something. MAX(e.created_at) is NULL for those; `IS NULL` sorts them last.
export function recentOutputs(db: DatabaseSync, limit = 5): Output[] {
  return db
    .prepare(
      `SELECT o.id, o.duty_id AS dutyId, o.title, o.short, o.status, o.created_at AS createdAt
       FROM outputs o
       JOIN duties d ON d.id = o.duty_id
       LEFT JOIN entries e ON e.output_id = o.id
       WHERE o.status = 'active' AND d.archived = 0
       GROUP BY o.id
       ORDER BY MAX(e.created_at) IS NULL, MAX(e.created_at) DESC, o.created_at DESC, o.id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as Output[]
}

// The newest note that was tagged to an MFO: the card preselects its MFO and %.
export function lastTagged(db: DatabaseSync): Entry | null {
  const row = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE output_id IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get()
  return (row as unknown as Entry | undefined) ?? null
}

// ---- profile (always the single row with id = 1)

// What getProfile returns before you've filled anything in.
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
  return row ?? EMPTY_PROFILE // no row yet on a fresh install
}

// Merges changes into the saved profile: setProfile(db, { unit: 'Planning Unit' })
// keeps every other field as it was.
export function setProfile(db: DatabaseSync, changes: Partial<Profile>): Profile {
  const p = { ...getProfile(db), ...changes } // later spread wins: changes override saved values
  // An "upsert": INSERT the row; if id 1 already exists (ON CONFLICT), UPDATE it instead.
  // `excluded.name` means "the value we just tried to insert".
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

// Marks a day off, changes its type, or (type = null) clears it.
// Uses the same upsert as setProfile: date is the PRIMARY KEY, so one row per day.
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