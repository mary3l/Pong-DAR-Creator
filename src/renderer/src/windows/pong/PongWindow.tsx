// PongWindow.tsx: Pong on the taskbar, with his speech bubble. Runs in the RENDERER.
// Main decides the mood and the bubble (pong.ts) and sends them here; this window only
// draws them and reports clicks. It can't take keyboard focus (focusable: false), so
// everything here is a click; typing happens in the check-in window.
import { useEffect, useState } from 'react'
import Pong from '../../components/Pong'
import { dayLong } from '../../../../shared/cutoff'
import type { PongAction, PongState } from '../../../../shared/types'
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
  const [state, setState] = useState<PongState>({ mood: 'sleep', bubble: null, animations: true })

  useEffect(() => {
    window.pong.pongState().then(setState)
    return window.pong.onPongState(setState)
  }, [])

  const { mood, bubble } = state
  const awake = mood !== 'sleep'

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
