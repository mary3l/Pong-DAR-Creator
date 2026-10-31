// cutoff.ts: cutoff periods and the DAR grid.
// Pure functions: data in, data out. No database, no Electron, no clock (today is
// always passed in). That's what makes them easy to test thoroughly.
import { addDays, dayOfWeek, fromIso, isWeekend, toIso } from './dates'
// `import type` brings in types only; nothing is loaded at runtime.
import type { DayStatus, DayType, Duty, Entry, Output, Period, Progress } from './types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
// Indexed by dayOfWeek(): 0 = SUN ... 6 = SAT, as row 17 of the DAR shows them.
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// The text a day-off cell shows on the sheet, per day_status type.
// Record<DayType, string> = an object with exactly one string for every DayType;
// TypeScript complains if one is missing.
export const DAY_OFF_LABEL: Record<DayType, string> = {
  rest: 'Rest Day',
  sick: 'Sick Leave',
  personal: 'Personal Leave',
  holiday: 'Holiday'
}

// Builds 'YYYY-MM-DD' from numbers (month 1-12).
// Date.UTC rolls month 0 back to December and month 13 on to January for us.
function ymd(year: number, month: number, day: number): string {
  return toIso(new Date(Date.UTC(year, month - 1, day)))
}

// Which cutoff a date belongs to. Periods run 3rd-17th and 18th-2nd of the next month.
//   Oct 10 -> Oct 3 - Oct 17
//   Oct 20 -> Oct 18 - Nov 2
//   Nov 1  -> Oct 18 - Nov 2   (the 1st and 2nd belong to the previous month's period)
export function periodFor(date: string): Period {
  // '2026-10-20' -> ['2026', '10', '20'] -> [2026, 10, 20]
  const [year, month, day] = date.split('-').map(Number)
  if (day >= 3 && day <= 17) return { start: ymd(year, month, 3), end: ymd(year, month, 17) }
  if (day >= 18) return { start: ymd(year, month, 18), end: ymd(year, month + 1, 2) } // month + 1 may be 13: fine
  return { start: ymd(year, month - 1, 18), end: ymd(year, month, 2) } // month - 1 may be 0: fine
}

// Every date in a period, in order: one per DAR day column.
// The loop works because 'YYYY-MM-DD' strings compare like dates.
export function daysIn(period: Period): string[] {
  const days: string[] = []
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) days.push(d)
  return days
}

// The Excel sheet's name: "October 3 - 17" or "October 18 - November 2".
// The month is repeated after the dash only when it changes.
export function sheetName(period: Period): string {
  const start = fromIso(period.start)
  const end = fromIso(period.end)
  const startPart = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`
  const endPart =
    start.getUTCMonth() === end.getUTCMonth()
      ? `${end.getUTCDate()}`
      : `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`
  return `${startPart} - ${endPart}`
}

// "Date Submitted" in L9: '2026-10-22' -> "October 22, 2026".
export function longDate(date: string): string {
  const d = fromIso(date)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// For Pong's questions about missed days.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// '2026-10-24' -> "Saturday, Oct 24"
export function dayLong(date: string): string {
  const d = fromIso(date)
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`
}

// '2026-10-24' -> "Saturday"
export function weekdayName(date: string): string {
  return WEEKDAYS[dayOfWeek(date)]
}

// How Pong says a past day: "yesterday", "on Saturday" (this past week), or "on Oct 12".
export function whenSaid(date: string, today: string): string {
  if (addDays(date, 1) === today) return 'yesterday'
  if (addDays(date, 7) > today) return `on ${weekdayName(date)}`
  const d = fromIso(date)
  return `on ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`
}

// The missed-day question: "Rest day on Saturday?" for a weekend, "Day off yesterday?" otherwise.
export function missedQuestion(date: string, today: string): string {
  return `${isWeekend(date) ? 'Rest day' : 'Day off'} ${whenSaid(date, today)}?`
}

// Past days in today's period with no notes and no day_status row: Pong asks about these.
// Pick<Entry, 'workDate'> = "any object with at least a workDate", so callers can pass
// full entries or just { workDate } in tests.
// `since` ('YYYY-MM-DD', optional): the day you set Pong up. Days before it are never
// "missed": Pong wasn't there to ask.
export function missedDays(
  today: string,
  entries: Pick<Entry, 'workDate'>[],
  dayStatus: DayStatus[],
  since = ''
): string[] {
  // A Set answers "is this date in here?" instantly, without scanning a list each time.
  const logged = new Set(entries.map((e) => e.workDate))
  const marked = new Set(dayStatus.map((s) => s.date))
  return daysIn(periodFor(today)).filter((d) => d >= since && d < today && !logged.has(d) && !marked.has(d))
}

// ---------------------------------------------------------------------------
// The DAR grid: everything Phase 2 needs to write one sheet, and Phase 5 to show it.
// ---------------------------------------------------------------------------

// One day column (H, I, J ...).
export interface GridDay {
  date: string
  index: number // 1..n, row 15 of the sheet
  dayName: string // SAT, SUN, MON ...
  off: string | null // "Rest Day", "Sick Leave" ... or null on a work day
}

// One MFO row: the MFO plus one cell per day.
export interface GridRow {
  output: Output
  cells: (Progress | null)[] // one per day, highest % logged that day
}

// One duty block with its MFO rows.
export interface GridDuty {
  duty: Duty
  rows: GridRow[]
}

export interface DarGrid {
  period: Period
  sheetName: string
  days: GridDay[]
  core: GridDuty[] // section A.)
  support: GridDuty[] // section B.)
  daysAttended: number // "Actual No. of Days Attended" in L10
}

// Turns raw notes into the DAR grid. Nothing is stored: the grid is rebuilt from
// notes every time, so editing a note fixes the DAR automatically.
export function buildGrid(
  period: Period,
  entries: Entry[],
  duties: Duty[],
  outputs: Output[],
  dayStatus: DayStatus[]
): DarGrid {
  // Ignore notes outside the period, in case the caller passed extra.
  const inPeriod = entries.filter((e) => e.workDate >= period.start && e.workDate <= period.end)
  // Map = lookup table: date -> 'sick' etc.
  const statusByDate = new Map(dayStatus.map((s) => [s.date, s.type]))
  const loggedDates = new Set(inPeriod.map((e) => e.workDate))

  // 1. The day columns.
  // A day_status row always wins; a weekend with no notes is a rest day.
  const days: GridDay[] = daysIn(period).map((date, i) => {
    const status = statusByDate.get(date)
    // Nested ternary: status label, else Rest Day for an empty weekend, else a work day.
    const off = status
      ? DAY_OFF_LABEL[status]
      : isWeekend(date) && !loggedDates.has(date)
        ? DAY_OFF_LABEL.rest
        : null
    return { date, index: i + 1, dayName: DAY_NAMES[dayOfWeek(date)], off }
  })

  // 2. Highest progress per MFO per day.
  // Key '3|2026-10-05' = MFO 3 on Oct 5. Two notes the same day at 25% then 75% -> 75%.
  const best = new Map<string, Progress>()
  for (const e of inPeriod) {
    if (e.outputId === null || e.progress === null) continue // a plain note: no cell to fill
    const key = `${e.outputId}|${e.workDate}`
    const prev = best.get(key)
    if (prev === undefined || e.progress > prev) best.set(key, e.progress)
  }

  // 3. The rows for one duty: its MFOs oldest first, each with a cell per day.
  const rowsFor = (duty: Duty): GridRow[] =>
    outputs
      .filter((o) => o.dutyId === duty.id)
      // Sort by createdAt; if equal (0), fall back to id. `||` picks the first non-zero.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
      .map((output) => ({
        output,
        // Off days stay blank: the sheet shows one merged "Rest Day" cell there instead.
        cells: days.map((d) => (d.off ? null : (best.get(`${output.id}|${d.date}`) ?? null)))
      }))
      // Finished MFOs drop off the sheet unless they have a % in this period.
      .filter((row) => row.output.status === 'active' || row.cells.some((c) => c !== null))

  // 4. The duty blocks for one section, in their sort order.
  const blocks = (category: Duty['category']): GridDuty[] =>
    duties
      .filter((d) => d.category === category)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((duty) => ({ duty, rows: rowsFor(duty) }))
      // Archived duties only appear if something in them still has rows.
      .filter((block) => !block.duty.archived || block.rows.length > 0)

  return {
    period,
    sheetName: sheetName(period),
    days,
    core: blocks('core'),
    support: blocks('support'),
    // Days with at least one note, minus days marked off.
    daysAttended: days.filter((d) => loggedDates.has(d.date) && !statusByDate.has(d.date)).length
  }
}