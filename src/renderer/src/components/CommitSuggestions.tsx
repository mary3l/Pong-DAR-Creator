// CommitSuggestions.tsx: "From your commits": what you committed in your git repos,
// as one-click starts for a note. Runs in the RENDERER; main runs git
// (window.pong.commitSuggestions). Shows nothing when there are no repos or no commits.
import { useEffect, useState } from 'react'
import type { CommitSuggestion } from '../../../shared/gitlog'
import { time12 } from '../windows/main/TodayView'

export default function CommitSuggestions(props: {
  date: string // the day the note is for
  refresh?: number // bump to look again (after a log is added)
  onPick: (commit: CommitSuggestion) => void
}) {
  const [commits, setCommits] = useState<CommitSuggestion[]>([])

  useEffect(() => {
    let current = true // ignore a slow answer that arrives after the card changed
    window.pong
      .commitSuggestions(props.date)
      .then((c) => current && setCommits(c))
      .catch(() => current && setCommits([]))
    return () => {
      current = false
    }
  }, [props.date, props.refresh])

  if (commits.length === 0) return null
  return (
    <div className="field">
      <span className="field-label">From your commits</span>
      <div className="commits">
        {commits.map((c) => (
          <button key={c.hash} type="button" className="commit" title={c.subject} onClick={() => props.onPick(c)}>
            <span className="commit-subject">{c.subject}</span>
            <span className="commit-meta">
              {c.repo} · {time12(c.at.slice(11, 16))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
