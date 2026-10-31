// SettingsView.tsx: Check-ins, Shortcuts, DAR profile, General. Runs in the RENDERER.
// Settings are saved as you change them (window.pong.setSettings -> settings.json in main).
// The DAR profile lives in the database (window.pong.setProfile), like in Phase 1.
import { useEffect, useState, type ReactNode } from 'react'
import { useTasks } from '../../components/useTasks'
import { INTERVALS, type GitRepo, type Settings } from '../../../../shared/settings'
import type { Profile } from '../../../../shared/types'
import './settings.css'

type Section = 'checkins' | 'shortcuts' | 'dar' | 'git' | 'general'
const NAV: { id: Section; label: string }[] = [
  { id: 'checkins', label: 'Check-ins' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'dar', label: 'DAR profile' },
  { id: 'git', label: 'Git repos' },
  { id: 'general', label: 'General' }
]
// Monday first, as on the board. Numbers are getDay(): 0 = Sunday.
const DAYS: { day: number; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' }
]

export default function SettingsView() {
  const [section, setSection] = useState<Section>('checkins')
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    window.pong.getSettings().then(setSettings)
  }, [])

  // Saves one change and shows what main stored (it checks every value).
  const save = async (changes: Partial<Settings>) => setSettings(await window.pong.setSettings(changes))

  if (!settings) return null

  return (
    <div className="settings">
      <nav className="settings-nav">
        {NAV.map((n) => (
          <button key={n.id} aria-pressed={section === n.id} onClick={() => setSection(n.id)}>
            {n.label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {section === 'checkins' && <CheckinSettings settings={settings} save={save} />}
        {section === 'shortcuts' && <ShortcutSettings />}
        {section === 'dar' && <ProfileSettings />}
        {section === 'git' && <GitSettings settings={settings} onChange={setSettings} save={save} />}
        {section === 'general' && <GeneralSettings settings={settings} save={save} />}
      </div>
    </div>
  )
}

export function Toggle(props: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="setting">
      <div className="setting-label">
        <b>{props.label}</b>
        <small>{props.hint}</small>
      </div>
      <button className="toggle" aria-pressed={props.on} aria-label={props.label} onClick={() => props.onChange(!props.on)}>
        <span />
      </button>
    </div>
  )
}

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-label">
        <b>{props.label}</b>
        {props.hint && <small>{props.hint}</small>}
      </div>
      {props.children}
    </div>
  )
}

function Heading(props: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <h2>{props.title}</h2>
      <span className="muted">{props.sub}</span>
    </div>
  )
}

function CheckinSettings(props: { settings: Settings; save: (c: Partial<Settings>) => void }) {
  const { settings: s, save } = props
  // A time input gives '' while you're mid-edit; only save complete times.
  const time = (key: 'workStart' | 'workEnd' | 'lunchStart' | 'lunchEnd') => ({
    value: s[key],
    onChange: (e: { target: { value: string } }) => /^\d{2}:\d{2}$/.test(e.target.value) && save({ [key]: e.target.value })
  })

  return (
    <>
      <Heading title="Check-ins" sub="When Pong pops out to ask what you're up to." />
      <div className="box group">
        <Row label="Ask me every">
          <div className="segmented">
            {INTERVALS.map((m) => (
              <button key={m} aria-pressed={s.intervalMin === m} onClick={() => save({ intervalMin: m })}>
                {m} min
              </button>
            ))}
          </div>
        </Row>
        <Row label="Work hours">
          <div className="time-range">
            <input type="time" aria-label="Work starts" {...time('workStart')} />
            <span>to</span>
            <input type="time" aria-label="Work ends" {...time('workEnd')} />
          </div>
        </Row>
        <Row label="Lunch" hint="Pong stays quiet">
          <div className="time-range">
            <input type="time" aria-label="Lunch starts" {...time('lunchStart')} />
            <span>to</span>
            <input type="time" aria-label="Lunch ends" {...time('lunchEnd')} />
          </div>
        </Row>
        <Row label="Work days">
          <div className="weekdays">
            {DAYS.map(({ day, label }) => {
              const on = s.workDays.includes(day)
              return (
                <button
                  key={day}
                  aria-pressed={on}
                  onClick={() => save({ workDays: on ? s.workDays.filter((d) => d !== day) : [...s.workDays, day].sort() })}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </Row>
      </div>
      <div className="box group">
        <Toggle
          label="Add a little randomness"
          hint="Asks within ±15 min so it feels natural, not robotic"
          on={s.randomness}
          onChange={(randomness) => save({ randomness })}
        />
        <Toggle
          label="Stay quiet when I'm away"
          hint="Skips the check-in if you have been idle for 10+ minutes"
          on={s.quietWhenIdle}
          onChange={(quietWhenIdle) => save({ quietWhenIdle })}
        />
        <Toggle
          label="Stay quiet during full-screen apps"
          hint="Presentations, meetings and videos"
          on={s.quietFullScreen}
          onChange={(quietFullScreen) => save({ quietFullScreen })}
        />
        <Toggle
          label="Ask about days with no notes"
          hint="Next morning: rest day, sick or personal leave, or add logs"
          on={s.askMissedDays}
          onChange={(askMissedDays) => save({ askMissedDays })}
        />
      </div>
      <div>
        <button className="primary" onClick={() => window.pong.askNow()}>
          Try a check-in now
        </button>
      </div>
    </>
  )
}

function ShortcutSettings() {
  const shortcuts = [
    { label: 'Log a note now', keys: ['Ctrl', 'Alt', 'L'] },
    { label: 'Open Pong (Today view)', keys: ['Ctrl', 'Alt', 'K'] },
    { label: 'Pause check-ins for 1 hour', keys: ['Ctrl', 'Alt', 'P'] }
  ]
  return (
    <>
      <Heading title="Shortcuts" sub="Work from any app, even when Pong is napping." />
      <div className="box group">
        {shortcuts.map((s) => (
          <Row key={s.label} label={s.label}>
            <span className="keys">
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </Row>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        If another app already uses one of these, Pong tells you from the tray when it starts.
      </span>
    </>
  )
}

const PROFILE_FIELDS: { key: keyof Profile; label: string }[] = [
  { key: 'name', label: 'Name of JOE' },
  { key: 'position', label: 'Position title' },
  { key: 'department', label: 'Department' },
  { key: 'unit', label: 'Unit' },
  { key: 'teamLeader', label: 'Team leader' }
]
const SIGNATORY_FIELDS: { key: keyof Profile; label: string }[] = [
  { key: 'confirmedBy', label: 'Confirmed by' },
  { key: 'confirmedTitle', label: 'Title' },
  { key: 'notedBy', label: 'Noted by' },
  { key: 'notedTitle', label: 'Title' }
]

// The DAR header and footer, plus which workbook exports go into.
export function ProfileSettings(props: { compact?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    window.pong.getProfile().then(setProfile)
  }, [])

  // Saved when you leave a field, not on every keystroke.
  const field = (f: { key: keyof Profile; label: string }) => (
    <label key={f.key}>
      <span className="field-label">{f.label}</span>
      <input
        defaultValue={profile?.[f.key] ?? ''}
        maxLength={300}
        onBlur={async (e) => setProfile(await window.pong.setProfile({ [f.key]: e.target.value.trim() || null }))}
      />
    </label>
  )

  async function pick() {
    try {
      const r = await window.pong.pickWorkbook()
      if (!r) return
      setProfile(await window.pong.getProfile())
      setMessage(
        `Read "${r.sheetName}" from ${r.name}: ${r.duties} new ${r.duties === 1 ? 'duty' : 'duties'}, ` +
          `${r.outputs} unfinished ${r.outputs === 1 ? 'task' : 'tasks'} added` +
          (r.finished ? ` (${r.finished} already at 100% left out).` : '.')
      )
    } catch (e) {
      setMessage(String(e).replace(/^.*Error: /, ''))
    }
  }

  if (!profile) return null
  const workbook = (
    <>
      <div className="box group">
        <Row label="DAR workbook" hint={profile.workbookPath ?? 'Not chosen yet'}>
          <button className={profile.workbookPath ? '' : 'primary'} onClick={pick}>
            {profile.workbookPath ? 'Change' : 'Choose…'}
          </button>
        </Row>
        {!props.compact && (
          <Row label="Cutoff periods" hint="3rd – 17th, and 18th – 2nd of the next month">
            <span />
          </Row>
        )}
      </div>
      {message && <span className="muted">{message}</span>}
    </>
  )

  return (
    <>
      {!props.compact && <Heading title="DAR profile" sub="Goes into the header and footer of every exported sheet." />}
      {props.compact && workbook /* first run: the workbook first, it fills in the rest */}
      <div className="box form-grid" key={profile.workbookPath ?? ''}>
        {PROFILE_FIELDS.map(field)}
      </div>
      <span className="field-label">Signatories</span>
      <div className="box form-grid" key={`s${profile.workbookPath ?? ''}`}>
        {SIGNATORY_FIELDS.map(field)}
      </div>
      {!props.compact && workbook}
    </>
  )
}

function GeneralSettings(props: { settings: Settings; save: (c: Partial<Settings>) => void }) {
  const { settings: s, save } = props
  const [info, setInfo] = useState<{ version: string; packaged: boolean; dataFolder: string } | null>(null)
  const [last, setLast] = useState<number | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    window.pong.appInfo().then(setInfo)
    window.pong.backupInfo().then((b) => setLast(b.last))
  }, [])

  async function backup() {
    const r = await window.pong.backupNow()
    setLast(r.at)
  }

  async function seed() {
    if (!confirm('Replace all notes, duties and tasks with the sample DAR?')) return
    try {
      const r = await window.pong.seedFromSample()
      setMessage(`Seeded ${r.duties} duties, ${r.outputs} MFOs, ${r.entries} entries.`)
    } catch (e) {
      setMessage(String(e))
    }
  }

  const lastText =
    last === null
      ? 'no backup yet'
      : `last backup ${new Date(last).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`

  return (
    <>
      <Heading title="General" sub="Startup, where Pong lives, and your data." />
      <div className="box group">
        <Toggle
          label="Start with Windows"
          hint="Pong wakes up when you log in"
          on={s.autostart}
          onChange={(autostart) => save({ autostart })}
        />
        <Toggle
          label="Animations"
          hint="Bobbing, peeking and sparkles"
          on={s.animations}
          onChange={(animations) => save({ animations })}
        />
        <Row label="Where Pong lives">
          <div className="segmented">
            <button aria-pressed={s.spot === 'taskbar'} onClick={() => save({ spot: 'taskbar' })}>
              On the taskbar
            </button>
            <button aria-pressed={s.spot === 'tray'} onClick={() => save({ spot: 'tray' })}>
              Tray icon only
            </button>
          </div>
        </Row>
      </div>
      <div className="box group">
        <Row label="Your data stays on this PC" hint={`${info?.dataFolder ?? ''} · ${lastText}`}>
          <div className="row">
            <button onClick={() => window.pong.openDataFolder()}>Open folder</button>
            <button onClick={backup}>Back up now</button>
          </div>
        </Row>
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        Pong {info?.version} · a backup of pong.db is made every day; the newest 14 are kept in the backups folder.
      </span>
      {info && !info.packaged && (
        <div className="row">
          <button onClick={seed}>Seed from sample DAR (dev)</button>
          <span className="muted">{message}</span>
        </div>
      )}
    </>
  )
}

// Git repos: folders whose commits show up as "From your commits" in the check-in card.
// Local only: Pong reads each repo's own history with git, never GitHub.
function GitSettings(props: {
  settings: Settings
  onChange: (s: Settings) => void
  save: (c: Partial<Settings>) => void
}) {
  const { settings: s, save } = props
  const tasks = useTasks()
  const [installed, setInstalled] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    window.pong.gitInstalled().then(setInstalled)
  }, [])

  async function add() {
    try {
      props.onChange(await window.pong.addRepo())
      setError('')
    } catch (e) {
      setError(String(e).replace(/^.*Error: /, ''))
    }
  }

  const update = (repo: GitRepo, changes: Partial<GitRepo> | null) =>
    save({
      repos: changes === null ? s.repos.filter((r) => r !== repo) : s.repos.map((r) => (r === repo ? { ...r, ...changes } : r))
    })

  const activeDuties = tasks.duties.filter((d) => !d.archived)
  const folderName = (path: string) => path.split(/[\/]/).filter(Boolean).at(-1) ?? path

  return (
    <>
      <Heading
        title="Git repos"
        sub="Your commits since the last note show up in the check-in card. Pick one and it becomes the note."
      />
      {!installed && (
        <span className="error">Git isn't installed on this PC (or not on PATH), so Pong can't read commits.</span>
      )}
      <div className="box group">
        {s.repos.length === 0 && (
          <Row label="No repos yet" hint="Add the project folders you commit in, e.g. pong-dar or dcwd_pip-frontend.">
            <span />
          </Row>
        )}
        {s.repos.map((repo) => (
          <Row key={repo.path} label={folderName(repo.path)} hint={repo.path}>
            <div className="row">
              <select
                aria-label={`Usual task for ${folderName(repo.path)}`}
                value={repo.outputId ?? ''}
                onChange={(e) => update(repo, { outputId: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ height: 40, maxWidth: 280, borderRadius: 10, border: '2px solid var(--field)', font: 'inherit', fontSize: 13.5 }}
              >
                <option value="">No usual task</option>
                {activeDuties.map((d) => (
                  <optgroup key={d.id} label={d.title}>
                    {tasks.outputs
                      .filter((o) => o.dutyId === d.id && o.status === 'active')
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <button onClick={() => update(repo, null)}>Remove</button>
            </div>
          </Row>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={add}>
          + Add repo folder…
        </button>
      </div>
      {error && <span className="error">{error}</span>}
      <span className="muted" style={{ fontSize: 13 }}>
        Only your own commits count (the repo's user.email), from every branch, merges left out. The usual task is
        picked for you when you choose one of that repo's commits; you still choose the %. Nothing is sent anywhere.
      </span>
    </>
  )
}
