// shortcuts.ts: hotkeys that work from any app, even while Pong's windows are hidden.
// Runs in the MAIN process: globalShortcut asks Windows itself for the key combo.
import { app, globalShortcut } from 'electron'
import { pause } from './scheduler'
import { openCheckin, showWindow } from './windows'

// Electron's accelerator names: Control+Alt+L = Ctrl+Alt+L.
const SHORTCUTS: { keys: string; label: string; run: () => void }[] = [
  { keys: 'Control+Alt+L', label: 'Log a note', run: () => openCheckin({ mode: 'entry', source: 'hotkey' }) },
  { keys: 'Control+Alt+K', label: 'Open Pong', run: () => showWindow('main') },
  { keys: 'Control+Alt+P', label: 'Pause 1 hour', run: () => pause(60) }
]

// Registers all three. Returns the ones Windows refused (another app already owns
// them), so index.ts can tell you. register() returns false in that case; it doesn't throw.
export function registerShortcuts(): string[] {
  const failed = SHORTCUTS.filter((s) => !globalShortcut.register(s.keys, s.run))
  // Hotkeys belong to the whole system: always give them back when Pong quits.
  app.on('will-quit', () => globalShortcut.unregisterAll())
  return failed.map((s) => `${s.keys.replace('Control', 'Ctrl')} (${s.label})`)
}
