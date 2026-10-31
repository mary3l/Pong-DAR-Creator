// FirstRunView.tsx: the first time Pong starts. Pick your DAR workbook (Pong reads its
// newest sheet for your duties, tasks and header), check your details, and go.
// Runs in the RENDERER. Shown by MainWindow until settings.setupDone is true.
import { useState } from 'react'
import Pong from '../../components/Pong'
import { ProfileSettings, Toggle } from './SettingsView'
import './settings.css'

export default function FirstRunView(props: { onDone: () => void }) {
  const [autostart, setAutostart] = useState(true)

  async function start() {
    await window.pong.setSettings({ setupDone: true, autostart })
    props.onDone()
  }

  return (
    <div className="first-run">
      <div className="hello">
        <Pong mood="ask" size={96} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ fontSize: 30 }}>Hi, I'm Pong!</h1>
          <span className="muted" style={{ fontSize: 15 }}>
            I'll nap on your taskbar and ask what you're up to about once an hour. At cutoff, I add your DAR sheet
            to your workbook. Let's set things up: it takes a minute.
          </span>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="step-num">1</span>
        <div className="settings-body">
          <b>Choose your DAR workbook, then check your details</b>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Pong reads the newest sheet for your duties, tasks (MFOs), header and signatories. It doesn't change the
            workbook now; sheets are only added when you export.
          </span>
          <ProfileSettings compact />
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="step-num">2</span>
        <div className="settings-body">
          <div className="box group">
            <Toggle
              label="Start with Windows"
              hint="Pong wakes up when you log in, in the tray"
              on={autostart}
              onChange={setAutostart}
            />
          </div>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Work hours, lunch and how often Pong asks are in Settings (8:00 to 5:00, Monday to Friday, every hour).
          </span>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 16 }}>
        <span className="muted" style={{ fontSize: 13.5 }}>
          Anytime: <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>L</kbd> to log a note
        </span>
        <button className="teal" onClick={start}>
          Start Pong
        </button>
      </div>
    </div>
  )
}
