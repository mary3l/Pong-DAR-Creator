// settings.ts (shared): the shape of Pong's settings and their defaults.
// main/settings.ts stores them as JSON in userData; the Settings screen edits them.
// Pure types and data, so the scheduler's tests and the renderer can use them too.

// A git repo on this PC whose commits Pong suggests as notes. outputId: the DAR task
// its commits usually count toward (preselected when you pick one), or null.
export interface GitRepo {
  path: string
  outputId: number | null
}

export interface Settings {
  // Check-ins
  intervalMin: 30 | 45 | 60 | 90 // "Ask me every"
  randomness: boolean // +/- 15 min, so it feels natural
  workStart: string // 'HH:MM', 24-hour
  workEnd: string
  lunchStart: string
  lunchEnd: string
  workDays: number[] // 0 = Sunday ... 6 = Saturday
  quietWhenIdle: boolean // skip while idle 10+ min
  quietFullScreen: boolean // skip during presentations, games, full-screen video
  askMissedDays: boolean // "Ask about days with no notes"
  // General
  autostart: boolean // start with Windows (hidden: tray and Pong only)
  animations: boolean
  spot: 'taskbar' | 'tray' // Pong on the taskbar, or only the tray icon
  setupDone: boolean // false until the first-run form is saved
  startedOn: string // 'YYYY-MM-DD' of the first run; days before it are never "missed"
  // DAR sheet
  codesRow: boolean // a "Codes for the following:" row above each A.) duty's MFOs
  // Git
  repos: GitRepo[] // commits from these folders show as suggestions in the check-in card
}

export const DEFAULT_SETTINGS: Settings = {
  intervalMin: 60,
  randomness: true,
  workStart: '08:00',
  workEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  workDays: [1, 2, 3, 4, 5],
  quietWhenIdle: true,
  quietFullScreen: true,
  askMissedDays: true,
  autostart: true,
  animations: true,
  spot: 'taskbar',
  setupDone: false,
  startedOn: '',
  codesRow: true,
  repos: []
}

export const INTERVALS: Settings['intervalMin'][] = [30, 45, 60, 90]

// '08:30' -> 510 (minutes after midnight). Anything malformed counts as midnight.
export function minutesOf(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0
}

// True for a well-formed 'HH:MM' between 00:00 and 23:59.
export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

// Checks one settings change coming from the renderer. Returns the error, or null if ok.
// Lives here (not in ipc.ts) so it's tested in plain Node with the rest of the rules.
export function settingsError(changes: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(changes)) {
    switch (key) {
      case 'intervalMin':
        if (!INTERVALS.includes(value as Settings['intervalMin'])) return key
        break
      case 'workStart':
      case 'workEnd':
      case 'lunchStart':
      case 'lunchEnd':
        if (!isTime(value)) return key
        break
      case 'workDays':
        if (!Array.isArray(value) || value.length > 7 || !value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
          return key
        break
      case 'startedOn':
        if (typeof value !== 'string' || !/^(\d{4}-\d{2}-\d{2})?$/.test(value)) return key
        break
      case 'repos':
        if (
          !Array.isArray(value) ||
          value.length > 30 ||
          !value.every(
            (r) =>
              typeof r === 'object' &&
              r !== null &&
              typeof r.path === 'string' &&
              r.path.length > 0 &&
              r.path.length <= 500 &&
              (r.outputId === null || (Number.isInteger(r.outputId) && r.outputId > 0)) &&
              Object.keys(r).length === 2
          )
        )
          return key
        break
      case 'spot':
        if (value !== 'taskbar' && value !== 'tray') return key
        break
      case 'randomness':
      case 'quietWhenIdle':
      case 'quietFullScreen':
      case 'askMissedDays':
      case 'autostart':
      case 'animations':
      case 'setupDone':
      case 'codesRow':
        if (typeof value !== 'boolean') return key
        break
      default:
        return key // not a setting
    }
  }
  return null
}
