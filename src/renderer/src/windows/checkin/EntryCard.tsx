// EntryCard.tsx: "What are you up to?" One line, a DAR task, a %. Runs in the RENDERER.
// Enter saves, Esc hides (CheckinWindow handles Esc). The last MFO and % are preselected.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import PercentPicker from '../../components/PercentPicker'
import TaskPicker from '../../components/TaskPicker'
import CommitSuggestions from '../../components/CommitSuggestions'
import { useTasks } from '../../components/useTasks'
import { localDate } from '../../../../shared/dates'
import type { CommitSuggestion } from '../../../../shared/gitlog'
import type { EntrySource, Progress } from '../../../../shared/types'

const now = (): string =>
  new Date().toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function EntryCard(props: { source: EntrySource; onDone: () => void }) {
  const tasks = useTasks()
  const [text, setText] = useState('')
  const [outputId, setOutputId] = useState<number | null>(null)
  const [progress, setProgress] = useState<Progress>(0.5)
  const [error, setError] = useState('')
  const preselected = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  // Once the tasks arrive, preselect the last note's MFO and %. Only once per card,
  // so it doesn't undo a choice you've already made.
  useEffect(() => {
    if (preselected.current || !tasks.last) return
    preselected.current = true
    setOutputId(tasks.last.outputId)
    if (tasks.last.progress) setProgress(tasks.last.progress)
  }, [tasks.last])

  // The window was hidden, not closed: put the cursor back in the box when it's shown again.
  useEffect(() => {
    const focus = () => input.current?.focus()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])

  // A commit picked from "From your commits": its message becomes the note, and the
  // repo's usual task is picked (if it's still an active task).
  function pickCommit(commit: CommitSuggestion) {
    setText(commit.subject)
    setError('')
    const output = tasks.outputs.find((o) => o.id === commit.outputId && o.status === 'active')
    if (output) setOutputId(output.id)
    input.current?.focus()
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (!text.trim()) {
      setError('Type a line first.')
      input.current?.focus()
      return
    }
    try {
      await window.pong.addEntry({
        text: text.trim(),
        outputId,
        progress: outputId === null ? null : progress, // a plain note has no %
        source: props.source
      })
      props.onDone()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="card-head">
        <div className="field" style={{ gap: 2 }}>
          <span className="card-title">What are you up to?</span>
          <span className="card-sub">{now()}</span>
        </div>
        <CloseButton onClick={props.onDone} />
      </div>

      <label className="field">
        <span className="field-label">One line is enough</span>
        <input
          ref={input}
          className="note-input"
          autoFocus
          value={text}
          maxLength={1000}
          placeholder="e.g. popup info card for each PIP pin"
          onChange={(e) => {
            setText(e.target.value)
            setError('')
          }}
        />
      </label>

      <CommitSuggestions date={localDate()} onPick={pickCommit} />
      <TaskPicker tasks={tasks} value={outputId} onChange={setOutputId} />

      {outputId !== null && (
        <div className="field">
          <span className="field-label">How far along?</span>
          <PercentPicker value={progress} onChange={setProgress} />
        </div>
      )}

      {error && <span className="error">{error}</span>}

      <div className="card-foot">
        <span className="hint">
          <kbd>Enter</kbd> save &nbsp; <kbd>Esc</kbd> close
        </span>
        <button className="teal" type="submit">
          Save note
        </button>
      </div>
    </form>
  )
}

export function CloseButton(props: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="Close" onClick={props.onClick}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
        <path d="M2 2l10 10M12 2L2 12" stroke="#2A2622" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  )
}
