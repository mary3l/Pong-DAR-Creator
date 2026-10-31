// placement.ts (shared): where the pong window goes. Pure math on rectangles, so it's
// tested without a screen. main/placement.ts feeds it Electron's display info.
//
// A display has two rectangles, both in DIPs (Electron scales for 125%/150% for us):
//   bounds    the whole screen
//   workArea  the screen minus the taskbar
// Comparing them tells which edge the taskbar is on.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Edge = 'bottom' | 'top' | 'left' | 'right' | 'none'

export function taskbarEdge(bounds: Rect, workArea: Rect): Edge {
  if (workArea.y + workArea.height < bounds.y + bounds.height) return 'bottom'
  if (workArea.y > bounds.y) return 'top'
  if (workArea.x > bounds.x) return 'left'
  if (workArea.x + workArea.width < bounds.x + bounds.width) return 'right'
  return 'none' // auto-hide taskbar, or none at all
}

const MARGIN = 24 // from the right edge, clear of the clock

// Pong sits in the bottom-right corner of the work area. With the usual bottom taskbar
// that's right on its top edge, near the clock. With the taskbar on the right, he sits
// just left of it; at the top or left, he waits in the bottom-right corner of the screen.
// The window keeps its bottom-right corner there and grows up and left for the bubble.
export function pongBounds(bounds: Rect, workArea: Rect, size: { width: number; height: number }): Rect {
  const margin = taskbarEdge(bounds, workArea) === 'right' ? 4 : MARGIN
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + workArea.height - size.height),
    width: size.width,
    height: size.height
  }
}
