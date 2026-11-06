<div align="center">

<img src="build/icon.png" alt="Pong the turtle" width="128" />

# Pong DAR Buddy

**A little turtle on your Windows taskbar that asks what you're up to and fills in your Daily Accomplishment Report.**

![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-5E9E6E)

[Features](#features) · [Install](#install) · [Usage](#usage) · [Development](#development) · [Project structure](#project-structure)

</div>

---

## About

Pong is a Windows tray app for Job Order employees at Davao City Water District who keep a **Job Order Employee Daily Accomplishment Report (DAR)** in Excel.

About once an hour during work hours, Pong peeks out of its shell and asks *"What are you up to?"*. You type one line, tag it to a DAR task (MFO) and pick how far along it is (25, 50, 75 or 100%). At each cutoff, Pong adds a new, correctly formatted sheet to your DAR workbook, ready to print and sign.

Everything stays on your PC. Pong makes no network calls.

## Features

- **Gentle check-ins.** A speech bubble on the taskbar that never steals keyboard focus. Click it (or press a hotkey) to answer.
- **One-line notes.** Your 5 most recent tasks as chips, the last task and % already picked. Enter saves, Esc hides.
- **Knows when to stay quiet.** Outside work hours, at lunch, when you're idle 10+ minutes, during full-screen apps (presentations, video, games), or when paused.
- **Catches missed days.** On your first check-in of the day, Pong asks about past workdays with no notes: log what you did, or mark a Rest day, Sick leave or Personal leave.
- **Commit suggestions.** Point Pong at local git repos and your own commits show up as ready-made notes. Local `git log` only, never GitHub.
- **DAR sheet export.** Builds the cutoff sheet (3rd-17th, or 18th to the 2nd) from the newest sheet in your workbook: header, duties and MFOs, one column per day, day-off cells, days attended, and signature footer.
- **Safe writes.** Writes to a temp file, verifies it, keeps a `.bak.xlsx`, then replaces. Stops and tells you if the workbook is open in Excel. The last export can be undone.
- **Tasks editor.** Manage core and support duties and their MFOs, or import them from your existing workbook on first run.
- **Daily backups** of your notes (newest 14 kept) and a log file per day.

## Install

1. Get `Pong-<version>-setup.exe` (from this repo's Releases, or build it yourself with `npm run dist`).
2. Run it. It installs for your user only, no admin rights needed.
3. Pong opens when the install finishes and shows a short setup form: your name and position, the DAR signatories, and your DAR workbook.

> [!NOTE]
> Windows SmartScreen may warn about an unrecognized app since the installer isn't code-signed. Click **More info → Run anyway**.

## Usage

### Hotkeys

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>L</kbd> | Log a note now, from any app |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>K</kbd> | Open the main window |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>P</kbd> | Pause check-ins for 1 hour |

### Main window

| Tab | What it's for |
|---|---|
| **Today** | Today's notes; edit or delete them |
| **Cutoff** | Preview the current period's DAR grid and add the sheet to your workbook |
| **Tasks** | Duties (core and support) and their MFOs |
| **Settings** | Check-in schedule, quiet rules, DAR profile and workbook, git repos, autostart |
| **How to use** | The full in-app guide and troubleshooting |

### Exporting a cutoff

1. Close your DAR workbook in Excel.
2. Open **Cutoff**, check the grid, and click **Add sheet to &lt;your workbook&gt;**.
3. Open the workbook: the new sheet (e.g. `October 18 - November 2`) is at the end.

### Default schedule

| Setting | Default |
|---|---|
| Ask every | 60 min (± 15 min so it feels natural) |
| Work hours | 8:00 - 17:00, Mon - Fri |
| Lunch | 12:00 - 13:00 |
| Start with Windows | On (tray and Pong only) |

All of these can be changed in **Settings**.

### Where your data lives

| What | Where |
|---|---|
| Notes, tasks, profile | `%APPDATA%\Pong\pong.db` (SQLite) |
| Settings | `%APPDATA%\Pong\settings.json` |
| Backups | `%APPDATA%\Pong\backups\` (newest 14) |
| Logs | `%APPDATA%\Pong\logs\pong-YYYY-MM-DD.log` |

Under `npm run dev` the folder is `%APPDATA%\Pong-dev` instead.

## Development

### Prerequisites

- Windows 10 or 11
- [Node.js 24 LTS](https://nodejs.org/)
- Git (optional, for commit suggestions)

### Getting started

```bash
git clone https://github.com/mary3l/Pong-DAR-Creator.git
cd Pong-DAR-Creator
npm install
npm run dev
```

> [!IMPORTANT]
> In dev mode Pong never touches a real workbook: exports always go to `%TEMP%\Pong\MABANO_DAR_copy.xlsx`. To seed sample data, put a **copy** of a DAR workbook in `docs/reference/` (see [docs/reference/README.md](docs/reference/README.md)). `.xlsx` files there are git-ignored.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Type-check main/preload and renderer |
| `npm run build` | Type-check and bundle to `out/` |
| `npm run dist` | Build the NSIS installer into `dist/` |
| `npm run icons` | Regenerate PNG icons from `build/pong.svg` |

### Tech stack

| Area | Choice |
|---|---|
| App shell | Electron 44, electron-vite 6 (Vite 8) |
| UI | React 19 + TypeScript, plain CSS, Fredoka and Nunito fonts (bundled) |
| Database | Node's built-in `node:sqlite`, no native module to rebuild |
| Excel | ExcelJS |
| Full-screen check | koffi calling `SHQueryUserNotificationState` |
| Tests | Vitest |
| Packaging | electron-builder, per-user NSIS installer |

### Architecture

Electron runs three kinds of processes:

```
┌──────────────┐   window.pong.*    ┌──────────────┐   ipcMain.handle   ┌───────────────────────────┐
│  renderer    │ ─────────────────▶ │   preload    │ ─────────────────▶ │  main (Node)              │
│  React UI    │                    │ the only     │                    │  windows, tray, hotkeys,  │
│  no Node     │ ◀───────────────── │ bridge       │ ◀───────────────── │  SQLite, scheduler, Excel │
└──────────────┘                    └──────────────┘                    └───────────────────────────┘
```

- **main** owns everything with side effects: windows, tray, database, scheduler, idle detection and the Excel writer.
- **preload** exposes a typed `window.pong` API through `contextBridge`. Every call is validated in main.
- **renderer** is one React bundle. Each window loads `index.html?window=pong|checkin|main` and routes on it.
- **shared** holds pure, unit-tested logic used by both sides: cutoff periods and the DAR grid, the check-in schedule, dates, settings, taskbar placement.

All windows run with `contextIsolation`, `sandbox` and no `nodeIntegration`.

## Project structure

```
src/
├── main/          Node side: lifecycle, IPC, windows, tray, DB, scheduler, export, git, idle
├── preload/       contextBridge: the window.pong API
├── shared/        pure TS used by both sides (cutoff math, schedule, dates, settings)
└── renderer/
    ├── index.html
    └── src/
        ├── windows/pong/      the turtle, speech bubble and toasts
        ├── windows/checkin/   entry card and missed-day card
        ├── windows/main/      first run, Today, Cutoff, Tasks, Settings, How to use
        └── components/        Pong, TaskPicker, PercentPicker, CommitSuggestions
build/             app and tray icons (pong.svg is the source)
docs/
├── PHASES.md      the build guide, one phase per session
├── design/        turtle reference and design boards
├── manual/        notes per phase
└── reference/     put a copy of your DAR workbook here (git-ignored)
scripts/           icon generator
```

## Documentation

- [docs/PHASES.md](docs/PHASES.md): how the app was built, phase by phase
- [docs/design/](docs/design/README.md): Pong's moods and the design boards
- [CLAUDE.md](CLAUDE.md): project rules, DAR sheet format and domain rules

## Author

**Mariel G. Mabano**, Information Systems Designer, Corporate Planning Department, Davao City Water District.
