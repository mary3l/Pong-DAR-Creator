# Building Pong in Electron, phase by phase

This replaces the Tauri phase prompts in the dev plan doc. Same phases, same "Done when" checks, same dates; only the tech underneath changes.

## How to work through this

1. Open a terminal in this folder (PowerShell or Windows Terminal) and run `claude`.
2. Paste one phase prompt below. Claude Code starts in plan mode: read the plan, ask questions, approve it.
3. When it's done, run the phase's **Done when** check yourself.
4. Commit: `git add -A` then `git commit -m "Phase N: <summary>"`.
5. New Claude Code session for the next phase (`/clear` or a new terminal).

Don't start a phase on a failing check. Until Phase 8, exports go to a copy of the workbook, never your real one.

## Electron in five minutes

An Electron app is three kinds of JavaScript talking to each other:

| Process | Runs | Can do | In this repo |
|---|---|---|---|
| **main** | Node.js, one per app | Windows, tray, hotkeys, files, SQLite, Excel, timers | `src/main/` |
| **renderer** | Chromium, one per window | React UI only. No `fs`, no `require` | `src/renderer/` |
| **preload** | Before each page loads | Exposes a small, safe API to the renderer | `src/preload/` |

The renderer asks main for things through the preload API:

```
React button  ->  window.pong.showWindow('checkin')     (renderer)
              ->  ipcRenderer.invoke('window:show', ...) (preload)
              ->  ipcMain.handle('window:show', ...)     (main: does the real work)
```

Every new feature follows that path: add the work in `src/main/`, a handler in `ipcMain`, one method in `src/preload/index.ts`, its type in `src/preload/index.d.ts`, then call it from React.

**What Electron gives you for free** (Tauri needed plugins or Rust for these): tray, global shortcuts, dialogs, autostart, single instance, idle time, lock/sleep events, monitor work area, DPI, click-through windows, showing a window without stealing focus.

**What costs more in Electron:** installer size (~90 MB vs ~10 MB) and RAM (~150 MB). Fine for a personal tool.

---

## Phase 0 · Setup — done for you

Already in this folder: Electron + React + TypeScript via electron-vite, the three windows (`pong`, `checkin`, `main`), routing by `?window=`, Fredoka/Nunito fonts, Vitest, `CLAUDE.md`, and the design references.

What you do:

1. Install Node 24 LTS from nodejs.org (or `winget install OpenJS.NodeJS.LTS`), then open a **new** terminal and check `node -v` shows v24.
2. Copy your DAR workbook to `docs/reference/MABANO_DAR_sample.xlsx` (a copy, never the live one).
3. In this folder:
   ```
   npm install
   npm test
   npm run typecheck
   npm run dev
   ```
4. In the main window, click **Show pong** and **Show check-in**. Pong appears bottom-right with no frame; the check-in card appears and Esc hides it.
5. Commit: `git add -A` then `git commit -m "Phase 0: Electron scaffold"`.

**Done when:** `npm run dev` opens the main window, the other two windows can be shown from the dev buttons, and `npm test` passes.

If `npm install` fails while downloading Electron (office proxy), set `ELECTRON_MIRROR` or ask IT; everything else is a normal npm install.

---

## Phase 1 · Data layer — Oct 26 – Nov 1

```text
Read CLAUDE.md. Phase 1: data layer. Plan first, and explain which process each piece runs in.
- Add better-sqlite3 (and @types/better-sqlite3). Make sure it is rebuilt for Electron (postinstall install-app-deps) and marked external in the main build.
- src/main/db.ts: open pong.db in userData, WAL mode, foreign keys on, migrations as an ordered array tracked with PRAGMA user_version, for the six tables in CLAUDE.md.
- src/main/queries.ts: addEntry, entriesByDate, entriesInPeriod, duties and MFO CRUD, profile get/set, dayStatus get/set.
- IPC: ipcMain.handle for each query, exposed on window.pong in the preload with types in index.d.ts. Validate arguments in main.
- Seed script (scripts/seed.ts, run with `npm run seed`): read docs/reference/MABANO_DAR_sample.xlsx (sheet "October 3 - 17") with ExcelJS and seed profile, duties, MFOs and one entry per filled % cell.
- src/shared/cutoff.ts (pure): periodFor(date), daysIn(period), sheetName(period), missedDays(today, entries, dayStatus), buildGrid(entries, duties, outputs, dayStatus).
- Vitest: 17th/18th and 2nd/3rd edges, February, Dec 18 - Jan 2, weekend with work, missed days.
- Add a temporary "DB check" panel in the main window that lists today's entries, so I can see IPC working end to end.
Done when: tests pass and buildGrid on the seeded data reproduces every % and Rest Day of "October 3 - 17", with 12 days attended.
```

You'll learn: native modules in Electron, IPC with `invoke`/`handle`, why the DB lives in main.

## Phase 2 · DAR export — Nov 2–8

```text
Read CLAUDE.md, especially "DAR sheet format" and "Export rules". Phase 2: src/main/export.ts with ExcelJS. Plan first.
- exportDar(workbookPath, period) in main, exposed as window.pong.exportDar: build the grid, copy the newest sheet into a new worksheet (values, styles, merges, column widths, row heights, page setup, print area), rename it, clear the grid area, rewrite header, day columns, sections, duties, MFOs, % cells, day-off merges and footer.
- Handle 15- and 16-day periods (V vs W) and any number of duties and MFOs, keeping borders and merges.
- Temp file, re-open check, .bak, then replace. Friendly error if the file is locked (EBUSY/EPERM).
- Work ONLY on a copy of docs/reference/MABANO_DAR_sample.xlsx.
- Vitest: regenerate "October 3 - 17" from the seeded data into a copy in %TEMP%, then compare cell values and merges with the original.
- First, spike for 30 minutes: copy the sheet with ExcelJS, save, open in Excel. If theme fills or merges break, tell me before building the rest (fallback: write a standalone "October 3 - 17.xlsx").
Done when: Excel opens the generated sheet with no repair prompt and it matches the original sheet cell for cell.
```

You'll learn: ExcelJS, safe file writes on Windows. **Milestone M1.**

## Phase 3 · Check-in popup, tray, hotkeys — Nov 9–15

```text
Read CLAUDE.md (UX rules, Electron rules). Phase 3: logging without the scheduler. Plan first.
- checkin window: entry card exactly as in docs/design/boards/Main.dc.html (one-line input, 5 recent MFO chips + "+ New task" with duty picker, 25/50/75/100% buttons, last MFO and % preselected, Enter saves, Esc hides).
- src/main/tray.ts: Tray with a Pong icon (build/tray.png, 16 and 32 px); left-click opens the check-in; menu Log now, Open, Pause 1 hr, Quit.
- src/main/shortcuts.ts: globalShortcut Control+Alt+L, Control+Alt+K, Control+Alt+P; unregister all on will-quit; tell me if one fails to register.
- Closing any window hides it; Quit only from the tray. Single instance (already in index.ts): a second launch opens the main window.
Done when: from any app I can press Ctrl+Alt+L, type a line, press Enter, and see the entry in SQLite in under 5 seconds.
```

You'll learn: Tray, Menu, globalShortcut, window lifecycle.

## Phase 4 · Scheduler and missed days — Nov 16–22

```text
Read CLAUDE.md. Phase 4: src/main/scheduler.ts, src/main/idle.ts and the missed-day check. Plan first.
- A 30 s setInterval in main deciding when the next check-in is due: interval (default 60 min) +/- 15 min random, only in work hours and work days, never at lunch or while paused. Put the "is it due?" logic in a pure function in src/shared with Vitest cases.
- idle.ts: powerMonitor.getSystemIdleTime() >= 600 s skips; lock-screen/suspend pauses, unlock-screen/resume allows at most one check-in.
- Full screen: koffi calling SHQueryUserNotificationState (shell32); skip on QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN and QUNS_PRESENTATION_MODE. If koffi gives trouble, fall back to comparing the foreground window with the display bounds and tell me.
- Later = snooze 15 min, On a break = pause 30 min.
- Missed days: on the first check-in of the day, use missedDays() and ask about each day, oldest first, with the missed-day card from docs/design/boards/Main.dc.html (Rest day / Sick leave / Personal leave, or add logs for that date).
- For now show the bubble in the checkin window with showInactive() (no focus); Phase 6 moves it into the pong window.
Done when: a full workday on my PC with no surprise pop-ups, and a Monday morning asks about Saturday and Sunday.
```

You'll learn: powerMonitor, calling a Windows API from Node with koffi. **Milestone M2: MVP, start daily use.**

## Phase 5 · Today and Cutoff window — Nov 23–29

```text
Read CLAUDE.md. Phase 5: the main window, matching docs/design/boards/App.dc.html. Plan first.
- Today: timeline of today's notes, edit or delete a note, add a missed note with a time; side panel with the highest % per MFO today.
- Cutoff (DAR): grid laid out like the real DAR (FUNCTIONS | MAJOR FINAL OUTPUT (MFOs) | one column per day; "Codes for the following:" rows; blue-gray % cells; gray merged day-off cells). Click a weekday's date to cycle Sick Leave, Personal Leave, Holiday.
- Export button calling window.pong.exportDar, success state, "Open in Excel" (shell.openPath in main).
- Manage duties and MFOs: add, rename, archive.
- Remove the Phase 0 dev buttons and the Phase 1 DB check panel.
Done when: I can export the current cutoff from this window into a copy of my workbook.
```

**Milestone M3, around Dec 3.**

## Phase 6 · Pong the turtle — Nov 30 – Dec 13

```text
Read CLAUDE.md and docs/design/Pong.tsx. Phase 6: the pong window. Plan first.
- src/renderer/src/components/Pong.tsx is the turtle. Animate with CSS: head in/out, bob while awake, hop on save, sparkles. Respect the Animations setting and prefers-reduced-motion.
- src/main/placement.ts: park the pong window on the top edge of the taskbar at the right, from screen.getPrimaryDisplay() workArea vs bounds (works for bottom, top, left, right taskbars). Re-place on display-metrics-changed, display-added, display-removed. Keep it above the taskbar with setAlwaysOnTop(true, 'screen-saver').
- Click-through: setIgnoreMouseEvents(true, { forward: true }); the renderer sends hover in/out for Pong's hitbox and the bubble; main toggles ignore off only while hovered.
- Move the bubble and the missed-day question into the pong window (focusable false, showInactive). The checkin window opens only on click or hotkey.
- Scheduler drives moods over IPC: sleep -> peek (1 s) -> ask; save -> happy -> sleep; Later -> snooze.
Done when: Pong runs a whole day at 100%, 125% and 150% scaling without eating a click meant for the app behind him.
```

You'll learn: transparent windows, click-through, multi-window state. This is the phase to squeeze if December gets busy; M3 doesn't depend on it.

## Phase 7 · Settings and housekeeping — Dec 14–20

```text
Read CLAUDE.md. Phase 7: Settings, first run, backups. Plan first.
- Settings in the main window with Check-ins, Shortcuts, DAR profile, General, as in docs/design/boards/Settings.dc.html. Store them in src/main/settings.ts (JSON in userData, written atomically), not a new package.
- First run: profile form + pick the DAR workbook (dialog.showOpenDialog in main).
- Autostart toggle via app.setLoginItemSettings with a --hidden arg; when started hidden, only the tray and Pong show. Missed-day question toggle.
- Daily SQLite backup with db.backup() into userData/backups, keep 14; "Back up now" and "Open folder" buttons. A log file in userData/logs for debugging.
Done when: a fresh install goes from first run to first check-in without editing any file.
```

## Phase 8 · Polish and ship — Dec 21 – Jan 3

```text
Read CLAUDE.md. Phase 8: release. Plan first.
- Walk the testing checklist from the dev plan with me and fix what fails.
- App icon from Pong: a 1024 px PNG in build/icon.png (electron-builder makes the .ico), tray icons, version 1.0.0, appId ph.dcwd.pong.
- npm run dist: NSIS per-user installer (no admin needed); list exactly where it is and its size.
- Switch export to my real workbook path (with the .bak safety) and export the current cutoff.
Done when: the cutoff DAR comes out of Pong and I submit it with only typo fixes.
```

Unsigned installers trigger SmartScreen ("More info -> Run anyway"). Check with IT before installing on the office PC. **Milestone M4: v1.0.**

---

## Tauri -> Electron cheat sheet

| Dev plan (Tauri) | Electron |
|---|---|
| `tauri-plugin-sql` | better-sqlite3 in main |
| `tauri-plugin-global-shortcut` | `globalShortcut` |
| `tauri-plugin-autostart` | `app.setLoginItemSettings` |
| `tauri-plugin-store` | JSON file in `app.getPath('userData')` |
| `tauri-plugin-dialog` + `fs` | `dialog` + Node `fs` in main |
| `tauri-plugin-single-instance` | `app.requestSingleInstanceLock()` |
| `tray-icon` feature | `Tray` + `Menu` |
| umya-spreadsheet (Rust) | ExcelJS |
| `windows` crate / `user-idle` | `powerMonitor` + koffi |
| `hover.rs` cursor polling | `setIgnoreMouseEvents(true, { forward: true })` |
| `capabilities/*.json` | preload API + argument checks in `ipcMain.handle` |
| `getCurrentWindow().label` | `?window=` query, read in `src/renderer/src/main.tsx` |
| `npm run tauri build` (MSI + NSIS) | `npm run dist` (NSIS) |
