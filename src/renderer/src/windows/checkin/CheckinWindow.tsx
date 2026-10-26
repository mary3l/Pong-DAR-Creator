import { useEffect } from 'react'
import Pong from '../../components/Pong'

// Phase 0 placeholder. Phase 3 builds the real entry card from docs/design/boards/Main.dc.html.
export default function CheckinWindow() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.pong.hideWindow('checkin')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Pong mood="ask" size={56} />
        <h2 style={{ fontSize: 24 }}>What are you up to?</h2>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 800, fontSize: 13 }}>
        Your note
        <input autoFocus placeholder="Phase 3 makes this save" />
      </label>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>Esc hides this window.</p>
      <button onClick={() => window.pong.hideWindow('checkin')}>Close</button>
    </main>
  )
}
