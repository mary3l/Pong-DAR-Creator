// gitlog.ts: turning `git log` output into note suggestions. Pure: main/git.ts runs
// git and hands the text in here, so all the rules are tested without git.
import { addDays } from './dates'
import type { Entry } from './types'

// One commit, as a suggestion for a note.
export interface CommitSuggestion {
  hash: string
  at: string // local time, '2026-10-31T14:31:00' (same shape as entries.created_at)
  subject: string // the commit message's first line
  repo: string // the folder's name, e.g. 'pong-dar'
  outputId: number | null // the repo's usual DAR task, if you set one
}

// main/git.ts asks git for: hash, local time, subject, each separated by \x1f (unit
// separator), one commit per \x1e (record separator). Those two characters never appear
// in commit messages, so splitting on them is safe, unlike commas or newlines.
export const GIT_FORMAT = '%H%x1f%ad%x1f%s%x1e'

export function parseGitLog(
  output: string,
  repo: string,
  outputId: number | null
): CommitSuggestion[] {
  return output
    .split('\x1e')
    .map((record) => record.trim().split('\x1f'))
    .filter((fields) => fields.length === 3 && /^[0-9a-f]{40}$/.test(fields[0]) && fields[2].trim() !== '')
    .map(([hash, at, subject]) => ({ hash, at, subject: subject.trim(), repo, outputId }))
}

// Which stretch of time to look at, as local timestamps for git's --since/--until.
//   today:     since your last note today (or the start of the day), up to now
//   past day:  the whole day (for the missed-day card)
export function commitWindow(
  date: string,
  now: string, // local timestamp, '2026-10-31T15:00:00'
  notesThatDay: Pick<Entry, 'createdAt'>[]
): { since: string; until: string } {
  const today = now.slice(0, 10)
  if (date !== today) return { since: `${date}T00:00:00`, until: `${addDays(date, 1)}T00:00:00` }
  const last = notesThatDay.map((e) => e.createdAt).sort().at(-1)
  return { since: last ?? `${date}T00:00:00`, until: now }
}

// Several repos' commits together: newest first, each commit once (a commit reached
// from two branches is still one), and none you already logged with the same words.
export function mergeSuggestions(
  lists: CommitSuggestion[][],
  notesThatDay: Pick<Entry, 'text'>[],
  limit = 6
): CommitSuggestion[] {
  const used = new Set(notesThatDay.map((e) => e.text.trim().toLowerCase()))
  const seen = new Set<string>()
  return lists
    .flat()
    .filter((c) => {
      if (seen.has(c.hash) || used.has(c.subject.toLowerCase())) return false
      seen.add(c.hash)
      return true
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
