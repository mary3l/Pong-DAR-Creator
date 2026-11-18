// types.ts: the shapes of Pong's data, shared by main and renderer.
// This file has only types, so it disappears when compiled: zero runtime cost.
// Convention: dates are 'YYYY-MM-DD' strings in local time (see dates.ts).

// ---------------------------------------------------------------------------
// Union types: a value that can only be one of a few exact strings or numbers.
// TypeScript then refuses typos like 'sik' or a progress of 0.3.
// They mirror the CHECK (...) rules on the tables in db.ts.
// ---------------------------------------------------------------------------
export type Category = 'core' | 'support' // A.) Specific duties, or B.) Support functions
export type Progress = 0.25 | 0.5 | 0.75 | 1 // the only % values a DAR cell can show
export type DayType = 'rest' | 'sick' | 'personal' | 'holiday'
export type EntrySource = 'checkin' | 'hotkey' | 'manual' | 'seed' // how a note was made

// Your details for the DAR header and footer.
// `string | null` = may be empty: a fresh install has no profile yet.
// Names are camelCase here; the table columns are snake_case (team_leader).
// queries.ts renames them with SQL `AS` aliases.
export interface Profile {
  name: string | null
  position: string | null
  department: string | null
  unit: string | null
  teamLeader: string | null
  confirmedBy: string | null
  confirmedTitle: string | null
  notedBy: string | null
  notedTitle: string | null
  workbookPath: string | null
}

// A duty: one merged block in column B of the DAR.
export interface Duty {
  id: number
  category: Category
  title: string
  sort: number // position inside its section, 1, 2, 3 ...
  archived: boolean // stored as 0/1 in SQLite, true/false here
}

// An MFO (major final output): one row in the DAR grid, under a duty.
export interface Output {
  id: number
  dutyId: number // which duty it belongs to (duties.id)
  title: string
  short: string | null // optional short name for chips in the check-in card
  status: 'active' | 'done' // done MFOs drop off future sheets
  createdAt: string // decides the row order: oldest first
}

// One note: a single answer to "What are you up to?".
export interface Entry {
  id: number
  createdAt: string // '2026-10-26T07:30:00', local time
  workDate: string // '2026-10-26', the DAR day it counts for
  text: string
  outputId: number | null // the MFO it's tagged to, if any
  progress: Progress | null // how far along that MFO is, if given
  source: EntrySource
}

// What the renderer sends to create a note. The `?` fields are optional:
// main fills in today's date, 'checkin' and nulls when they're left out.
// No id or createdAt here: the database and main decide those.
export interface NewEntry {
  text: string
  workDate?: string
  time?: string // 'HH:MM': a note added later for an earlier time (Today view)
  outputId?: number | null
  progress?: Progress | null
  source?: EntrySource
}

// What can change on a saved note (Today view: edit).
export interface EntryChanges {
  text?: string
  outputId?: number | null
  progress?: Progress | null
  time?: string // 'HH:MM'
}

// One row of the exports table: a sheet Pong added to the workbook.
export interface ExportRecord {
  periodStart: string
  periodEnd: string
  sheetName: string
  exportedAt: string // local timestamp
}

// A day you marked as off (sick leave etc.). One per date at most.
export interface DayStatus {
  date: string
  type: DayType
}

// A cutoff period, both ends included: { start: '2026-10-03', end: '2026-10-17' }.
export interface Period {
  start: string
  end: string
}

// What an export tells the renderer: which sheet it added, and where the files are.
export interface ExportResult {
  sheetName: string // "October 18 - November 2"
  path: string // the workbook that now has the new sheet
  backupPath: string // <name>.bak.xlsx, the workbook as it was before
}

// What the check-in window should show when main opens it.
//   entry:  "What are you up to?" for today. source says how it was opened.
//   missed: walk through past days with no notes, oldest first (Phase 4).
//   extra:  after a time-out with extra time: "Was the OT approved?" on a work day,
//           "Do you have an ATWEH?" on a weekend or holiday (Phase 9).
export type CheckinRequest =
  | { mode: 'entry'; source: 'checkin' | 'hotkey' }
  | { mode: 'missed'; days: string[] }
  | { mode: 'extra'; date: string }

// ---- Attendance (Phase 9)

export type Approval = 'yes' | 'no' | 'pending'

// One day's time record. Times are full local timestamps ('2026-11-06T07:52:00'), so a
// time-out after midnight still belongs to the day you timed in. A row with no timeIn
// means you told Pong "Not working today".
export interface Attendance {
  date: string // the day you timed in, 'YYYY-MM-DD'
  timeIn: string | null
  lunchOut: string | null
  lunchIn: string | null
  timeOut: string | null
  lastSeen: string | null // the last time Pong saw you at the PC during this session
  // A weekend, holiday or leave day. Its whole session is extended hours, which needs
  // an Authority to Work on Extended Hours (ATWEH); a work day's extra time is OT.
  nonWorkDay: boolean
  approved: Approval | null // OT approved / ATWEH in hand. null = not asked yet
}

// What the renderer (Today view, extra-time card) may change on a day's record.
export type AttendanceChanges = Partial<
  Pick<Attendance, 'timeIn' | 'lunchOut' | 'lunchIn' | 'timeOut' | 'nonWorkDay' | 'approved'>
>

// Where today's session stands, for the hover buttons and the tray menu.
//   off: attendance is switched off in Settings
//   none: not timed in yet;  declined: "Not working today"
//   in / lunch: timed in (and out for lunch);  out: timed out
export type SessionState = 'off' | 'none' | 'declined' | 'in' | 'lunch' | 'out'

// ---- Pong on the taskbar (Phases 4 and 6)

export type PongMood = 'sleep' | 'peek' | 'ask' | 'listen' | 'happy' | 'snooze'

// What Pong's speech bubble shows, if anything.
//   ask:    "What are you up to?" [Tell Pong] [Later] [On a break]
//   missed: "Good morning! I didn't hear from you on ..." [Fill them in] [Later]
//   toast:  a short dark note after something happened ("Saved to ...")
//   time-in:    "Good morning! Time in at 7:52 AM?" [Time in] [Not working today]
//               nonWork names the day when it isn't a work day ("Saturday", "a holiday")
//   forgot-out: "You didn't time out on Thursday. Last seen 5:42 PM." [Use 5:42 PM] [Fix in Today]
//   ot-ask:     "Still working? Overtime?" [Yes, OT] [Time out now] [I left at 5:00 PM]
//   lunch-back: "Back from lunch?" [I'm back] [Not yet]
// Times in bubbles are 'HH:MM'; the renderer shows them as 7:52 AM.
export type Bubble =
  | { kind: 'ask'; sub: string }
  | { kind: 'missed'; days: string[] }
  | { kind: 'toast'; title: string; sub: string }
  | { kind: 'time-in'; at: string; nonWork: string | null }
  | { kind: 'forgot-out'; date: string; lastSeen: string }
  | { kind: 'ot-ask'; end: string }
  | { kind: 'lunch-back' }

// Main owns this and sends it to the pong window whenever it changes.
export interface PongState {
  mood: PongMood
  bubble: Bubble | null
  animations: boolean // the Animations setting
  session: SessionState // which buttons show when you hover over Pong
  trackLunch: boolean // the Track lunch setting: show Lunch out / Back from lunch
}

// What a click in the pong window asks main to do.
//   time-in ... fix-today: the attendance buttons (bubbles and hover chips)
export type PongAction =
  | 'click' | 'tell' | 'later' | 'break' | 'fill' | 'dismiss'
  | 'time-in' | 'not-working' | 'time-out' | 'lunch-out' | 'lunch-in'
  | 'ot-yes' | 'left-at' | 'use-last-seen' | 'fix-today'
