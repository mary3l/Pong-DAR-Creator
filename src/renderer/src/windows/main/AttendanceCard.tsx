// AttendanceCard.tsx: today's time-in, lunch and time-out in the Today view's side panel,
// with OT (work days) or extended hours (weekends, holidays) and its approval.
// Runs in the RENDERER. Every time is editable: a fix goes to main through
// window.pong.setAttendance, which checks it (no time-out before the time-in).
// Earlier days of the cutoff that still need something (a missing time-out, an approval
// still "Not yet") are listed under it.
import { useEffect, useState } from 'react'
import { countedMinutes, DAY_STARTS_HOUR, extraKind, formatMinutes, hhmm, isOpen, stampAt } from '../../../../shared/attendance'
import { dayLong, periodFor } from '../../../../shared/cutoff'
import { addDays, localDate, localTimestamp, time12 } from '../../../../shared/dates'
import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/settings'
import type { Approval, Attendance, AttendanceChanges } from '../../../../shared/types'

const APPROVAL_LABEL: Record<Approval, string> = { yes: 'Approved', pending: 'Not yet', no: 'Not approved' }

// A typed time on a day's session. Only a time before 5 AM that comes before the time-in
// is read as after midnight (out at 00:30 after OT). Anything else stays on the day, so
// a time-out typed earlier than the time-in is refused by main, not turned into a
// 21-hour session.
const sessionStamp = (rec: Attendance, time: string): string =>
  Number(time.slice(0, 2)) < DAY_STARTS_HOUR ? stampAt(rec.date, time, rec.timeIn) : stampAt(rec.date, time)

export default function AttendanceCard(props: { version: number }) {
  const today = localDate()
  const [rec, setRec] = useState<Attendance | null>(null)
  const [earlier, setEarlier] = useState<Attendance[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [error, setError] = useState('')
  // Re-render every minute while timed in, so "OT so far" keeps up.
  const [, setTick] = useState(0)

  useEffect(() => {
    window.pong.getAttendance(today).then(setRec)
    window.pong.getSettings().then(setSettings)
    // This cutoff and the one before: a session left open on the 2nd still shows on the 3rd.
    const from = periodFor(addDays(periodFor(today).start, -1)).start
    window.pong.attendanceInPeriod({ start: from, end: addDays(today, -1) }).then((all) =>
      setEarlier(all.filter((a) => a.date < today && a.timeIn && (!a.timeOut || a.approved === 'pending')))
    )
  }, [props.version, today])

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!settings.attendance) return null

  const save = async (date: string, changes: AttendanceChanges) => {
    try {
      setError('')
      await window.pong.setAttendance(date, changes) // main tells every window to reload
    } catch (e) {
      setError(String(e).replace(/^.*Bad argument: /, 'Check the times: '))
    }
  }

  return (
    <div className="box side-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="side-title">Attendance</span>
        {rec?.nonWorkDay && <span className="pill core">Extended hours</span>}
      </div>

      {rec === null && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 13 }}>Not timed in yet.</span>
          <button className="teal" style={{ height: 36 }} onClick={() => window.pong.pongAction('time-in')}>
            Time in
          </button>
        </div>
      )}

      {rec !== null && !rec.timeIn && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 13 }}>Not working today.</span>
          <button style={{ height: 36 }} onClick={() => window.pong.pongAction('time-in')}>
            Time in now
          </button>
        </div>
      )}

      {rec?.timeIn && <DayTimes rec={rec} settings={settings} onSave={(c) => save(rec.date, c)} />}

      {earlier.map((a) => (
        <div key={a.date} className="att-earlier">
          <span style={{ fontSize: 13, fontWeight: 800 }}>{dayLong(a.date)}</span>
          {!a.timeOut ? (
            <TimeField
              label="No time-out. Left at"
              value={null}
              onSave={(t) => t && save(a.date, { timeOut: sessionStamp(a, t) })}
            />
          ) : (
            <ApprovalPicker rec={a} settings={settings} onSave={(approved) => save(a.date, { approved })} />
          )}
        </div>
      ))}

      {error && <span className="error">{error}</span>}
    </div>
  )
}

// Time in, lunch, time out and the extra time for one day.
function DayTimes(props: { rec: Attendance; settings: Settings; onSave: (changes: AttendanceChanges) => void }) {
  const { rec, settings } = props
  const open = isOpen(rec)
  const minutes = countedMinutes(rec, settings, open ? localTimestamp() : undefined)
  const stamp = (t: string | null) => (t ? sessionStamp(rec, t) : null)
  const showLunch = settings.trackLunch || rec.lunchOut !== null

  return (
    <>
      <div className="att-times">
        <TimeField label="Time in" value={rec.timeIn} onSave={(t) => t && props.onSave({ timeIn: stampAt(rec.date, t) })} />
        {showLunch && <TimeField label="Lunch out" value={rec.lunchOut} onSave={(t) => props.onSave({ lunchOut: stamp(t) })} />}
        {showLunch && <TimeField label="Back" value={rec.lunchIn} onSave={(t) => props.onSave({ lunchIn: stamp(t) })} />}
        <TimeField label="Time out" value={rec.timeOut} onSave={(t) => props.onSave({ timeOut: stamp(t) })} />
      </div>

      {open && (
        <button className="teal" style={{ height: 36, alignSelf: 'flex-start' }} onClick={() => window.pong.pongAction('time-out')}>
          Time out
        </button>
      )}

      {(minutes > 0 || rec.approved !== null) && (
        <div className="att-extra">
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>
            {rec.nonWorkDay ? 'Extended hours' : 'OT'}
            {open ? ' so far' : ''}: {formatMinutes(minutes)}
          </span>
          {!open && <ApprovalPicker rec={rec} settings={settings} onSave={(approved) => props.onSave({ approved })} />}
        </div>
      )}

      <label className="row" style={{ fontSize: 12.5, gap: 6 }}>
        <input
          type="checkbox"
          checked={rec.nonWorkDay}
          onChange={(e) => props.onSave({ nonWorkDay: e.target.checked })}
        />
        Weekend or holiday (whole day is extended hours, needs an ATWEH)
      </label>
    </>
  )
}

// "Approved / Not yet / Not approved" for OT, or for the ATWEH on a non-work day.
function ApprovalPicker(props: { rec: Attendance; settings: Settings; onSave: (approved: Approval) => void }) {
  const { rec } = props
  const minutes = countedMinutes(rec, props.settings)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="muted" style={{ fontSize: 12.5 }}>
        {formatMinutes(minutes)} {extraKind(rec)} · {rec.nonWorkDay ? 'ATWEH?' : 'Approved?'}
      </span>
      <div className="row" style={{ gap: 6 }}>
        {(['yes', 'pending', 'no'] as Approval[]).map((a) => (
          <button
            key={a}
            className={`pill-btn${rec.approved === a ? ' on' : ''}`}
            onClick={() => props.onSave(a)}
          >
            {rec.nonWorkDay && a === 'yes' ? 'Have ATWEH' : APPROVAL_LABEL[a]}
          </button>
        ))}
      </div>
    </div>
  )
}

// A time box that saves when you leave it. Empty = no time (e.g. not timed out yet).
function TimeField(props: { label: string; value: string | null; onSave: (time: string | null) => void }) {
  const initial = props.value ? hhmm(props.value) : ''
  const [time, setTime] = useState(initial)
  useEffect(() => setTime(initial), [initial])
  return (
    <label className="att-field">
      <span>{props.label}</span>
      <input
        type="time"
        value={time}
        title={props.value ? time12(initial) : ''}
        onChange={(e) => setTime(e.target.value)}
        onBlur={() => time !== initial && props.onSave(time || null)}
      />
    </label>
  )
}
