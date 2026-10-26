export const WINDOW_LABELS = ['pong', 'checkin', 'main'] as const

export type WindowLabel = (typeof WINDOW_LABELS)[number]

export function isWindowLabel(value: unknown): value is WindowLabel {
  return typeof value === 'string' && (WINDOW_LABELS as readonly string[]).includes(value)
}

// Each window loads index.html?window=<label>; anything else falls back to main.
export function windowLabelFromSearch(search: string): WindowLabel {
  const value = new URLSearchParams(search).get('window')
  return isWindowLabel(value) ? value : 'main'
}
