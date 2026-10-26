import { describe, expect, it } from 'vitest'
import { isWindowLabel, windowLabelFromSearch } from './windowLabel'

describe('isWindowLabel', () => {
  it('accepts the three window labels', () => {
    expect(isWindowLabel('pong')).toBe(true)
    expect(isWindowLabel('checkin')).toBe(true)
    expect(isWindowLabel('main')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isWindowLabel('settings')).toBe(false)
    expect(isWindowLabel('')).toBe(false)
    expect(isWindowLabel(undefined)).toBe(false)
    expect(isWindowLabel(42)).toBe(false)
  })
})

describe('windowLabelFromSearch', () => {
  it('reads ?window=', () => {
    expect(windowLabelFromSearch('?window=pong')).toBe('pong')
    expect(windowLabelFromSearch('?foo=1&window=checkin')).toBe('checkin')
  })

  it('falls back to main', () => {
    expect(windowLabelFromSearch('')).toBe('main')
    expect(windowLabelFromSearch('?window=nope')).toBe('main')
  })
})
