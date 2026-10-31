// SettingsView.tsx: Phase 5 placeholder. Phase 7 builds the full Settings screen.
// For now: try a check-in, and (development only) seed from the sample DAR.
import { useEffect, useState } from 'react'

export default function SettingsView() {
  const [packaged, setPackaged] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    window.pong.appInfo().then((info) => setPackaged(info.packaged))
  }, [])

  async function seed() {
    if (!confirm('Replace all notes, duties and tasks with the sample DAR?')) return
    try {
      const r = await window.pong.seedFromSample()
      setMessage(`Seeded ${r.duties} duties, ${r.outputs} MFOs, ${r.entries} entries.`)
    } catch (e) {
      setMessage(String(e))
    }
  }

  return (
    <div className="box side-card" style={{ maxWidth: 560 }}>
      <span className="side-title">Settings</span>
      <div className="row">
        <button className="primary" onClick={() => window.pong.askNow()}>
          Try a check-in now
        </button>
        {!packaged && <button onClick={seed}>Seed from sample DAR (dev)</button>}
      </div>
      {message && <span className="muted">{message}</span>}
    </div>
  )
}
