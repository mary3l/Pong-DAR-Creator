// ExtraCard.tsx: after a time-out with extra time. Runs in the RENDERER.
//   work day:      "1 h 25 min OT today. Was the OT approved?"
//   weekend/holiday: "8 h of extended hours. Do you have an ATWEH?"
// The answer is saved on the day's attendance record (window.pong.setAttendance);
// "Not yet" stays pending and shows in the Today view until you change it.
import { useEffect, useState } from 'react'
import { countedMinutes, formatMinutes, hhmm } from '../../../../shared/attendance'
import { dayLong } from '../../../../shared/cutoff'
import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/settings'
import type { Approval, Attendance } from '../../../../shared/types'
import { time12 } from '../main/TodayView'
import { CloseButton } from './EntryCard'

export default function ExtraCard(props: { date: string; onDone: () => void }) {
  const [rec, setRec] = useState<Attendance | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [error, setError] = useState('')

  useEffect(() => {
    window.pong.getAttendance(props.date).then(setRec)
    window.pong.getSettings().then(setSettings)
  }, [props.date])

  if (!rec?.timeIn || !rec.timeOut) return <div className="card" />

  const minutes = countedMinutes(rec, settings)
  const ot = !rec.nonWorkDay

  const answer = async (approved: Approval) => {
    try {
      await window.pong.setAttendance(props.date, { approved })
      props.onDone()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div className="field" style={{ gap: 2 }}>
          <span className="card-title">
            {ot ? `${formatMinutes(minutes)} OT` : `${formatMinutes(minutes)} of extended hours`}
          </span>
          <span className="card-sub">
            {dayLong(rec.date)} · in {time12(hhmm(rec.timeIn))}, out {time12(hhmm(rec.timeOut))}
          </span>
        </div>
        <CloseButton onClick={props.onDone} />
      </div>

      <span style={{ fontSize: 16, fontWeight: 700 }}>
        {ot ? 'Was the OT approved?' : 'Do you have an Authority to Work on Extended Hours (ATWEH)?'}
      </span>

      <div className="big-choices" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <button type="button" className="big-choice" onClick={() => answer('yes')}>
          <b>Yes</b>
          <small>{ot ? 'Approved' : 'I have one'}</small>
        </button>
        <button type="button" className="big-choice" onClick={() => answer('pending')}>
          <b>Not yet</b>
          <small>Remind me in Today</small>
        </button>
        <button type="button" className="big-choice" onClick={() => answer('no')}>
          <b>No</b>
          <small>{ot ? 'Not approved' : "I don't have one"}</small>
        </button>
      </div>

      {error && <span className="error">{error}</span>}
    </div>
  )
}
