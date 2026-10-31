// TodayView.tsx: today's notes as a timeline, with edit, delete and "add an earlier note".
// Side panel: the highest % per MFO today, and how the cutoff is going. Runs in the RENDERER.
import { useEffect, useState } from 'react'
import PercentPicker from '../../components/PercentPicker'
import Pong from '../../components/Pong'
import TaskPicker from '../../components/TaskPicker'
import { useTasks, type Tasks } from '../../components/useTasks'
import { missedDays, periodFor } from '../../../../shared/cutoff'
import { localDate } from '../../../../shared/dates'
import { DEFAULT_SETTINGS, minutesOf } from '../../../../shared/settings'
import type { Entry, Output, Progress } from '../../../../shared/types'

// Colors per % (App board): pale teal at 25% to full teal at 100%.
export const PCT_STYLE: Record<number, { bg: string; fg: string; bar: string }> = {
  0.25: { bg: '#E3F1EF', fg: '#1F5E5A', bar: '#9FD0C8' },
  0.5: { bg: '#C9E5E0', fg: '#1F5E5A', bar: '#6FB5AB' },
  0.75: { bg: '#9FD0C8', fg: '#173F3C', bar: '#4C9E94' },
  1: { bg: '#2F7F7A', fg: '#FFFFFF', bar: '#2F7F7A' }
}

// '13:05' -> "1:05 PM"
export const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const longToday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

const shortRange = (start: string, end: string) => {
  const f = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(start)} – ${f(end)}`
}

export default function TodayView(props: { version: number; onChange: () => void; onCutoff: () => void }) {
  const today = localDate()
  const period = periodFor(today)
  const tasks = useTasks()
  const [entries, setEntries] = useState<Entry[]>([])
  const [attended, setAttended] = useState(0)
  const [missing, setMissing] = useState(0)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [lunch, setLunch] = useState(DEFAULT_SETTINGS.lunchStart)

  useEffect(() => {
    window.pong.entriesByDate(today).then(setEntries)
    window.pong.buildGrid(period).then((g) => setAttended(g.daysAttended))
    Promise.all([window.pong.entriesInPeriod(period), window.pong.dayStatusInPeriod(period)]).then(([e, s]) =>
      setMissing(missedDays(today, e, s).length)
    )
    window.pong.getSettings().then((s) => setLunch(s.lunchStart))
    tasks.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.version, today])

  const outputOf = (e: Entry) => tasks.outputs.find((o) => o.id === e.outputId)
  const dutyOf = (o: Output | undefined) => o && tasks.duties.find((d) => d.id === o.dutyId)

  // Today in your DAR: the highest % per MFO, in the order you first touched them.
  const best = new Map<number, Progress>()
  for (const e of entries) {
    if (e.outputId === null || e.progress === null) continue
    best.set(e.outputId, Math.max(best.get(e.outputId) ?? 0, e.progress) as Progress)
  }
  const touched = [...best.entries()].map(([id, pct]) => ({ output: tasks.outputs.find((o) => o.id === id), pct }))

  // Lunch shows between the last note before it and the first one after.
  const lunchAt = minutesOf(lunch)
  const minutes = (e: Entry) => minutesOf(e.createdAt.slice(11, 16))
  const lunchIndex = entries.findIndex((e) => minutes(e) >= lunchAt)
  const showLunch = lunchIndex > 0

  return (
    <div className="today">
      <section className="today-main">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="h-day">{longToday()}</span>
            <span className="muted" style={{ fontSize: 14 }}>
              {entries.length} {entries.length === 1 ? 'note' : 'notes'} · {touched.length} DAR{' '}
              {touched.length === 1 ? 'task' : 'tasks'} touched
            </span>
          </div>
          <div className="row">
            <button onClick={() => setEditing('new')}>+ Earlier note</button>
            <button className="primary" onClick={() => window.pong.openCheckin()}>
              Log a note
            </button>
          </div>
        </div>

        <div className="box timeline">
          {editing === 'new' && (
            <NoteEditor
              tasks={tasks}
              onCancel={() => setEditing(null)}
              onSave={async (draft) => {
                await window.pong.addEntry({ ...draft, workDate: today, source: 'manual' })
                setEditing(null)
                props.onChange()
              }}
            />
          )}
          {entries.length === 0 && editing !== 'new' && (
            <div className="empty">No notes yet today. Pong will ask, or press Ctrl+Alt+L.</div>
          )}
          {entries.map((e, i) => {
            const output = outputOf(e)
            const duty = dutyOf(output)
            const core = duty?.category !== 'support'
            return (
              <div key={e.id}>
                {showLunch && i === lunchIndex && (
                  <div className="lunch-row">
                    <span className="note-time">{time12(lunch)}</span>
                    <span className="dot" style={{ width: 8, height: 8, background: '#D8CDBB', border: 0 }} />
                    <em>Lunch break · Pong stayed quiet</em>
                  </div>
                )}
                {editing === e.id ? (
                  <NoteEditor
                    tasks={tasks}
                    entry={e}
                    onCancel={() => setEditing(null)}
                    onDelete={async () => {
                      if (!confirm('Delete this note?')) return
                      await window.pong.deleteEntry(e.id)
                      setEditing(null)
                      props.onChange()
                    }}
                    onSave={async (draft) => {
                      await window.pong.updateEntry(e.id, draft)
                      setEditing(null)
                      props.onChange()
                    }}
                  />
                ) : (
                  <div className={`note-row${i === entries.length - 1 ? ' latest' : ''}`}>
                    <span className="note-time">{time12(e.createdAt.slice(11, 16))}</span>
                    <span
                      className="dot"
                      style={{
                        background: output ? (core ? '#F5B83D' : '#8C7BC4') : '#D8CDBB',
                        boxShadow: `0 0 0 2px ${output ? (core ? '#F5B83D' : '#8C7BC4') : '#D8CDBB'}`
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="row">
                        <span className="note-text">{e.text}</span>
                        {i === entries.length - 1 && <span className="pill now">latest</span>}
                      </div>
                      {output && (
                        <div className="note-meta">
                          <span className={`pill ${core ? 'core' : 'support'}`}>{core ? 'Core' : 'Support'}</span>
                          <span>{output.title}</span>
                          {e.progress && (
                            <span
                              className="pill"
                              style={{ background: PCT_STYLE[e.progress].bg, color: PCT_STYLE[e.progress].fg }}
                            >
                              {e.progress === 1 ? '100% done' : `${e.progress * 100}%`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button className="ghost" aria-label="Edit note" onClick={() => setEditing(e.id)}>
                      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
                        <path d="M3 13l.8-3.2L10.5 3l2.5 2.5-6.8 6.7L3 13z" stroke="#6B6259" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <aside className="today-side">
        <div className="box side-card">
          <span className="side-title">Today in your DAR</span>
          {touched.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Tag a note to a task to see it here.</span>}
          {touched.map(({ output, pct }) => {
            const duty = dutyOf(output)
            return (
              <div key={output?.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.3 }}>{output?.title}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--teal-dark)' }}>
                    {pct === 1 ? 'Done' : `${pct * 100}%`}
                  </span>
                </div>
                <div className="bar">
                  <div style={{ width: `${pct * 100}%`, background: PCT_STYLE[pct].bar }} />
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {duty ? `${duty.category === 'core' ? 'Core' : 'Support'} · ${duty.title}` : ''}
                </span>
              </div>
            )
          })}
        </div>
        <button className="cutoff-card" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={props.onCutoff}>
          <Pong mood="peek" size={58} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--teal-dark)' }}>
              Cutoff: {shortRange(period.start, period.end)}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.4, fontWeight: 600 }}>
              {attended} {attended === 1 ? 'day' : 'days'} attended so far,{' '}
              {missing === 0 ? 'no missing days.' : `${missing} ${missing === 1 ? 'day' : 'days'} with no notes yet.`}{' '}
              Export is ready whenever you are.
            </span>
          </div>
        </button>
      </aside>
    </div>
  )
}

// Edit an existing note, or add one for an earlier time today.
function NoteEditor(props: {
  tasks: Tasks
  entry?: Entry
  onSave: (draft: { text: string; outputId: number | null; progress: Progress | null; time: string }) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const { entry } = props
  const [text, setText] = useState(entry?.text ?? '')
  const [outputId, setOutputId] = useState<number | null>(entry?.outputId ?? props.tasks.last?.outputId ?? null)
  const [progress, setProgress] = useState<Progress>(entry?.progress ?? 0.5)
  const [time, setTime] = useState(entry?.createdAt.slice(11, 16) ?? new Date().toTimeString().slice(0, 5))

  const save = () => {
    if (!text.trim()) return
    props.onSave({ text: text.trim(), outputId, progress: outputId === null ? null : progress, time })
  }

  return (
    <div className="edit-box">
      <div className="row">
        <input
          type="time"
          aria-label="Time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <input
          className="note-input"
          style={{ height: 44 }}
          autoFocus
          value={text}
          maxLength={1000}
          placeholder="What did you do?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') props.onCancel()
          }}
        />
      </div>
      <TaskPicker tasks={props.tasks} value={outputId} onChange={setOutputId} />
      {outputId !== null && <PercentPicker value={progress} onChange={setProgress} />}
      <div className="card-foot">
        <div className="row">
          {props.onDelete && (
            <button className="link" style={{ color: '#A3341F' }} onClick={props.onDelete}>
              Delete
            </button>
          )}
        </div>
        <div className="row">
          <button onClick={props.onCancel}>Cancel</button>
          <button className="teal" style={{ height: 40 }} onClick={save}>
            {entry ? 'Save' : 'Add note'}
          </button>
        </div>
      </div>
    </div>
  )
}
