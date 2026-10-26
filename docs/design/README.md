# Design references

- `Pong.tsx`: the turtle, six moods. The app's copy lives in `src/renderer/src/components/Pong.tsx`.
- `boards/*.dc.html`: the boards from the "Pong DAR Buddy" design canvas. They don't open on their own (they need the canvas runtime), but the markup and the data in each file's `renderVals()` are the spec: exact colors, sizes, copy and states.

| Board | What it shows | Used in |
|---|---|---|
| `Main.dc.html` | Pong on the taskbar: bubble, entry card, missed-day card, saved state | Phases 3, 4, 6 |
| `App.dc.html` | Main window: Today and Cutoff (DAR) | Phase 5 |
| `Characters.dc.html` | The six moods and the color swatches | Phase 6 |
| `Settings.dc.html` | Settings: Check-ins, Shortcuts, DAR profile, General | Phase 7 |
| `How.dc.html` | How it works (originally written for Tauri; the flow still applies) | Overview |
| `Pong.dc.html` | The turtle as a canvas component | Phase 6 |

Fonts: Fredoka 500/600 for headings, Nunito 400-800 for body. Ground #FFFCF7, borders #EFE6D6, muted text #6B6259.
