// HelpView.tsx: the "How to use" tab. Start to finish: install, first run, daily
// check-ins, missed days, the cutoff export, settings, your data, and fixes.
// Runs in the RENDERER; only reads appInfo() to show the real data folder.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Pong from '../../components/Pong'
import type { PongMood } from '../../../../shared/types'
import './help.css'

// The six steps from docs/design/boards/How.dc.html.
const STEPS: { mood: PongMood; title: string; body: string }[] = [
  { mood: 'sleep', title: 'Pong naps on your taskbar', body: 'Click him anytime, or press Ctrl+Alt+L.' },
  { mood: 'peek', title: 'About every hour, he peeks out', body: 'Only in work hours. Skips lunch, idle time and full-screen apps.' },
  { mood: 'ask', title: 'You type one line', body: 'What you did, in your own words. Enter saves, Esc closes.' },
  { mood: 'listen', title: 'Tag the DAR task and %', body: 'The last task is preselected. Tap 25, 50, 75 or 100%.' },
  { mood: 'happy', title: 'Your day fills itself in', body: 'Today shows every note. Cutoff shows the DAR grid filling up.' },
  { mood: 'happy', title: 'Export at cutoff', body: 'One click adds the new sheet to your DAR workbook, ready to sign.' }
]

const SECTIONS = [
  { id: 'install', title: 'Install Pong' },
  { id: 'setup', title: 'First run' },
  { id: 'daily', title: 'Every day: check-ins' },
  { id: 'missed', title: 'Days with no notes' },
  { id: 'today', title: 'Today: fix or add notes' },
  { id: 'tasks', title: 'Tasks: duties and MFOs' },
  { id: 'cutoff', title: 'Cutoff: export your DAR' },
  { id: 'settings', title: 'Settings' },
  { id: 'keys', title: 'Shortcuts and tray' },
  { id: 'data', title: 'Your data and backups' },
  { id: 'trouble', title: 'If something goes wrong' }
]

export default function HelpView() {
  const [dataFolder, setDataFolder] = useState('%APPDATA%\\Pong')
  const refs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    window.pong.appInfo().then((info) => setDataFolder(info.dataFolder))
  }, [])

  const Section = (props: { id: string; n: number; children: ReactNode }) => (
    <section className="box help-section" ref={(el) => {
        refs.current[props.id] = el
      }}>
      <h3>
        <span className="step-num">{props.n}</span>
        {SECTIONS.find((s) => s.id === props.id)?.title}
      </h3>
      {props.children}
    </section>
  )

  return (
    <div className="help">
      <nav className="help-toc" aria-label="On this page">
        {SECTIONS.map((s, i) => (
          <button key={s.id} onClick={() => refs.current[s.id]?.scrollIntoView({ behavior: 'smooth' })}>
            {i + 1}. {s.title}
          </button>
        ))}
      </nav>

      <div className="help-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="h-day">How to use Pong</span>
          <span className="muted" style={{ fontSize: 14 }}>
            From a one-line note to a signed DAR, without backtracking at cutoff.
          </span>
        </div>

        <div className="help-steps">
          {STEPS.map((step, i) => (
            <div key={i} className="box help-step">
              <Pong mood={step.mood} size={48} />
              <div>
                <b>
                  {i + 1}. {step.title}
                </b>
                <span>{step.body}</span>
              </div>
            </div>
          ))}
        </div>

        <Section id="install" n={1}>
          <ol>
            <li>
              Run <b>Pong-1.0.0-setup.exe</b>. It installs for your Windows account only, so no admin password is
              needed, and adds <b>Pong</b> to the Start menu.
            </li>
            <li>
              Windows may say "Windows protected your PC" because the installer isn't signed. Click <b>More info</b>,
              then <b>Run anyway</b>. On the office PC, check with IT first.
            </li>
            <li>Pong opens by itself when the install finishes.</li>
          </ol>
        </Section>

        <Section id="setup" n={2}>
          <p>The first time, Pong shows a short setup form instead of the tabs.</p>
          <ol>
            <li>
              Click <b>Choose…</b> and pick your DAR workbook (the .xlsx you submit). Pong reads its newest sheet and
              fills in your duties, header and signatories, plus the tasks (MFOs) that aren't at 100% yet: a task
              whose last % on that sheet is 100% is finished and stays out. It only reads the file here. Already set
              up? Settings, DAR profile, DAR workbook: <b>Change</b> does the same any time.
            </li>
            <li>
              Check your details: Name of JOE, position, department, unit, team leader, and who confirms and notes your
              DAR. Each box saves when you click out of it.
            </li>
            <li>
              Leave <b>Start with Windows</b> on so Pong wakes up when you log in, then click <b>Start Pong</b>.
            </li>
          </ol>
          <div className="help-tip">
            Pong only asks about days from today on. Days before you set him up are never counted as missing.
          </div>
        </Section>

        <Section id="daily" n={3}>
          <p>
            Pong naps on the right side of the taskbar. On work days, during work hours, he peeks out about once an hour
            and asks <b>What are you up to?</b> The first question comes 5 to 10 minutes after work starts, and again
            after lunch.
          </p>
          <ul>
            <li>
              <b>Tell Pong</b> opens the note card. <b>Later</b> asks again in 15 minutes. <b>On a break</b> keeps him
              quiet for 30 minutes. Ignore him and he goes back to sleep after 10 minutes.
            </li>
            <li>
              Type one line about what you're doing. Under <b>Which DAR task?</b>, the five tasks you used most recently
              show as buttons, and the last one is already picked. Click a picked task again to save a plain note with no
              task.
            </li>
            <li>
              <b>+ New task</b> lets you pick any other task, or add a new one under a duty.
            </li>
            <li>
              Pick <b>How far along?</b> 25, 50, 75 or 100%, then press <b>Enter</b> (or Save note). <b>Esc</b> closes
              the card without saving.
            </li>
            <li>
              You don't have to wait for him: click Pong, click the tray icon, or press <b>Ctrl+Alt+L</b> from any app.
            </li>
          </ul>
          <div className="help-tip">
            In the DAR, each task gets the <b>highest %</b> you logged for it that day. Logging 25% in the morning and
            75% in the afternoon shows 75%.
          </div>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Pong stays quiet at lunch, outside work hours, when you've been away from the mouse and keyboard for 10+
            minutes, while the screen is locked, during full-screen apps (presentations, video calls) and while paused.
            If a question was due while you were away, he asks once when you're back.
          </p>
        </Section>

        <Section id="missed" n={4}>
          <p>
            If a past day in the current cutoff has no notes and isn't marked off, Pong's next question becomes{' '}
            <b>Good morning! I didn't hear from you on …</b> Click <b>Fill them in</b>. Pong asks about each day, oldest
            first:
          </p>
          <ul>
            <li>
              <b>Yes, I was off</b>: pick Rest day, Sick leave or Personal leave, then <b>Save</b>. The DAR shows a gray
              box for that day.
            </li>
            <li>
              <b>No, I worked</b>: type what you did that day, one line per task, with its task and %. Press Enter or{' '}
              <b>+ Add log</b> after each one, then <b>Done with &lt;day&gt;</b>.
            </li>
          </ul>
          <p>
            Close the card (X) or click Later to do it another time: Pong keeps asking until each day is filled. A
            weekend with no notes already shows as Rest Day in the DAR, so answering for weekends is optional.
          </p>
        </Section>

        <Section id="today" n={5}>
          <ul>
            <li>
              <b>Today</b> lists your notes with their times, tasks and %. The panel on the right shows the highest % per
              task so far today.
            </li>
            <li>
              Click the pencil on a note to change its time, text, task or %, or to <b>Delete</b> it.
            </li>
            <li>
              Forgot to log something earlier? <b>+ Earlier note</b> adds a note with the time you pick.
            </li>
            <li>
              Fixing a note fixes the DAR too: the grid is rebuilt from your notes every time.
            </li>
          </ul>
        </Section>

        <Section id="tasks" n={6}>
          <p>
            The <b>Tasks</b> tab holds the rows of your DAR: duties under <b>A.) Specific duties</b> and{' '}
            <b>B.) Support functions</b>, each with its tasks (MFOs).
          </p>
          <ul>
            <li>Rename a duty or task by typing in its box, then press Enter or click away.</li>
            <li>
              <b>+ Add task</b> adds a task under a duty; <b>+ Add duty</b> adds a duty to a section.
            </li>
            <li>
              <b>Mark done</b> when a task is finished: it drops off future sheets, but stays on any sheet where it has a
              %. <b>Archive</b> does the same for a whole duty. Tick <b>Show archived</b> to bring one back.
            </li>
          </ul>
        </Section>

        <Section id="cutoff" n={7}>
          <p>
            Cutoffs run from the <b>3rd to the 17th</b>, and from the <b>18th to the 2nd</b> of the next month. The{' '}
            <b>Cutoff (DAR)</b> tab shows the sheet the way it will look in Excel.
          </p>
          <ol>
            <li>
              Use <b>‹ ›</b> to move between cutoffs (<b>This cutoff</b> jumps back to the current one).
            </li>
            <li>
              Check the grid. Blue-gray boxes are your highest % per day; gray boxes are days off. Click a weekday's date
              to cycle it through <b>Sick Leave</b>, <b>Personal Leave</b>, <b>Holiday</b> and back to a work day.
            </li>
            <li>
              The line at the bottom shows days attended, the number of tasks, and any weekdays with no notes. Fill
              those in first (Today, or the missed-day questions).
            </li>
            <li>
              <b>Close your DAR workbook in Excel</b>, then click <b>Add sheet to &lt;your workbook&gt;</b>. It takes a
              few seconds.
            </li>
            <li>
              Pong copies the look of the newest sheet in your workbook and adds a new sheet named after the cutoff, like
              "October 18 - November 2". Header, dates, %, days off, days attended, Date Submitted (the day you export)
              and signatories are filled in.
            </li>
            <li>
              Click <b>Open in Excel</b>, check it, print (landscape, print area already set) and sign.
            </li>
          </ol>
          <ul>
            <li>
              Exported this cutoff already? Pong asks before replacing the sheet. Export again any time after fixing
              notes.
            </li>
            <li>
              <b>Undo</b> (right after exporting) puts the workbook back as it was.
            </li>
          </ul>
          <div className="help-warn">
            Pong never edits the workbook directly. It writes a temporary file, checks it, keeps a copy of the old
            workbook named <code>&lt;name&gt;.bak.xlsx</code> next to it, then swaps the new one in. If anything goes
            wrong, your workbook stays as it was, and the .bak is always one step back.
          </div>
        </Section>

        <Section id="settings" n={8}>
          <table className="help-table">
            <tbody>
              <tr>
                <td>Check-ins</td>
                <td>
                  How often Pong asks (30, 45, 60 or 90 min), work hours, lunch, work days, a little randomness, staying
                  quiet when away or in full screen, asking about days with no notes, and <b>Try a check-in now</b>.
                </td>
              </tr>
              <tr>
                <td>Shortcuts</td>
                <td>The three hotkeys (below).</td>
              </tr>
              <tr>
                <td>DAR profile</td>
                <td>
                  Your header, signatories, and which workbook exports go into (<b>Change</b> picks another one and reads
                  any new duties and tasks from it).
                </td>
              </tr>
              <tr>
                <td>General</td>
                <td>
                  Start with Windows, animations, Pong <b>on the taskbar</b> or <b>tray icon only</b> (he then appears
                  only to ask), the data folder and <b>Back up now</b>.
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section id="keys" n={9}>
          <table className="help-table">
            <tbody>
              <tr>
                <td>
                  <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>L</kbd>
                </td>
                <td>Log a note now, from any app</td>
              </tr>
              <tr>
                <td>
                  <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>K</kbd>
                </td>
                <td>Open this window</td>
              </tr>
              <tr>
                <td>
                  <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>P</kbd>
                </td>
                <td>Pause check-ins for 1 hour</td>
              </tr>
              <tr>
                <td>Tray icon</td>
                <td>
                  Left-click to log a note. Right-click for Log now, Open Pong, Pause 1 hr (or Resume check-ins) and{' '}
                  <b>Quit Pong</b>. Hover to see how many notes you have today.
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Closing a window only hides it; Pong keeps running in the tray. To stop him completely, use Quit Pong in the
            tray menu.
          </p>
        </Section>

        <Section id="data" n={10}>
          <p>
            Everything stays on this PC, in <code>{dataFolder}</code> (Settings, General, <b>Open folder</b>):
          </p>
          <ul>
            <li>
              <code>pong.db</code>: your notes, tasks, days off and profile
            </li>
            <li>
              <code>settings.json</code>: your settings
            </li>
            <li>
              <code>backups</code>: a copy of pong.db every day; the newest 14 are kept
            </li>
            <li>
              <code>logs</code>: one file per day, useful if something goes wrong
            </li>
          </ul>
          <p>
            <b>To restore a backup:</b> Quit Pong from the tray. In the data folder, delete <code>pong.db-wal</code> and{' '}
            <code>pong.db-shm</code> if they're there, rename <code>pong.db</code> to <code>pong-old.db</code>, copy
            the backup you want (for example <code>backups\pong-2026-11-03.db</code>) into the folder and rename it{' '}
            <code>pong.db</code>. Then start Pong again.
          </p>
        </Section>

        <Section id="trouble" n={11}>
          <table className="help-table">
            <tbody>
              <tr>
                <td>"… is open in Excel"</td>
                <td>Close the workbook in Excel, then click Add sheet again.</td>
              </tr>
              <tr>
                <td>"Choose your DAR workbook first"</td>
                <td>Settings, DAR profile, DAR workbook: Choose….</td>
              </tr>
              <tr>
                <td>Pong never asks</td>
                <td>
                  Check Settings, Check-ins: work hours and work days. If the tray menu says <b>Resume check-ins</b>,
                  he's paused. He also waits while you're idle or in a full-screen app. <b>Try a check-in now</b> tests
                  it.
                </td>
              </tr>
              <tr>
                <td>Pong is gone from the taskbar</td>
                <td>
                  Settings, General: Where Pong lives may be on <b>Tray icon only</b>. If he isn't in the tray either,
                  he was quit: start Pong from the Start menu.
                </td>
              </tr>
              <tr>
                <td>A hotkey does nothing</td>
                <td>
                  Another app may own it. Pong says so in a tray message when he starts. The tray icon and clicking Pong
                  always work.
                </td>
              </tr>
              <tr>
                <td>Excel shows a problem with the file</td>
                <td>
                  Close it, then rename <code>&lt;name&gt;.bak.xlsx</code> to your workbook's name to go back, and send
                  the log file from the logs folder to whoever maintains Pong.
                </td>
              </tr>
              <tr>
                <td>Uninstall</td>
                <td>
                  Windows Settings, Apps, Pong, Uninstall. Your data folder stays, so reinstalling keeps your notes.
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  )
}
