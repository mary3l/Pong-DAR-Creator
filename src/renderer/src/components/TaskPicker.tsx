// TaskPicker.tsx: "Which DAR task?" Five recent MFOs as chips, an "All tasks…" picker
// for any other MFO, and "+ New task", which opens a small panel to add a new one
// under a duty (or under a new duty, picked as "+ New duty" in A.) or B.)).
// Runs in the RENDERER; new duties and MFOs are saved through window.pong (main).
import { useState, type KeyboardEvent } from 'react'
import type { Category, Output } from '../../../shared/types'
import { dutyLine, dutyTag, type Tasks } from './useTasks'

export default function TaskPicker(props: {
  tasks: Tasks
  value: number | null // the selected MFO's id, or null for a plain note
  onChange: (outputId: number | null) => void
}) {
  const { tasks, value, onChange } = props
  const [open, setOpen] = useState(false)
  // A duty's id, or 'new-core' / 'new-support' to add a duty first. '' = nothing picked.
  const [dutyId, setDutyId] = useState<number | 'new-core' | 'new-support' | ''>('')
  const [dutyTitle, setDutyTitle] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const selected = tasks.outputs.find((o) => o.id === value)
  // The selected MFO always shows as a chip, even when it isn't one of the recent five.
  const chips: Output[] =
    selected && !tasks.recent.some((o) => o.id === selected.id) ? [...tasks.recent, selected] : tasks.recent
  const activeDuties = tasks.duties.filter((d) => !d.archived)
  // "All tasks…" lists the active MFOs that aren't already a chip.
  const others = tasks.outputs.filter(
    (o) => o.status === 'active' && activeDuties.some((d) => d.id === o.dutyId) && !chips.some((c) => c.id === o.id)
  )
  // Only duties with something to pick get a group: no empty headings.
  const otherDuties = activeDuties.filter((d) => others.some((o) => o.dutyId === d.id))

  // With no duties yet, there's nothing to pick: start with a new A.) duty.
  const duty = dutyId === '' && activeDuties.length === 0 ? 'new-core' : dutyId
  const newDuty = duty === 'new-core' || duty === 'new-support'

  async function create() {
    if (duty === '' || !title.trim() || (newDuty && !dutyTitle.trim())) {
      setError(newDuty ? 'Type the duty and the task name.' : 'Pick a duty and type the task name.')
      return
    }
    try {
      const category: Category = duty === 'new-support' ? 'support' : 'core'
      const parentId = newDuty ? (await window.pong.addDuty(category, dutyTitle.trim())).id : (duty as number)
      const output = await window.pong.addOutput(parentId, title.trim())
      await tasks.reload()
      onChange(output.id)
      setTitle('')
      setDutyTitle('')
      setDutyId('')
      setError('')
      setOpen(false)
    } catch (e) {
      setError(String(e).replace(/^.*Error: /, ''))
    }
  }

  // Enter in the title box adds the task; it must not also save the whole note.
  function onTitleKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      create()
    }
  }

  return (
    <div className="field">
      <span className="field-label">Which DAR task?</span>
      <div className="chips">
        {chips.map((o) => (
          <button
            key={o.id}
            type="button"
            className="chip task"
            title={`${o.title}
${dutyTag(o, tasks.duties)}`}
            aria-pressed={o.id === value}
            // Clicking the selected chip again untags the note.
            onClick={() => onChange(o.id === value ? null : o.id)}
          >
            <span className="chip-title">{o.short || o.title}</span>
            <span className="chip-duty">{dutyTag(o, tasks.duties)}</span>
          </button>
        ))}
        {/* Every active task, grouped by duty, for the ones not among the recent chips.
            Picking one makes it the selected chip. */}
        {others.length > 0 && (
          <select
            className="chip all"
            aria-label="All tasks"
            value=""
            onChange={(e) => {
              onChange(Number(e.target.value))
              setOpen(false)
            }}
          >
            <option value="">All tasks…</option>
            {otherDuties.map((d) => (
              <optgroup key={d.id} label={`${d.category === 'core' ? 'A.)' : 'B.)'} ${d.title}`}>
                {others
                  .filter((o) => o.dutyId === d.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        )}
        <button type="button" className="chip new" aria-expanded={open} onClick={() => setOpen(!open)}>
          + New task
        </button>
      </div>

      {open && (
        <div className="panel">
          <span className="hint">Add a new task (MFO):</span>
          <select
            aria-label="Duty"
            value={duty}
            onChange={(e) => {
              const v = e.target.value
              setDutyId(v === '' || v === 'new-core' || v === 'new-support' ? v : Number(v))
            }}
          >
            <option value="">Under which duty?</option>
            {/* The group headings (A.), B.)) can't be picked; "+ New duty" under each can. */}
            <optgroup label="A.) Specific duties">
              {activeDuties
                .filter((d) => d.category === 'core')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              <option value="new-core">+ New duty in A.) Specific duties…</option>
            </optgroup>
            <optgroup label="B.) Support functions">
              {activeDuties
                .filter((d) => d.category === 'support')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              <option value="new-support">+ New duty in B.) Support functions…</option>
            </optgroup>
          </select>
          {newDuty && (
            <input
              aria-label="New duty name"
              placeholder={duty === 'new-core' ? 'New duty, e.g. Frontend UI/UX Display fixes' : 'New support function'}
              value={dutyTitle}
              maxLength={300}
              onChange={(e) => setDutyTitle(e.target.value)}
              onKeyDown={onTitleKey}
            />
          )}
          <div className="row">
            <input
              aria-label="New task name"
              placeholder="e.g. GIS Location Map for PIPs"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={onTitleKey}
            />
            <button type="button" className="primary" onClick={create}>
              Add
            </button>
          </div>
          {activeDuties.length === 0 && (
            <span className="hint">
              No duties yet. Type one above, or load them from your DAR workbook: Settings, DAR profile, Choose….
            </span>
          )}
          {error && <span className="error">{error}</span>}
        </div>
      )}

      <span className="hint">{dutyLine(selected, tasks.duties)}</span>
    </div>
  )
}
