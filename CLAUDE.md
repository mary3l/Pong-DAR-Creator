# Pong DAR Buddy

Windows tray app. Pong, a cartoon turtle, sits on the taskbar and asks "What are you up to?" about once an hour during work hours. Each answer is one line tagged to a DAR task (MFO) with progress 25/50/75/100%. At each cutoff, Pong adds a new, correctly formatted sheet to the user's Job Order Employee Daily Accomplishment Report (DAR) workbook.

Single user, local only, no network calls. Owner: Mariel G. Mabano, Information Systems Designer, DCWD Corporate Planning Department.

Build guide: `docs/PHASES.md` (one phase per session, in order).

## Stack
- Electron 44 + electron-vite 6 (Vite 8), React 19 + TypeScript, Node 24 LTS for tooling
- Three processes: `main` (Node: windows, tray, DB, scheduler, Excel), `preload` (the only bridge), `renderer` (React, no Node access)
- SQLite via better-sqlite3 in the main process (added in Phase 1). Settings: a small JSON file in userData (`src/main/settings.ts`), no extra package
- Excel: ExcelJS in the main process (added in Phase 2)
- Built into Electron, no plugin needed: `Tray`, `Menu`, `globalShortcut`, `dialog`, `screen`, `powerMonitor`, `app.setLoginItemSettings` (autostart), `app.requestSingleInstanceLock`
- Full-screen check: koffi (FFI) calling `SHQueryUserNotificationState` in shell32 (added in Phase 4)
- Tests: Vitest (`src/**/*.test.ts`)
- Styling: plain CSS, no UI kit. Fonts Fredoka (headings) and Nunito (body) bundled with @fontsource, no CDN
- Packaging: electron-builder, NSIS per-user installer

## Commands
- `npm run dev`: run the app with hot reload
- `npm test`: Vitest
- `npm run typecheck`: tsc for main/preload and renderer
- `npm run build`: typecheck + bundle to `out/`
- `npm run dist`: build + NSIS installer in `dist/`

## Layout
```
src/
  main/              Node side
    index.ts         app lifecycle, single instance, IPC handlers
    windows.ts       create + show/hide the three windows
    tray.ts          tray icon + menu                 (Phase 3)
    shortcuts.ts     global hotkeys                   (Phase 3)
    db.ts            better-sqlite3, migrations       (Phase 1)
    queries.ts       typed queries                    (Phase 1)
    export.ts        DAR sheet writer (ExcelJS)       (Phase 2)
    scheduler.ts     check-in timer                   (Phase 4)
    idle.ts          idle, lock/sleep, full screen    (Phase 4)
    placement.ts     park the pong window on the taskbar (Phase 6)
    settings.ts      JSON settings in userData        (Phase 7)
  preload/
    index.ts         contextBridge: window.pong API (the ONLY renderer -> main path)
    index.d.ts       types for window.pong
  shared/            pure TS used by both sides, unit-tested
    windowLabel.ts   window label <-> ?window= query
    cutoff.ts        period math + DAR grid builder   (Phase 1)
    types.ts         Entry, Duty, Output, DayStatus, Period ...
  renderer/
    index.html       one page for all three windows
    src/main.tsx     picks the screen from ?window=pong|checkin|main
    src/windows/pong/      turtle + bubble
    src/windows/checkin/   entry card
    src/windows/main/      Today, Cutoff, Settings
    src/components/Pong.tsx
docs/reference/MABANO_DAR_sample.xlsx   read-only copy of the real workbook
docs/design/Pong.tsx                    turtle reference
docs/design/boards/*.dc.html            design boards (markup is the spec; see docs/design/README.md)
```
One renderer bundle. Each window loads `index.html?window=<label>` and `main.tsx` routes on it.

## Windows
| label | size | BrowserWindow options |
|---|---|---|
| pong | 140x150 | transparent, frame false, hasShadow false, alwaysOnTop ('screen-saver' level), skipTaskbar, focusable false, resizable false |
| checkin | 440x520 | frame false, alwaysOnTop, skipTaskbar, show false, resizable false |
| main | 1000x780 | normal window, autoHideMenuBar; closing hides it once the tray exists (Phase 3) |

All windows: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload `out/preload/index.js`.

## Data model
```sql
CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT, position TEXT, department TEXT,
  unit TEXT, team_leader TEXT, confirmed_by TEXT, confirmed_title TEXT, noted_by TEXT, noted_title TEXT,
  workbook_path TEXT);
CREATE TABLE duties (id INTEGER PRIMARY KEY, category TEXT NOT NULL CHECK (category IN ('core','support')),
  title TEXT NOT NULL, sort INTEGER, archived INTEGER DEFAULT 0);
CREATE TABLE outputs (id INTEGER PRIMARY KEY, duty_id INTEGER NOT NULL REFERENCES duties(id),
  title TEXT NOT NULL, short TEXT, status TEXT DEFAULT 'active', created_at TEXT);   -- MFOs
CREATE TABLE entries (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, work_date TEXT NOT NULL,
  text TEXT NOT NULL, output_id INTEGER REFERENCES outputs(id),
  progress REAL CHECK (progress IN (0.25, 0.5, 0.75, 1)), source TEXT DEFAULT 'checkin');
CREATE TABLE day_status (date TEXT PRIMARY KEY, type TEXT CHECK (type IN ('rest','sick','personal','holiday')));
CREATE TABLE exports (id INTEGER PRIMARY KEY, period_start TEXT, period_end TEXT, sheet_name TEXT, exported_at TEXT);
CREATE INDEX idx_entries_date ON entries(work_date);
```
Migrations: an ordered array of SQL strings in `db.ts`, tracked with `PRAGMA user_version`. The DB file is `pong.db` in `app.getPath('userData')` (`%APPDATA%\Pong` when installed, `%APPDATA%\Pong-dev` under `npm run dev`).

## Domain rules
- Cutoff periods: 3rd-17th, and 18th to the 2nd of the next month. Sheet name like "October 18 - November 2" (full month names, " - ", no leading zeros, max 31 chars).
- Grid: Function (A = Core, "SPECIFIC DUTIES AND RESPONSIBILITIES"; B = Support) -> Duty -> MFO rows, one column per day.
- Cell value = MAX(progress) for that MFO on that date, written as a number (0.25 ... 1) with format 0%.
- Day off = a day_status row, or a weekend date with no notes. It becomes one merged cell down the whole function block for that day, text "Rest Day", "Sick Leave", "Personal Leave" or "Holiday". A weekend with notes is a normal work day.
- Days attended = dates in the period with at least one note, excluding day_status dates. The sample's Oct 3-17 gives 12.
- Missed day = a past date in the current period with no notes and no day_status row.
- work_date is the local date (Asia/Manila), never UTC. Never use `toISOString().slice(0, 10)` for it.

## DAR sheet format (from "October 3 - 17" in the sample)
- Rows 2-5, merged A:last-day-column: "Republic of the Philippines", "DAVAO CITY WATER DISTRICT", "MacArthur Highway, Matina, Davao City", "Job Order Employee Daily Accomplishment Report".
- Rows 8-12: labels in B, ":" in D, values in E (Name of JOE, Position Title, Department, Unit, Team Leader). L8 "Period Covered: <period>", L9 "Date Submitted: <Month D, YYYY>", L10 "Actual No. of Days Attended: <n>".
- A14:G15 "SPECIFIC DUTIES AND RESPONSIBILITIES"; H14 "DAYS/PERCENTAGE COMPLETION" merged across the day columns; row 15 = day index 1..n.
- A16:D17 "FUNCTIONS", E16:G17 "MAJOR FINAL OUTPUT (MFOs)"; row 16 = dates (format d-mmm), row 17 = day names (SAT, SUN, MON ...).
- Day columns start at H. A 15-day period ends at V, a 16-day period at W: widen every A:V merge and the print area to the last day column.
- Section row "A.) SPECIFIC DUTIES AND RESPONSIBILITIES" merged across. Each Core duty: number in A and duty title in B:D, both merged down the block; "Codes for the following:" in E:G, then one MFO per row in E:G.
- Section row "B.) SUPPORT FUNCTIONS"; Support duties have no "Codes for the following:" row.
- % cell: solid fill FF8497B0, white bold 10 pt, centered.
- Day-off cell: solid fill FF808080, white bold 10 pt, centered, wrap text.
- Footer: "Prepared by:" in A, "Confirmed by:" in J, "Noted by:" in O; names two rows below, position titles under the names. Landscape; print area A1 to the last used cell.
- Header fills are theme colors (light blue): copy styles from the template sheet, never hard-code them.
- The sample has leftovers, e.g. H20 "Rest Day" in white on white. Clear the whole grid area (values, merges, fills) before writing.

## Export rules
- Template = the newest sheet in the workbook. ExcelJS has no sheet clone: copy it into a new worksheet (cell values, styles, merges, column widths, row heights, page setup, print area), then rename.
- Never edit the workbook in place: write <name>.pong-tmp.xlsx, re-open it with ExcelJS to verify, keep <name>.bak.xlsx, then replace.
- If the workbook is locked (open in Excel: opening it for writing fails with EBUSY/EPERM), stop and say so.
- Until Phase 8, export only into a copy (docs/reference or %TEMP%).

## UX rules
- Automatic check-ins never take keyboard focus. The bubble lives in the pong window (focusable false, shown with `showInactive()`); checkin is shown and focused only after a click or hotkey.
- Pong moods (see docs/design/Pong.tsx): sleep (head in shell), peek, ask, listen, happy, snooze.
- Entry card: one-line input; 5 most recent MFOs as chips + "+ New task"; % buttons 25/50/75/100; last MFO and % preselected; Enter saves, Esc hides.
- Missed days: on the first check-in of a day, ask about each missed day, oldest first. "Rest day yesterday?" (or "Rest day on Saturday?"). Yes -> Rest day / Sick leave / Personal leave -> Save writes day_status. No -> entry card for that date; add several logs; "Done with <day>".
- Hotkeys: Ctrl+Alt+L log, Ctrl+Alt+K open main window, Ctrl+Alt+P pause 1 hour (Electron accelerators `Control+Alt+L` etc.).
- Stay quiet: outside work hours (default 8:00-17:00, Mon-Fri), lunch 12:00-13:00, idle 10+ min, full-screen foreground app, paused.
- Colors: shell #5E9E6E, skin #A9D69B, flower #F5B83D, teal #2F7F7A, mint #DCEBE4, ink #2A2622.

## Electron rules
- The renderer never gets Node. Every renderer -> main call is a named method on `window.pong` (preload), backed by `ipcMain.handle('<area>:<verb>')`. Validate every argument in main; never expose `ipcRenderer` itself.
- Packages used by main (better-sqlite3, exceljs, koffi) go in `dependencies`; they ship in the installer. Renderer-only packages (react, fonts) go in `devDependencies`, since Vite bundles them.
- better-sqlite3 is native: it must be rebuilt for Electron's ABI. `postinstall` runs `electron-builder install-app-deps`; if Electron fails with NODE_MODULE_VERSION, run `npx electron-builder install-app-deps`.
- Click-through: `win.setIgnoreMouseEvents(true, { forward: true })`; the renderer reports mouseenter/mouseleave on Pong's hitbox over IPC and main toggles it. No cursor polling.
- Positions use `screen` DIPs (Electron handles DPI). Re-place on `display-metrics-changed`, `display-added`, `display-removed`.
- Idle and lock: `powerMonitor.getSystemIdleTime()` (seconds), events `lock-screen`, `unlock-screen`, `suspend`, `resume`.

## Working agreements
- One phase per session (the user pastes the phase prompt from docs/PHASES.md). Start in plan mode and wait for approval.
- The user is learning Electron: in each plan, explain briefly which process each change runs in and why.
- Keep src/shared/cutoff.ts pure and tested; add a test for every bug fixed there.
- Small, readable code over abstractions. No new dependency without saying why.
- When showing code in chat, give complete files, not diffs.
- Never touch the user's real DAR workbook outside Phase 8.
- End each phase with a commit "Phase N: <summary>".
