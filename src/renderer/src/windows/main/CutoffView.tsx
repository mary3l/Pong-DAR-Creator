// CutoffView.tsx: the DAR for one cutoff, laid out like the real sheet, and the Export
// button. Click a weekday's date to cycle Sick Leave, Personal Leave, Holiday. Runs in the RENDERER.
import { useEffect, useState, type CSSProperties } from 'react'
import Pong from '../../components/Pong'
import { periodFor, type DarGrid, type GridDuty } from '../../../../shared/cutoff'
import { addDays, isWeekend, localDate } from '../../../../shared/dates'
import type { DayStatus, DayType, Entry, ExportRecord, ExportResult, Period, Profile } from '../../../../shared/types'
import { PCT_STYLE, time12 } from './TodayView'

// Clicking a weekday's date: work day -> sick -> personal -> holiday -> work day.
const NEXT: Record<DayType | 'work', DayType | null> = {
  work: 'sick',
  rest: 'sick',
  sick: 'personal',
  personal: 'holiday',
  holiday: null
}
const SHORT_LABEL: Record<string, string> = {
  'Rest Day': 'Rest Day',
  'Sick Leave': 'Sick Leave',
  'Personal Leave': 'Pers. Leave',
  Holiday: 'Hol.'
}
const NAMES: Record<DayType | 'work', string> = {
  work: 'work day',
  rest: 'rest day',
  sick: 'sick leave',
  personal: 'personal leave',
  holiday: 'holiday'
}

const stamp = (ts: string) =>
  new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function CutoffView(props: { version: number; onChange: () => void }) {
  const today = localDate()
  const [period, setPeriod] = useState<Period>(periodFor(today))
  const [grid, setGrid] = useState<DarGrid | null>(null)
  const [statuses, setStatuses] = useState<DayStatus[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [target, setTarget] = useState('your workbook')
  const [last, setLast] = useState<ExportRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState('')
  const [codesRow, setCodesRow] = useState(true)
  // The % cell you clicked: its notes show under the grid.
  const [picked, setPicked] = useState<{ outputId: number; date: string; title: string } | null>(null)

  useEffect(() => setPicked(null), [period])

  useEffect(() => {
    window.pong.getSettings().then((s) => setCodesRow(s.codesRow))
    window.pong.buildGrid(period).then(setGrid)
    window.pong.dayStatusInPeriod(period).then(setStatuses)
    window.pong.entriesInPeriod(period).then(setEntries)
    window.pong.getProfile().then(setProfile)
    window.pong.exportTarget().then((t) => setTarget(t.name))
    window.pong.lastExport(period).then(setLast)
  }, [period, props.version])

  const current = periodFor(today)
  const isCurrent = period.start === current.start

  async function cycle(date: string) {
    const status = statuses.find((s) => s.date === date)?.type ?? 'work'
    await window.pong.setDayStatus(date, NEXT[status])
    setResult(null)
    props.onChange()
  }

  // First try without replacing; if this cutoff already has a sheet, ask first.
  async function exportSheet() {
    if (!grid) return
    setBusy(true)
    setError('')
    try {
      let r: ExportResult
      try {
        r = await window.pong.exportDar(period, false)
      } catch (e) {
        if (!String(e).includes('already has a sheet') || !confirm(`Replace the sheet "${grid.sheetName}"?`)) throw e
        r = await window.pong.exportDar(period, true)
      }
      setResult(r)
      props.onChange()
    } catch (e) {
      // "Error invoking remote method 'dar:export': Error: ..." -> just the message
      setError(String(e).replace(/^.*Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    try {
      await window.pong.undoExport()
      setResult(null)
      props.onChange() // reloads "Last added ..."

    } catch (e) {
      setError(String(e).replace(/^.*Error: /, ''))
    }
  }

  if (!grid) return null

  const logged = new Set(entries.map((e) => e.workDate))
  // The notes behind each % cell: "<outputId>|<date>" -> notes, oldest first.
  const notes = new Map<string, Entry[]>()
  for (const e of entries) {
    if (e.outputId === null || e.progress === null) continue
    const key = `${e.outputId}|${e.workDate}`
    notes.set(key, [...(notes.get(key) ?? []), e])
  }
  const pickedNotes = picked ? (notes.get(`${picked.outputId}|${picked.date}`) ?? []) : []
  const missing = grid.days.filter((d) => d.date < today && !d.off && !logged.has(d.date)).length
  const mfoCount = [...grid.core, ...grid.support].reduce((n, b) => n + b.rows.length, 0)
  const cols = `28px 160px minmax(180px, 1fr) repeat(${grid.days.length}, 31px)`
  const blockProps = { grid, cols, today, statuses, notes, picked, onPick: setPicked }

  return (
    <div className="cutoff">
      <div className="period-nav">
        <button aria-label="Previous cutoff" onClick={() => setPeriod(periodFor(addDays(period.start, -1)))}>
          ‹
        </button>
        <span className="h-day" style={{ fontSize: 22 }}>
          {grid.sheetName}
        </span>
        <button aria-label="Next cutoff" disabled={isCurrent} onClick={() => setPeriod(periodFor(addDays(period.end, 1)))}>
          ›
        </button>
        {!isCurrent && (
          <button style={{ width: 'auto', padding: '0 12px' }} onClick={() => setPeriod(current)}>
            This cutoff
          </button>
        )}
        {/* Cutoff reloads by itself after every save; this is for peace of mind. */}
        <button style={{ width: 'auto', padding: '0 12px' }} title="Read the notes and tasks again" onClick={props.onChange}>
          ↻ Reload
        </button>
        <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }}>
          {last ? `Last added to ${target} ${stamp(last.exportedAt)}` : 'Not exported yet'}
        </span>
      </div>

      <div className="box profile-grid">
        <Field label="Name of JOE" value={profile?.name} />
        <Field label="Department · Unit" value={[profile?.department, profile?.unit].filter(Boolean).join(' · ')} />
        <Field label="Period covered" value={grid.sheetName} />
        <Field label="Position title" value={profile?.position} />
        <Field label="Team leader" value={profile?.teamLeader} />
        <Field label="Actual no. of days attended" value={`${grid.daysAttended}${isCurrent ? ' so far' : ''}`} />
      </div>

      <div className="dar">
        <div className="dar-grid dar-head" style={{ gridTemplateColumns: cols }}>
          <div className="cell-head" style={{ gridColumn: '1 / span 2', gridRow: '1 / span 2' }}>
            FUNCTIONS
          </div>
          <div className="cell-head" style={{ gridColumn: 3, gridRow: '1 / span 2' }}>
            MAJOR FINAL OUTPUT (MFOs)
          </div>
          {grid.days.map((d, i) => {
            const status: DayType | 'work' = statuses.find((s) => s.date === d.date)?.type ?? 'work'
            const style: CSSProperties = { gridColumn: 4 + i, gridRow: '1 / span 2' }
            const num = Number(d.date.slice(8))
            const className = `day-head${d.date === today ? ' today' : ''}`
            if (isWeekend(d.date)) {
              return (
                <div key={d.date} className={className} style={style}>
                  <span>{num}</span>
                  <span>{d.dayName}</span>
                </div>
              )
            }
            return (
              <button
                key={d.date}
                className={className}
                style={style}
                aria-label={`${d.date}, ${d.dayName}: ${NAMES[status]}. Click to change.`}
                title="Click to mark sick leave, personal leave or a holiday"
                onClick={() => cycle(d.date)}
              >
                <span>{num}</span>
                <span>{d.dayName}</span>
              </button>
            )
          })}
        </div>

        <div className="dar-section">A.) SPECIFIC DUTIES AND RESPONSIBILITIES</div>
        {grid.core.map((block, i) => (
          <DutyBlock key={block.duty.id} block={block} number={i + 1} codes={codesRow} {...blockProps} />
        ))}
        <div className="dar-section">B.) SUPPORT FUNCTIONS</div>
        {grid.support.map((block, i) => (
          <DutyBlock key={block.duty.id} block={block} number={i + 1} codes={false} {...blockProps} />
        ))}
      </div>

      {picked && pickedNotes.length > 0 && (
        <div className="cell-notes">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span className="cell-notes-title">
              {new Date(`${picked.date}T00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              {' · '}
              {picked.title}
            </span>
            <button className="ghost" aria-label="Close the notes" onClick={() => setPicked(null)}>
              ✕
            </button>
          </div>
          {pickedNotes.map((e) => (
            <div key={e.id} className="cell-note">
              <span className="note-time">{time12(e.createdAt.slice(11, 16))}</span>
              <span>{e.text}</span>
              <span className="pill" style={{ background: PCT_STYLE[e.progress!].bg, color: PCT_STYLE[e.progress!].fg }}>
                {e.progress! * 100}%
              </span>
            </div>
          ))}
          <span className="muted" style={{ fontSize: 12 }}>
            {pickedNotes.length > 1
              ? 'The DAR cell shows the highest % of these. The notes stay in Pong; only the % goes on the sheet.'
              : 'The note stays in Pong; only the % goes on the sheet.'}
          </span>
        </div>
      )}

      <div className="legend">
        <span>
          <i style={{ background: '#8497B0' }} />
          Highest % logged that day
        </span>
        <span>
          <i style={{ background: '#808080' }} />
          Rest Day, Sick or Pers. Leave, Holiday
        </span>
        <span>
          <i style={{ background: '#C9C9C9' }} />
          Weekend ahead (fills in when it happens)
        </span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            style={{ height: 14 }}
            checked={codesRow}
            onChange={async (e) => {
              const on = e.target.checked
              setCodesRow(on) // the preview changes now; the next export follows the setting
              setResult(null)
              await window.pong.setSettings({ codesRow: on })
            }}
          />
          Show "Codes for the following:" in A.)
        </label>
      </div>

      {error && <span className="error">{error}</span>}

      {result ? (
        <div className="export-done">
          <Pong mood="happy" size={52} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--teal-dark)' }}>
              Added "{result.sheetName}" to {target}
            </span>
            <span style={{ fontSize: 13 }}>Header, dates, % cells, days off and signatories filled in. A backup of the workbook as it was is kept next to it.</span>
          </div>
          <button className="teal" style={{ height: 44 }} onClick={() => window.pong.openWorkbook()}>
            Open in Excel
          </button>
          <button onClick={undo}>Undo</button>
        </div>
      ) : (
        <div className="export-bar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>
              {grid.daysAttended} days attended · {mfoCount} MFOs ·{' '}
              {missing === 0 ? 'no missing days' : `${missing} ${missing === 1 ? 'weekday' : 'weekdays'} with no notes`}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              Click a % to see the notes behind it. Click a weekday's date to mark sick leave, personal leave or a holiday.
            </span>
          </div>
          <button className="big-teal" disabled={busy} onClick={exportSheet}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
              <path d="M9 2v9M5 7l4 4 4-4M3 14h12" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {busy ? 'Writing the sheet…' : `Add sheet to ${target}`}
          </button>
        </div>
      )}
    </div>
  )
}

function Field(props: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span>{props.label}</span>
      <span>{props.value || '—'}</span>
    </div>
  )
}

// One duty: number and title down the block, "Codes for the following:" (core only),
// then one MFO per row with a cell per day. A day off is one gray box down the block.
function DutyBlock(props: {
  block: GridDuty
  number: number
  codes: boolean
  grid: DarGrid
  cols: string
  today: string
  statuses: DayStatus[]
  notes: Map<string, Entry[]>
  picked: { outputId: number; date: string } | null
  onPick: (cell: { outputId: number; date: string; title: string }) => void
}) {
  const { block, codes, grid, today } = props
  const lines = [...(codes ? [null] : []), ...block.rows]
  const span = Math.max(1, lines.length)
  const lineBorder = (i: number) => (i === span - 1 ? 'none' : '1px solid #E4E4E4')

  return (
    <div className="dar-grid" style={{ gridTemplateColumns: props.cols }}>
      <div className="dar-num" style={{ gridColumn: 1, gridRow: `1 / span ${span}` }}>
        {props.number}.
      </div>
      <div className="dar-duty" style={{ gridColumn: 2, gridRow: `1 / span ${span}` }}>
        {block.duty.title}
      </div>
      {lines.length === 0 && <div className="dar-mfo" style={{ gridColumn: 3, gridRow: 1 }} />}
      {lines.map((row, i) => (
        <div
          key={row?.output.id ?? 'codes'}
          className="dar-mfo"
          style={{ gridColumn: 3, gridRow: i + 1, borderBottom: lineBorder(i), paddingLeft: codes && row ? 14 : 6 }}
        >
          {row ? row.output.title : 'Codes for the following:'}
        </div>
      ))}
      {grid.days.map((d, di) => {
        const col = 4 + di
        if (d.off) {
          const ahead = d.date > today && !props.statuses.some((s) => s.date === d.date)
          return (
            <div
              key={d.date}
              className="dar-cell"
              style={{ gridColumn: col, gridRow: `1 / span ${span}`, background: ahead ? '#C9C9C9' : '#808080', fontSize: 9.5 }}
            >
              {SHORT_LABEL[d.off] ?? d.off}
            </div>
          )
        }
        return Array.from({ length: span }, (_, i) => {
          const row = lines[i]
          const value = row ? row.cells[di] : null
          const pick = row && value ? { outputId: row.output.id, date: d.date, title: row.output.title } : null
          const isPicked = pick !== null && props.picked?.outputId === pick.outputId && props.picked.date === pick.date
          return (
            <div
              key={`${d.date}-${i}`}
              className={`dar-cell${pick ? ' has-notes' : ''}${isPicked ? ' picked' : ''}`}
              // A % cell works like a button: click or Enter shows its notes under the grid.
              role={pick ? 'button' : undefined}
              tabIndex={pick ? 0 : undefined}
              aria-label={pick ? `${pick.title}, ${d.date}: ${value! * 100}%. Show the notes.` : undefined}
              onClick={pick ? () => props.onPick(pick) : undefined}
              onKeyDown={pick ? (e) => e.key === 'Enter' && props.onPick(pick) : undefined}
              style={{
                gridColumn: col,
                gridRow: i + 1,
                borderBottom: lineBorder(i),
                background: value ? '#8497B0' : d.date === today ? '#FFF8E6' : '#FFFFFF'
              }}
            >
              {value ? `${value * 100}%` : ''}
            </div>
          )
        })
      })}
    </div>
  )
}
