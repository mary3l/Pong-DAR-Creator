// PongWindow.tsx: Pong on the taskbar, with his speech bubble. Runs in the RENDERER.
// Main decides the mood and the bubble (pong.ts) and sends them here; this window only
// draws them and reports clicks. It can't take keyboard focus (focusable: false), so
// everything here is a click; typing happens in the check-in window.
// Hovering over Pong shows small attendance buttons above him: Time in, Lunch, Time out.
import { useEffect, useRef, useState } from 'react'
import Pong from '../../components/Pong'
import { dayLong, weekdayName } from '../../../../shared/cutoff'
import type { PongAction, PongState } from '../../../../shared/types'
import { time12 } from '../../../../shared/dates'
import './pong.css'

const act = (action: PongAction) => () => window.pong.pongAction(action)

// "on Sat, Oct 24 and Sun, Oct 25"; more than three: "for 5 days since Mon, Oct 19".
function dayList(days: string[]) {
  const short = (d: string) => dayLong(d).replace(/^(\w{3})\w*/, '$1')
  if (days.length > 3) {
    return (
      <>
        for <b>{days.length} days</b> since <b>{short(days[0])}</b>
      </>
    )
  }
  return (
    <>
      on{' '}
      {days.map((d, i) => (
        <span key={d}>
          {i > 0 && (i === days.length - 1 ? ' and ' : ', ')}
          <b>{short(d)}</b>
        </span>
      ))}
    </>
  )
}

export default function PongWindow() {
  const [state, setState] = useState<PongState>({
    mood: 'sleep',
    bubble: null,
    animations: true,
    session: 'off',
    trackLunch: false
  })
  // The hover buttons: shown while the cursor is over Pong, and a moment after it leaves,
  // so it can travel from the turtle up to a button without them vanishing.
  const [chips, setChips] = useState(false)
  const chipTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    window.pong.pongState().then(setState)
    return window.pong.onPongState(setState)
  }, [])

  // Click-through. Main lets clicks pass through this window unless we say the cursor
  // is over Pong or his bubble. Mouse moves still arrive (forward: true in windows.ts),
  // so every move checks what's under the cursor and reports only when that changes.
  const hovering = useRef(false)
  const cursor = useRef<{ x: number; y: number } | null>(null)
  const report = (over: boolean) => {
    if (over === hovering.current) return
    hovering.current = over
    window.pong.setPongHover(over)
    clearTimeout(chipTimer.current)
    if (over) setChips(true)
    else chipTimer.current = setTimeout(() => setChips(false), 700)
  }
  const overPong = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest('.pong-turtle, .pong-chips, .bubble, .toast') != null

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      cursor.current = { x: e.clientX, y: e.clientY }
      report(overPong(e.clientX, e.clientY))
    }
    // Switching click-through on or off makes Chromium fire a mouseleave even though the
    // cursor hasn't moved. A real leave happens at or past the window's edge; one from
    // inside the window is that false alarm, so it's ignored.
    const onLeave = (e: MouseEvent) => {
      const inside = e.clientX > 0 && e.clientY > 0 && e.clientX < innerWidth - 1 && e.clientY < innerHeight - 1
      if (inside) return
      cursor.current = null
      report(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // The bubble came or went under a still cursor: check again without waiting for a move.
  useEffect(() => {
    const c = cursor.current
    requestAnimationFrame(() => report(c !== null && overPong(c.x, c.y)))
  }, [state])

  const { mood, bubble, session } = state
  const awake = mood !== 'sleep'
  const showChips = chips && !bubble && ['none', 'declined', 'in', 'lunch'].includes(session)

  return (
    <div className={`pong-stage${state.animations ? ' animated' : ''}`}>
      {bubble?.kind === 'ask' && (
        <div className="bubble" role="dialog" aria-label="Pong asks">
          <span className="bubble-title">What are you up to?</span>
          <span className="bubble-sub">{bubble.sub}</span>
          <div className="bubble-buttons">
            <button className="primary" onClick={act('tell')}>
              Tell Pong
            </button>
            <button onClick={act('later')}>Later</button>
            <button onClick={act('break')}>On a break</button>
          </div>
        </div>
      )}

      {bubble?.kind === 'missed' && (
        <div className="bubble" role="dialog" aria-label="Pong asks about missed days">
          <span className="bubble-title">{new Date().getHours() < 12 ? 'Good morning!' : 'Hello again!'}</span>
          <span className="bubble-sub">
            I didn't hear from you {dayList(bubble.days)}. Let's fill them in so your DAR has no gaps.
          </span>
          <div className="bubble-buttons">
            <button className="primary" onClick={act('fill')}>
              Fill them in
            </button>
            <button onClick={act('later')}>Later</button>
          </div>
        </div>
      )}

      {bubble?.kind === 'time-in' && (
        <div className="bubble" role="dialog" aria-label="Pong asks for your time-in">
          <span className="bubble-title">
            {bubble.nonWork ? 'Working today?' : new Date().getHours() < 12 ? 'Good morning!' : 'Hello!'}
          </span>
          <span className="bubble-sub">
            {bubble.nonWork && (
              <>
                It's <b>{bubble.nonWork}</b>, so this counts as <b>extended hours</b> (ATWEH).{' '}
              </>
            )}
            Time in at <b>{time12(bubble.at)}</b>? That's when I first saw you today.
          </span>
          <div className="bubble-buttons">
            <button className="primary" onClick={act('time-in')}>
              Time in
            </button>
            <button onClick={act('not-working')}>Not working today</button>
          </div>
        </div>
      )}

      {bubble?.kind === 'forgot-out' && (
        <div className="bubble" role="dialog" aria-label="Pong asks about a missing time-out">
          <span className="bubble-title">You forgot to time out</span>
          <span className="bubble-sub">
            No time-out on <b>{weekdayName(bubble.date)}</b>. I last saw you at <b>{time12(bubble.lastSeen)}</b>.
          </span>
          <div className="bubble-buttons">
            <button className="primary" onClick={act('use-last-seen')}>
              Use {time12(bubble.lastSeen)}
            </button>
            <button onClick={act('fix-today')}>Fix in Today</button>
          </div>
        </div>
      )}

      {bubble?.kind === 'ot-ask' && (
        <div className="bubble" role="dialog" aria-label="Pong asks about overtime">
          <span className="bubble-title">Still working? Overtime?</span>
          <span className="bubble-sub">
            Your day ended at <b>{time12(bubble.end)}</b>.
          </span>
          <div className="bubble-buttons">
            <button className="primary" onClick={act('ot-yes')}>
              Yes, OT
            </button>
            <button onClick={act('time-out')}>Time out now</button>
            <button onClick={act('left-at')}>I left at {time12(bubble.end)}</button>
          </div>
        </div>
      )}

      {bubble?.kind === 'lunch-back' && (
        <div className="bubble" role="dialog" aria-label="Pong asks if you are back from lunch">
          <span className="bubble-title">Back from lunch?</span>
          <span className="bubble-sub">Check-ins are paused while you're out.</span>
          <div className="bubble-buttons">
            <button className="primary" onClick={act('lunch-in')}>
              I'm back
            </button>
            <button onClick={act('later')}>Not yet</button>
          </div>
        </div>
      )}

      {showChips && (
        <div className="pong-chips">
          {(session === 'none' || session === 'declined') && <button onClick={act('time-in')}>Time in</button>}
          {session === 'in' && state.trackLunch && <button onClick={act('lunch-out')}>Lunch</button>}
          {session === 'lunch' && <button onClick={act('lunch-in')}>Back</button>}
          {(session === 'in' || session === 'lunch') && <button onClick={act('time-out')}>Time out</button>}
        </div>
      )}

      {bubble?.kind === 'toast' && (
        <div className="toast" role="status">
          <svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30" style={{ flexShrink: 0 }}>
            <circle cx="15" cy="15" r="14" fill="#F5B83D" />
            <path d="M9 15.5l4 4 8-8.5" stroke="#2A2622" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b>{bubble.title}</b>
            <span>{bubble.sub}</span>
          </div>
        </div>
      )}

      <button
        className="pong-turtle"
        aria-label="Pong. Click to log what you are doing"
        onClick={act('click')}
        // Napping Pong sinks a little behind the taskbar edge; awake, he sits up.
        style={{ transform: `translateY(${mood === 'happy' ? 4 : 14}px)` }}
      >
        <div className={mood === 'happy' ? 'hop' : awake ? 'bob' : ''}>
          <Pong mood={mood} size={120} />
        </div>
      </button>
    </div>
  )
}
