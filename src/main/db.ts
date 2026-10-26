// db.ts: opens Pong's SQLite database and keeps its tables up to date.
// Runs in the MAIN process (Node). The renderer never touches this file.

// node:sqlite is SQLite built into Node itself. Electron 44 ships Node 24, so it's
// already inside the app: no npm install, no native module to compile.
// DatabaseSync = every call returns its answer right away (no await). That's fine
// because SQLite reads a local file and each query takes well under a millisecond.
import { DatabaseSync } from 'node:sqlite'

// ---------------------------------------------------------------------------
// MIGRATIONS
// Each string is one migration: SQL that moves the database one version forward.
// Index 0 = migration 1, index 1 = migration 2, and so on.
//
// The golden rule: APPEND ONLY. Once a migration has run on your real pong.db,
// never edit it, because that file will never run it again. To change the schema
// later, add a NEW string at the end (e.g. `ALTER TABLE entries ADD COLUMN ...`).
// ---------------------------------------------------------------------------
const MIGRATIONS: string[] = [
  // Migration 1: the six tables from the dev plan.
  `
  -- Your details for the DAR header and footer. CHECK (id = 1) allows only one row.
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT, position TEXT, department TEXT, unit TEXT, team_leader TEXT,
    confirmed_by TEXT, confirmed_title TEXT, noted_by TEXT, noted_title TEXT,
    workbook_path TEXT
  );

  -- Duties: the merged blocks in column B of the DAR. Core (A.) or Support (B.).
  -- INTEGER PRIMARY KEY = SQLite picks the next id automatically on INSERT.
  -- archived is 0 or 1, since SQLite has no true/false type.
  CREATE TABLE duties (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('core','support')),
    title TEXT NOT NULL, sort INTEGER, archived INTEGER DEFAULT 0
  );

  -- Outputs = MFOs, one row each in the DAR grid, each belonging to a duty.
  -- REFERENCES duties(id) is a foreign key: an MFO must point at a real duty.
  CREATE TABLE outputs (
    id INTEGER PRIMARY KEY,
    duty_id INTEGER NOT NULL REFERENCES duties(id),
    title TEXT NOT NULL, short TEXT,
    status TEXT DEFAULT 'active', created_at TEXT
  );

  -- Entries: one row per note you type when Pong asks "What are you up to?".
  -- work_date is the local day 'YYYY-MM-DD'; created_at is the local time.
  -- progress may only be 25/50/75/100%, the values a DAR cell can show.
  -- output_id and progress may be NULL: a plain note with no MFO is allowed.
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    work_date TEXT NOT NULL,
    text TEXT NOT NULL,
    output_id INTEGER REFERENCES outputs(id),
    progress REAL CHECK (progress IN (0.25, 0.5, 0.75, 1)),
    source TEXT DEFAULT 'checkin'
  );

  -- Days off you've marked. One row per date (PRIMARY KEY), so a date can't be
  -- both sick leave and a holiday. Weekends with no notes need no row.
  CREATE TABLE day_status (
    date TEXT PRIMARY KEY,
    type TEXT CHECK (type IN ('rest','sick','personal','holiday'))
  );

  -- A history of DAR sheets Pong has exported (used in Phase 2).
  CREATE TABLE exports (
    id INTEGER PRIMARY KEY,
    period_start TEXT, period_end TEXT, sheet_name TEXT, exported_at TEXT
  );

  -- An index is like a book's index: "notes for Oct 5" jumps straight to them
  -- instead of reading every entry. Pong searches entries by date constantly.
  CREATE INDEX idx_entries_date ON entries(work_date);
  `
  // Migration 2 would go here, after a comma.
]

// ---------------------------------------------------------------------------
// migrate(): runs any migrations this database file hasn't run yet.
//
// Every SQLite file has a built-in number, PRAGMA user_version, that starts at 0
// and that SQLite itself never changes. We use it to record how many migrations
// have run:
//   brand-new file   user_version 0 -> runs migration 1 -> sets it to 1
//   every later run  user_version 1 -> the loop does nothing
//   after you add #2 user_version 1 -> runs only migration 2 -> sets it to 2
// ---------------------------------------------------------------------------
export function migrate(db: DatabaseSync): void {
  // .get() returns the first row as an object: { user_version: 0 }.
  // `as { ... }` tells TypeScript the shape, since SQLite can't know it.
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }

  // Start at the first migration this file hasn't run, and stop at the end of the list.
  for (let version = user_version; version < MIGRATIONS.length; version++) {
    // BEGIN starts a transaction: nothing below is saved until COMMIT.
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version]) // exec() runs SQL that has no ? values and no results
      db.exec(`PRAGMA user_version = ${version + 1}`) // record that this one ran
      db.exec('COMMIT') // save the migration and the new version together
    } catch (error) {
      // Something failed halfway: ROLLBACK undoes everything since BEGIN.
      // user_version stays the same, so the next launch retries cleanly.
      db.exec('ROLLBACK')
      throw error // still report the error, so you see it in the terminal
    }
  }
}

// ---------------------------------------------------------------------------
// openDb(): opens (or creates) the database file and makes it ready to use.
//   In the app: index.ts passes %APPDATA%\Pong-dev\pong.db
//   In tests:   ':memory:' = a throwaway database that only lives in RAM
// This file never imports Electron, which is what lets Vitest test it in plain Node.
// ---------------------------------------------------------------------------
export function openDb(file: string): DatabaseSync {
  // Opens the file, or creates an empty one if it doesn't exist yet.
  const db = new DatabaseSync(file)

  // SQLite ignores REFERENCES (foreign keys) unless you switch them on, and
  // the setting must be repeated every time the file is opened.
  db.exec('PRAGMA foreign_keys = ON')

  // WAL ("write-ahead log") writes changes to pong.db-wal first, then merges them
  // into pong.db. A crash or power cut mid-save can't corrupt the database, and
  // reading never waits for writing. Skipped in memory: there's no file to protect.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')

  // Bring the tables up to date before anyone runs a query.
  migrate(db)
  return db
}

// ---------------------------------------------------------------------------
// transaction(): run several writes as one unit. All of them land, or none do.
// Used in Step 6: the seeder deletes everything and inserts many rows. If one
// insert fails, ROLLBACK puts the database back exactly as it was.
// It's also much faster: one save to disk at COMMIT instead of one per INSERT.
//
// <T> makes it generic: whatever `work` returns, transaction returns too.
//   const counts = transaction(db, () => { ...; return { duties: 3 } })
// ---------------------------------------------------------------------------
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work() // your writes run here
    db.exec('COMMIT') // keep them
    return result
  } catch (error) {
    db.exec('ROLLBACK') // throw them all away
    throw error
  }
}