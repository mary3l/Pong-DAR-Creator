// backup.ts: a copy of pong.db once a day, in userData\backups, keeping the newest 14.
// Runs in the MAIN process. backup() from node:sqlite copies a live database safely,
// even while Pong is writing to it (a plain file copy could catch it half-written).
// Never imports electron: index.ts passes the folder in.
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { backup, type DatabaseSync } from 'node:sqlite'
import { localDate } from '../shared/dates'

const KEEP = 14
const NAME = /^pong-\d{4}-\d{2}-\d{2}\.db$/ // pong-2026-11-03.db

let folder = ''
let database: DatabaseSync

// Today's backup (replacing one made earlier today), then delete all but the newest 14.
// The names sort by date, so "newest" is simply the end of the sorted list.
export async function backupNow(): Promise<{ path: string; at: number }> {
  mkdirSync(folder, { recursive: true })
  const path = join(folder, `pong-${localDate()}.db`)
  rmSync(path, { force: true })
  await backup(database, path)
  const old = readdirSync(folder).filter((f) => NAME.test(f)).sort().slice(0, -KEEP)
  for (const file of old) rmSync(join(folder, file), { force: true })
  return { path, at: Date.now() }
}

// When the newest backup was made (ms), or null if there's none yet.
export function lastBackup(): number | null {
  try {
    const newest = readdirSync(folder).filter((f) => NAME.test(f)).sort().at(-1)
    return newest ? statSync(join(folder, newest)).mtimeMs : null
  } catch {
    return null // no folder yet
  }
}

// At startup and then hourly: make today's backup if there isn't one yet.
export function startBackups(db: DatabaseSync, dir: string): void {
  database = db
  folder = dir
  const daily = (): void => {
    const last = lastBackup()
    if (last === null || localDate(new Date(last)) !== localDate()) {
      backupNow().catch((error) => console.error('Backup failed:', error))
    }
  }
  setTimeout(daily, 10_000) // let startup finish first
  setInterval(daily, 60 * 60_000)
}
