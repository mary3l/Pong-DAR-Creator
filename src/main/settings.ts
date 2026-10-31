// settings.ts: Pong's settings, as a small JSON file in userData (settings.json).
// Runs in the MAIN process. No package needed: Node's fs and JSON do it all.
// Like db.ts, this never imports electron: index.ts passes the folder in.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, settingsError, type Settings } from '../shared/settings'
import { events } from './events'

let file = ''
let current: Settings = { ...DEFAULT_SETTINGS }

// Reads settings.json. A missing or broken file means defaults (first run).
// Keys from an older or newer Pong are checked one by one, so one bad value
// can't throw the rest away.
export function loadSettings(userData: string): Settings {
  file = join(userData, 'settings.json')
  current = { ...DEFAULT_SETTINGS }
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    for (const [key, value] of Object.entries(saved)) {
      if (settingsError({ [key]: value }) === null) (current as unknown as Record<string, unknown>)[key] = value
    }
  } catch {
    // no file yet, or not valid JSON: keep the defaults
  }
  return current
}

export function getSettings(): Settings {
  return current
}

// Merges changes in and saves. Written atomically: to settings.json.tmp first, then
// renamed over the real file, so a crash mid-write can't leave half a file behind.
export function saveSettings(changes: Partial<Settings>): Settings {
  const error = settingsError(changes)
  if (error) throw new Error(`Bad setting: ${error}`)
  current = { ...current, ...changes }
  if (file) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(current, null, 2))
    renameSync(`${file}.tmp`, file)
  }
  events.emit('settings-changed')
  return current
}
