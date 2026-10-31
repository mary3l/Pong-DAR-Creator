// log.ts: everything main prints (console.log, warn, error) also goes into a file,
// userData\logs\pong-YYYY-MM-DD.log, so a problem can be looked at after the fact.
// Runs in the MAIN process. Keeps the newest 14 days.
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { localDate, localTimestamp } from '../shared/dates'

export function startLog(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const old = readdirSync(dir).filter((f) => /^pong-.*\.log$/.test(f)).sort().slice(0, -14)
  for (const file of old) rmSync(join(dir, file), { force: true })

  // Wrap each console method: print as usual, then append the same line to today's file.
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        appendFileSync(join(dir, `pong-${localDate()}.log`), `${localTimestamp()} ${level.toUpperCase()} ${format(...args)}\n`)
      } catch {
        // a log that can't be written must never crash Pong
      }
    }
  }
  process.on('uncaughtException', (error) => console.error('Uncaught:', error))
  process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error))
}
