// dates.ts: calendar days as 'YYYY-MM-DD' strings.
// Pure helpers used by main, renderer and tests alike.
//
// Why strings and not Date objects? A JavaScript Date is a moment in time
// (milliseconds since 1970, UTC). Pong only cares about calendar days, and
// '2026-10-26' means the same day everywhere. Strings in this format also sort
// correctly as text: '2026-10-09' < '2026-10-10'. That's why cutoff.ts can
// compare dates with < and >=.
//
// Pong only cares about days, never time zones, so the math below uses UTC
// internally: no daylight-saving or midnight surprises.

// A regular expression: 4 digits, dash, 2 digits, dash, 2 digits.
// The ( ) groups capture year, month and day so fromIso() can read them.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// True only for a real date like '2026-10-26'. Used in ipc.ts to check
// dates coming from the renderer.
// `value is string` is a type guard: after `if (isIsoDate(x))`, TypeScript knows x is a string.
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  // The shape is right, but is it a real day? '2026-02-30' becomes March 2 when
  // turned into a Date, so converting there and back won't give the same string.
  return toIso(fromIso(value)) === value
}

// Today's date on this PC's clock. Do NOT use new Date().toISOString().slice(0, 10):
// that is UTC, so a 7:30 AM note in Davao would land on the previous day.
// getFullYear/getMonth/getDate read the LOCAL calendar instead.
// `now: Date = new Date()` is a default value: tests pass a fixed time, the app passes nothing.
export function localDate(now: Date = new Date()): string {
  // getMonth() counts from 0 (January = 0), hence the + 1.
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Local timestamp for entries.created_at, e.g. '2026-10-26T07:30:00'.
export function localTimestamp(now: Date = new Date()): string {
  return `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

// addDays('2026-10-31', 1) -> '2026-11-01'. Negative numbers go backwards.
// setUTCDate handles month and year ends for us: day 32 of October rolls into November.
export function addDays(date: string, days: number): string {
  const d = fromIso(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

// 0 = Sunday ... 6 = Saturday
export function dayOfWeek(date: string): number {
  return fromIso(date).getUTCDay()
}

export function isWeekend(date: string): boolean {
  const day = dayOfWeek(date)
  return day === 0 || day === 6
}

// '2026-10-26' -> a Date at midnight UTC on that day.
// exec() returns [whole match, year, month, day]; the leading comma skips the whole match.
// `?? []` gives an empty array if the string doesn't match, instead of crashing.
export function fromIso(date: string): Date {
  const [, y, m, d] = DATE_RE.exec(date) ?? []
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
}

// A Date -> '2026-10-26', read in UTC to match fromIso().
export function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// 5 -> '05'. Not exported: only this file uses it.
function pad(n: number): string {
  return String(n).padStart(2, '0')
}