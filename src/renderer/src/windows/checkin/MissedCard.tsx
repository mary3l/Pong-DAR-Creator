// MissedCard.tsx: walks through days with no notes, oldest first. Runs in the RENDERER.
// For each day: "Rest day on Saturday?"
//   Yes -> Rest day / Sick leave / Personal leave -> Save   (window.pong.setDayStatus)
//   No  -> add as many logs for that date as you need -> "Done with Saturday"
import { useRef, useState, type FormEvent } from 'react'
import PercentPicker from '../../components/PercentPicker'
import TaskPicker from '../../components/TaskPicker'
import { useTasks } from '../../components/useTasks'
import { DAY_OFF_LABEL, dayLong, missedQuestion, weekdayName } from '../../../../shared/cutoff'
import { isWeekend, localDate } from '../../../../shared/dates'
import type { DayType, Entry, Progress } from '../../../../shared/types'
import { CloseButton } from './EntryCard'

const LEAVES: { type: DayType; label: string; sub: string }[] = [
  { type: 'rest', label: 'Rest day', sub: 'Day off' },
  { type: 'sick', label: 'Sick leave', sub: 'Was sick' },
  { type: 'personal', label: 'Personal leave', sub: 'Personal matter' }
]

type Step = 'question' | 'type' | 'log'

export default function MissedCard(props: { days: string[]; onFinished: () => void; onClose: () => void }) {
  const { days } = props
  const today = localDate()
  const tasks = useTasks()
  const [index, setIndex] = useState(0)
  const [step, setStep] = useState<Step>('question')
  const [leave, setLeave] = useState<DayType>('rest')
  const [logs, setLogs] = useState<Entry[]>([]) // saved for the current day
  const [summary, setSummary] = useState<string[]>([]) // "Sat: Rest Day", "Sun: 2 logs added"
  const [text, setText] = useState('')
  const [outputId, setOutputId] = useState<number | null>(null)
  const [progress, setProgress] = useState<Progress>(0.5)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const day = days[index]
  if (!day) return null
  const name = weekdayName(day)
  const short = name.slice(0, 3)

  // On to the next day, or finish: Pong shows "All caught up!" and the card asks about today.
  function next(line: string) {
    const all = [...summary, line]
    if (index + 1 < days.length) {
      setSummary(all)
      setIndex(index + 1)
      setStep('question')
      setLogs([])
      setText('')
      return
    }
    window.pong.missedDone(all.join(' · '))
    props.onFinished()
  }

  function startLog() {
    setStep('log')
    setLogs([])
    // Start from the last task you used, like the entry card does.
    if (outputId === null && tasks.last) {
      setOutputId(tasks.last.outputId)
      if (tasks.last.progress) setProgress(tasks.last.progress)
    }
  }

  async function saveLeave() {
    await window.pong.setDayStatus(day, leave)
    next(`${short}: ${DAY_OFF_LABEL[leave]}`)
  }

  // Saves what's typed as one log for this day. Returns the new count, or null if empty.
  async function addLog(): Promise<number | null> {
    if (!text.trim()) return null
    try {
      const entry = await window.pong.addEntry({
        text: text.trim(),
        workDate: day,
        outputId,
        progress: outputId === null ? null : progress,
        source: 'checkin'
      })
      setLogs((l) => [...l, entry])
      setText('')
      setError('')
      tasks.reload() // the chips follow what you just used
      input.current?.focus()
      return logs.length + 1
    } catch (e) {
      setError(String(e))
      return null
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await addLog()
  }

  async function done() {
    const count = (await addLog()) ?? logs.length
    if (count === 0) {
      setError('Add at least one log, or go back and mark the day off.')
      return
    }
    next(`${short}: ${count} ${count === 1 ? 'log' : 'logs'} added`)
  }

  const title =
    step === 'log' ? `What did you do on ${name}?` : step === 'type' ? `Off on ${dayLong(day)}` : missedQuestion(day, today)
  const sub = step === 'log' ? `${dayLong(day)} · add as many logs as you need` : `${dayLong(day)} · no notes logged`
  const pending = logs.length + (text.trim() ? 1 : 0)
  const outputTitle = (id: number | null) => tasks.outputs.find((o) => o.id === id)?.title ?? 'Plain note'

  return (
    <form className="card" onSubmit={onSubmit}>
      <div className="card-head">
        <div className="field" style={{ gap: 4 }}>
          <span className="badge">
            Missed day {index + 1} of {days.length}
          </span>
          <span className="card-title">{title}</span>
          <span className="card-sub">{sub}</span>
        </div>
        <CloseButton onClick={props.onClose} />
      </div>

      {step === 'question' && (
        <div className="big-choices">
          <button
            type="button"
            className="big-choice"
            onClick={() => {
              setLeave(isWeekend(day) ? 'rest' : 'sick')
              setStep('type')
            }}
          >
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26">
              <circle cx="13" cy="13" r="12" fill="#E3F1EF" />
              <path d="M16.5 7.5a6 6 0 1 0 2 9.5 5 5 0 0 1-2-9.5z" fill="#2F7F7A" />
            </svg>
            <b>Yes, I was off</b>
            <small>Rest day or leave</small>
          </button>
          <button type="button" className="big-choice" onClick={startLog}>
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26">
              <circle cx="13" cy="13" r="12" fill="#FFF1D6" />
              <path d="M8 18l1-4 7-7 3 3-7 7-4 1z" stroke="#7A4E0B" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
            </svg>
            <b>No, I worked</b>
            <small>Add what you did</small>
          </button>
        </div>
      )}

      {step === 'type' && (
        <>
          <div className="field">
            <span className="field-label">What kind of day off?</span>
            <div className="picks">
              {LEAVES.map((l) => (
                <button
                  key={l.type}
                  type="button"
                  className="pick"
                  aria-pressed={leave === l.type}
                  onClick={() => setLeave(l.type)}
                >
                  <b>{l.label}</b>
                  <small>{l.sub}</small>
                </button>
              ))}
            </div>
            <span className="hint">Shows as "{DAY_OFF_LABEL[leave]}" across that day's column in your DAR.</span>
          </div>
          <div className="card-foot">
            <button type="button" className="link" onClick={() => setStep('question')}>
              Back
            </button>
            <button type="button" className="teal" onClick={saveLeave}>
              Save
            </button>
          </div>
        </>
      )}

      {step === 'log' && (
        <>
          {logs.length > 0 && (
            <div className="logged">
              {logs.map((l) => (
                <div key={l.id}>
                  <span>{l.text}</span>
                  <span className="tag">
                    {outputTitle(l.outputId).slice(0, 28)}
                    {l.progress ? ` · ${l.progress * 100}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          <label className="field">
            <span className="field-label">{logs.length ? 'Another one?' : 'One line per task'}</span>
            <input
              ref={input}
              className="note-input"
              autoFocus
              value={text}
              maxLength={1000}
              placeholder="e.g. hotfix for the billing lookup timeout"
              onChange={(e) => {
                setText(e.target.value)
                setError('')
              }}
            />
          </label>
          <TaskPicker tasks={tasks} value={outputId} onChange={setOutputId} />
          {outputId !== null && <PercentPicker value={progress} onChange={setProgress} />}
          {error && <span className="error">{error}</span>}
          <div className="card-foot">
            <button type="submit" className="outline">
              + Add log
            </button>
            <button type="button" className="teal" disabled={pending === 0} onClick={done}>
              Done with {name}
              {pending ? ` (${pending})` : ''}
            </button>
          </div>
        </>
      )}
    </form>
  )
}
