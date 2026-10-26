# Pong DAR Buddy

Pong the turtle sits on your Windows taskbar, asks what you're up to about once an hour, and turns your notes into a ready-to-sign DAR sheet at each cutoff. Electron + React + TypeScript, local only.

- Build guide, phase by phase: [docs/PHASES.md](docs/PHASES.md)
- Project rules for Claude Code: [CLAUDE.md](CLAUDE.md)
- Design references: [docs/design/](docs/design/README.md)

## Run it

Needs Node 24 LTS.

```
npm install
npm run dev
```

`npm test` runs the unit tests, `npm run typecheck` checks types, `npm run dist` builds the Windows installer into `dist/`.
