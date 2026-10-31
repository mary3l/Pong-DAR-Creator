// gitlog.test.ts: commits become note suggestions.
import { describe, expect, it } from 'vitest'
import { commitWindow, mergeSuggestions, parseGitLog, type CommitSuggestion } from './gitlog'

const H1 = 'a'.repeat(40)
const H2 = 'b'.repeat(40)
const H3 = 'c'.repeat(40)

describe('parseGitLog', () => {
  it('reads hash, local time and subject from each record', () => {
    const out = `${H1}\x1f2026-10-31T14:31:00\x1fFix billing lookup timeout\x1e\n${H2}\x1f2026-10-31T09:05:12\x1fAdd GIS markers, popup card\x1e\n`
    expect(parseGitLog(out, 'pip-frontend', 7)).toEqual([
      { hash: H1, at: '2026-10-31T14:31:00', subject: 'Fix billing lookup timeout', repo: 'pip-frontend', outputId: 7 },
      { hash: H2, at: '2026-10-31T09:05:12', subject: 'Add GIS markers, popup card', repo: 'pip-frontend', outputId: 7 }
    ])
  })

  it('gives nothing for empty output or junk', () => {
    expect(parseGitLog('', 'x', null)).toEqual([])
    expect(parseGitLog('fatal: not a git repository\n', 'x', null)).toEqual([])
  })
})

describe('commitWindow', () => {
  it('today: since the last note, up to now', () => {
    const notes = [{ createdAt: '2026-10-31T09:00:00' }, { createdAt: '2026-10-31T13:20:00' }]
    expect(commitWindow('2026-10-31', '2026-10-31T15:00:00', notes)).toEqual({
      since: '2026-10-31T13:20:00',
      until: '2026-10-31T15:00:00'
    })
  })

  it('today with no notes yet: since midnight', () => {
    expect(commitWindow('2026-10-31', '2026-10-31T08:10:00', []).since).toBe('2026-10-31T00:00:00')
  })

  it('a missed day: the whole day, across a month end', () => {
    expect(commitWindow('2026-10-31', '2026-11-03T08:10:00', [])).toEqual({
      since: '2026-10-31T00:00:00',
      until: '2026-11-01T00:00:00'
    })
  })
})

describe('mergeSuggestions', () => {
  const c = (hash: string, at: string, subject: string, repo = 'pong-dar'): CommitSuggestion => ({
    hash,
    at,
    subject,
    repo,
    outputId: null
  })

  it('newest first, each commit once, skipping what you already logged', () => {
    const a = [c(H1, '2026-10-31T09:00:00', 'Phase 2: DAR export'), c(H2, '2026-10-31T11:00:00', 'Add tray icon')]
    const b = [c(H2, '2026-10-31T11:00:00', 'Add tray icon'), c(H3, '2026-10-31T10:00:00', 'Fix map popup', 'pip')]
    expect(mergeSuggestions([a, b], [{ text: 'phase 2: DAR export ' }]).map((s) => s.subject)).toEqual([
      'Add tray icon',
      'Fix map popup'
    ])
  })

  it('keeps only the newest few', () => {
    const many = Array.from({ length: 10 }, (_, i) => c(String(i).repeat(40), `2026-10-31T0${i}:00:00`, `Commit ${i}`))
    expect(mergeSuggestions([many], [], 3).map((s) => s.subject)).toEqual(['Commit 9', 'Commit 8', 'Commit 7'])
  })
})
