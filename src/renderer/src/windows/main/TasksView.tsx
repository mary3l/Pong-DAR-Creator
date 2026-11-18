// TasksView.tsx: manage duties and MFOs: add, rename, archive, mark done, and drag a
// task to another duty (or onto another task, to merge the two).
// Runs in the RENDERER; every change goes through window.pong (main writes SQLite).
// Archived duties and done MFOs drop off future DAR sheets, but stay on sheets where
// they already have a %. Those still on this cutoff's sheet always show here, even with
// "Show archived" off, so what you see matches the sheet and you can drag them.
import { useEffect, useState, type DragEvent } from 'react'
import { useTasks } from '../../components/useTasks'
import { periodFor } from '../../../../shared/cutoff'
import { localDate } from '../../../../shared/dates'
import type { Category, Duty, Output } from '../../../../shared/types'

const SECTIONS: { category: Category; title: string }[] = [
  { category: 'core', title: 'A.) Specific duties and responsibilities' },
  { category: 'support', title: 'B.) Support functions' }
]

// What a drop is about to do, once you confirm: merge `from` into `into`.
interface PendingMerge {
  from: Output
  into: Output
}

const sameTitle = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export default function TasksView(props: { version: number; onChange: () => void }) {
  const tasks = useTasks()
  // A task added from the check-in card shows up here too.
  useEffect(() => {
    tasks.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.version])
  const [showArchived, setShowArchived] = useState(false)
  const [newDuty, setNewDuty] = useState<Record<Category, string>>({ core: '', support: '' })
  // Drag and drop: the task being dragged, and where it would land.
  const [dragging, setDragging] = useState<Output | null>(null)
  const [merge, setMerge] = useState<PendingMerge | null>(null)
  const [notice, setNotice] = useState('')
  // MFOs with a % in the current cutoff: they're on its sheet even if done or archived.
  const [onSheet, setOnSheet] = useState<Set<number>>(new Set())
  useEffect(() => {
    window.pong
      .entriesInPeriod(periodFor(localDate()))
      .then((entries) => setOnSheet(new Set(entries.flatMap((e) => (e.outputId === null ? [] : [e.outputId])))))
  }, [tasks.outputs])

  const reload = async () => {
    await tasks.reload()
    props.onChange()
  }

  const dutyName = (id: number) => tasks.duties.find((d) => d.id === id)?.title ?? 'another duty'

  async function addDuty(category: Category) {
    const title = newDuty[category].trim()
    if (!title) return
    await window.pong.addDuty(category, title)
    setNewDuty({ ...newDuty, [category]: '' })
    reload()
  }

  async function move(from: Output, duty: Duty) {
    await window.pong.moveOutput(from.id, duty.id)
    setNotice(`Moved "${from.title}" to ${duty.title}.`)
    setMerge(null)
    reload()
  }

  async function doMerge(m: PendingMerge) {
    await window.pong.mergeOutput(m.from.id, m.into.id)
    setNotice(`Merged: the notes of "${m.from.title}" are now in the row "${m.into.title}" under ${dutyName(m.into.dutyId)}.`)
    setMerge(null)
    reload()
  }

  // Dropped on a duty card (target = null) or on one of its tasks (target = that task).
  function drop(duty: Duty, target: Output | null) {
    const from = dragging
    setDragging(null)
    if (!from) return
    if (target && target.id !== from.id) {
      setMerge({ from, into: target }) // onto another task: always ask first
      return
    }
    if (from.dutyId === duty.id) return // dropped where it already is
    // Same name already under this duty: merging is almost always what you want.
    const twin = tasks.outputs.find((o) => o.dutyId === duty.id && o.id !== from.id && sameTitle(o.title, from.title))
    if (twin) setMerge({ from, into: twin })
    else move(from, duty)
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
      <span className="hint" style={{ marginTop: -8 }}>
        Wrong duty? Drag a task by its <b>⠿</b> handle onto another duty; its notes and % go with it. Drop it on another task
        to merge the two. Tick Show archived to see finished tasks too.
      </span>
      {notice && (
        <div className="tasks-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice('')}>OK</button>
        </div>
      )}

      {SECTIONS.map((section) => (
        <section key={section.category} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ fontSize: 17 }}>{section.title}</h3>
          {tasks.duties
            .filter(
              (d) =>
                d.category === section.category &&
                (showArchived || !d.archived || tasks.outputs.some((o) => o.dutyId === d.id && onSheet.has(o.id)))
            )
            .map((duty, i) => (
              <DutyCard
                key={duty.id}
                number={i + 1}
                duty={duty}
                outputs={tasks.outputs.filter((o) => o.dutyId === duty.id)}
                showDone={showArchived}
                onSheet={onSheet}
                dragging={dragging}
                onDragStart={(o) => {
                  setDragging(o)
                  setMerge(null)
                  setNotice('')
                }}
                onDragEnd={() => setDragging(null)}
                onDrop={(target) => drop(duty, target)}
                merge={merge && merge.into.dutyId === duty.id ? merge : null}
                mergeFromDuty={merge ? dutyName(merge.from.dutyId) : ''}
                onMerge={doMerge}
                onMoveInstead={(m) => move(m.from, duty)}
                onCancelMerge={() => setMerge(null)}
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

function DutyCard(props: {
  number: number
  duty: Duty
  outputs: Output[]
  showDone: boolean
  onSheet: Set<number> // MFOs with a % in this cutoff
  dragging: Output | null
  onDragStart: (o: Output) => void
  onDragEnd: () => void
  onDrop: (target: Output | null) => void
  merge: PendingMerge | null // a merge into one of this card's tasks, waiting for OK
  mergeFromDuty: string
  onMerge: (m: PendingMerge) => void
  onMoveInstead: (m: PendingMerge) => void
  onCancelMerge: () => void
  onChange: () => void
}) {
  const { duty, dragging } = props
  const [newTitle, setNewTitle] = useState('')
  // Highlight: 'card' when a drop here would move the task, or the id of the task it would merge into.
  const [over, setOver] = useState<'card' | number | null>(null)

  // Archived duties take no drops (a task there would vanish from the check-in card),
  // but you can still drag tasks out of them.
  const canDrop = dragging !== null && !duty.archived

  async function addOutput() {
    if (!newTitle.trim()) return
    await window.pong.addOutput(duty.id, newTitle.trim())
    setNewTitle('')
    props.onChange()
  }

  // dragover must call preventDefault() or the browser refuses the drop.
  const allow = (target: 'card' | number) => (event: DragEvent) => {
    if (!canDrop) return
    event.preventDefault()
    event.stopPropagation() // a task row inside the card wins over the card itself
    event.dataTransfer.dropEffect = 'move'
    setOver(target)
  }
  const dropOn = (target: Output | null) => (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setOver(null)
    props.onDrop(target)
  }
  const leave = (event: DragEvent) => {
    // Only when the pointer really leaves the card, not when it moves onto a child.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
  }

  const cardClass = [
    'box duty-card',
    duty.archived ? 'archived' : '',
    canDrop && dragging.dutyId !== duty.id ? 'droppable' : '',
    canDrop && over === 'card' && dragging.dutyId !== duty.id ? 'drop-over' : ''
  ].join(' ')

  return (
    <div className={cardClass} onDragOver={allow('card')} onDragLeave={leave} onDrop={dropOn(null)}>
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
      {duty.archived && !props.showDone && (
        <span className="hint" style={{ paddingLeft: 30 }}>
          Archived, but still on this cutoff's sheet: it has a % here. If these notes belong to another duty, drag each
          task there.
        </span>
      )}
      {props.outputs
        .filter((o) => props.showDone || o.status === 'active' || props.onSheet.has(o.id) || props.merge?.into.id === o.id)
        .map((o) => (
          <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              className={[
                'task-line',
                o.status === 'done' ? 'done' : '',
                dragging?.id === o.id ? 'dragging' : '',
                dragging && over === o.id && dragging.id !== o.id ? 'merge-over' : ''
              ].join(' ')}
              style={{ paddingLeft: 8 }}
              onDragOver={dragging?.id === o.id ? undefined : allow(o.id)}
              onDrop={dragging?.id === o.id ? undefined : dropOn(o)}
            >
              <span
                className="grip"
                draggable
                title="Drag to another duty, or onto another task to merge"
                aria-label={`Move ${o.title}`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', o.title)
                  // Show the whole row under the pointer, not just the little handle.
                  const row = event.currentTarget.parentElement
                  if (row) event.dataTransfer.setDragImage(row, 12, 18)
                  props.onDragStart(o)
                }}
                onDragEnd={props.onDragEnd}
              >
                ⠿
              </span>
              <RenameInput
                value={o.title}
                onSave={async (title) => {
                  await window.pong.updateOutput(o.id, { title })
                  props.onChange()
                }}
              />
              {o.status === 'done' && props.onSheet.has(o.id) && (
                <span className="sheet-tag" title="Done, but it has a % in this cutoff, so it stays on this sheet">
                  Done · on this sheet
                </span>
              )}
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
            {props.merge?.into.id === o.id && (
              <MergeBar
                merge={props.merge}
                fromDuty={props.mergeFromDuty}
                sameDuty={props.merge.from.dutyId === duty.id}
                onMerge={props.onMerge}
                onMoveInstead={props.onMoveInstead}
                onCancel={props.onCancelMerge}
              />
            )}
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

// "Merge these two?" A merge deletes a row, so it always asks first.
function MergeBar(props: {
  merge: PendingMerge
  fromDuty: string
  sameDuty: boolean
  onMerge: (m: PendingMerge) => void
  onMoveInstead: (m: PendingMerge) => void
  onCancel: () => void
}) {
  const { from, into } = props.merge
  const twin = sameTitle(from.title, into.title)
  return (
    <div className="merge-bar" role="alertdialog" aria-label="Merge tasks">
      <span>
        {twin ? (
          <>
            <b>"{into.title}"</b> is already here.{' '}
          </>
        ) : null}
        Merge <b>"{from.title}"</b>
        {props.sameDuty ? '' : ` (under ${props.fromDuty})`} into {twin ? 'it' : <b>"{into.title}"</b>}? Its notes and %
        move to this row, and the other row is removed.
      </span>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={() => props.onMerge(props.merge)}>
          Merge
        </button>
        {!props.sameDuty && <button onClick={() => props.onMoveInstead(props.merge)}>Just move it</button>}
        <button onClick={props.onCancel}>Cancel</button>
      </div>
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
