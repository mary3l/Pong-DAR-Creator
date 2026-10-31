// events.ts: a tiny message board inside the MAIN process.
// One part of main says "a note was saved"; whoever cares (tray, scheduler, Pong's mood)
// listens, without ipc.ts having to know about any of them.
//   events.emit('entry-saved', entry)            ipc.ts, after the INSERT
//   events.on('entry-saved', (entry) => ...)     tray.ts, scheduler.ts ...
// EventEmitter is Node's own; the <{...}> lists each event and what it carries.
import { EventEmitter } from 'node:events'
import type { Entry } from '../shared/types'

export const events = new EventEmitter<{
  'entry-saved': [entry: Entry]
  'day-status-saved': [date: string]
  'pause-changed': []
  'settings-changed': []
}>()
