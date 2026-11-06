// TasksView.tsx: manage duties and MFOs: add, rename, archive, mark done.
// Runs in the RENDERER; every change goes through window.pong (main writes SQLite).
// Archived duties and done MFOs drop off future DAR sheets, but stay on sheets where
// they already have a %.
import { useEffect, useState } from 'react'
import { useTasks } from '../../components/useTasks'
import type { Category, Duty, Output } from '../../../../shared/types'

const SECTIONS: { category: Category; title: string }[] = [
  { category: 'core', title: 'A.) Specific duties and responsibilities' },
  { category: 'support', title: 'B.) Support functions' }
]

export default function TasksView(props: { version: number; onChange: () => void }) {
  const tasks = useTasks()
  // A task added from the check-in card shows up here too.
  useEffect(() => {
    tasks.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.version])
  const [showArchived, setShowArchived] = useState(false)
  const [newDuty, setNewDuty] = useState<Record<Category, string>>({ core: '', support: '' })

  const reload = async () => {
    await tasks.reload()
    props.onChange()
  }

  async function addDuty(category: Category) {
    const title = newDuty[category].trim()
    if (!title) return
    await window.pong.addDuty(category, title)
    setNewDuty({ ...newDuty, [category]: '' })
    reload()
  }

  return (
    <div className="tasks">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="h-day">Duties and tasks</span>
          <span className="muted" style={{ fontSize: 14 }}>
            The rows of your DAR. Changes show on the next sheet you export.
          </span>
        </div>
        <label className="row" style={{ fontSize: 13, fontWeight: 700 }}>
          <input type="checkbox" style={{ height: 18 }} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.category} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ fontSize: 17 }}>{section.title}</h3>
          {tasks.duties
            .filter((d) => d.category === section.category && (showArchived || !d.archived))
            .map((duty, i) => (
              <DutyCard
                key={duty.id}
                number={i + 1}
                duty={duty}
                outputs={tasks.outputs.filter((o) => o.dutyId === duty.id)}
                showDone={showArchived}
                onChange={reload}
              />
            ))}
          <div className="task-line">
            <input
              placeholder={section.category === 'core' ? 'New duty, e.g. Frontend UI/UX Display fixes' : 'New support function'}
              value={newDuty[section.category]}
              maxLength={300}
              onChange={(e) => setNewDuty({ ...newDuty, [section.category]: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && addDuty(section.category)}
            />
            <button className="primary" onClick={() => addDuty(section.category)}>
              + Add duty
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}

function DutyCard(props: { number: number; duty: Duty; outputs: Output[]; showDone: boolean; onChange: () => void }) {
  const { duty } = props
  const [newTitle, setNewTitle] = useState('')

  async function addOutput() {
    if (!newTitle.trim()) return
    await window.pong.addOutput(duty.id, newTitle.trim())
    setNewTitle('')
    props.onChange()
  }

  return (
    <div className={`box duty-card${duty.archived ? ' archived' : ''}`}>
      <div className="task-line duty">
        <span style={{ fontWeight: 800, width: 22 }}>{props.number}.</span>
        <RenameInput
          value={duty.title}
          onSave={async (title) => {
            await window.pong.updateDuty(duty.id, { title })
            props.onChange()
          }}
        />
        <button
          onClick={async () => {
            await window.pong.updateDuty(duty.id, { archived: !duty.archived })
            props.onChange()
          }}
        >
          {duty.archived ? 'Restore' : 'Archive'}
        </button>
      </div>
      {props.outputs
        .filter((o) => props.showDone || o.status === 'active')
        .map((o) => (
          <div key={o.id} className={`task-line${o.status === 'done' ? ' done' : ''}`} style={{ paddingLeft: 30 }}>
            <RenameInput
              value={o.title}
              onSave={async (title) => {
                await window.pong.updateOutput(o.id, { title })
                props.onChange()
              }}
            />
            <button
              title={o.status === 'active' ? 'Finished: drops off future sheets' : 'Back on the list'}
              onClick={async () => {
                await window.pong.updateOutput(o.id, { status: o.status === 'active' ? 'done' : 'active' })
                props.onChange()
              }}
            >
              {o.status === 'active' ? 'Mark done' : 'Reopen'}
            </button>
          </div>
        ))}
      {!duty.archived && (
        <div className="task-line" style={{ paddingLeft: 30 }}>
          <input
            placeholder="New task (MFO)"
            value={newTitle}
            maxLength={300}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addOutput()}
          />
          <button onClick={addOutput}>+ Add task</button>
        </div>
      )}
    </div>
  )
}

// A text box that saves when you press Enter or click away, if the text changed.
function RenameInput(props: { value: string; onSave: (value: string) => void }) {
  const [text, setText] = useState(props.value)
  const save = () => {
    if (text.trim() && text.trim() !== props.value) props.onSave(text.trim())
    else setText(props.value)
  }
  return (
    <input
      value={text}
      maxLength={300}
      aria-label="Name"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(props.value)
      }}
    />
  )
}
