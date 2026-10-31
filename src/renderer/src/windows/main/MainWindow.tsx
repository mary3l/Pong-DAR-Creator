// MainWindow.tsx: the main window. Runs in the RENDERER.
// main.tsx picks this screen when the URL says ?window=main.
// Tabs: Today (your notes), Cutoff (the DAR grid and Export), Tasks (duties and MFOs),
// Settings, How to use. The very first time, the setup form instead (FirstRunView).
// Everything is read and written through window.pong.
import { useEffect, useState } from 'react'
import Pong from '../../components/Pong'
import '../../styles/card.css'
import CutoffView from './CutoffView'
import FirstRunView from './FirstRunView'
import HelpView from './HelpView'
import './main.css'
import SettingsView from './SettingsView'
import TasksView from './TasksView'
import TodayView from './TodayView'

type Tab = 'today' | 'cutoff' | 'tasks' | 'settings' | 'help'
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'cutoff', label: 'Cutoff (DAR)' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'settings', label: 'Settings' },
  { id: 'help', label: 'How to use' }
]

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export default function MainWindow() {
  const [tab, setTab] = useState<Tab>('today')
  // Bumped whenever main says data changed: views reload when `version` changes.
  const [version, setVersion] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [setupDone, setSetupDone] = useState<boolean | null>(null) // null = still loading

  useEffect(() => {
    window.pong.getSettings().then((s) => setSetupDone(s.setupDone))
  }, [])

  useEffect(() => window.pong.onDataChanged(() => setVersion((v) => v + 1)), [])

  // "Next check-in around 3:45 PM", refreshed every half minute like the scheduler.
  useEffect(() => {
    const load = () => window.pong.nextCheckin().then(setNext)
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [version])

  const bump = () => setVersion((v) => v + 1)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Pong mood="happy" size={38} />
          <span className="brand-name">Pong</span>
          <nav className="tabs" hidden={!setupDone}>
            {TABS.map((t) => (
              <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {next === null ? 'Pong is off duty' : `Next check-in around ${clock(next)}`}
        </span>
      </header>
      <main className="view">
        {setupDone === false && <FirstRunView onDone={() => setSetupDone(true)} />}
        {setupDone && tab === 'today' && <TodayView version={version} onChange={bump} onCutoff={() => setTab('cutoff')} />}
        {setupDone && tab === 'cutoff' && <CutoffView version={version} onChange={bump} />}
        {setupDone && tab === 'tasks' && <TasksView onChange={bump} />}
        {setupDone && tab === 'settings' && <SettingsView />}
        {setupDone && tab === 'help' && <HelpView />}
      </main>
    </div>
  )
}
