// placement.test.ts: Pong finds the taskbar on any edge, at any scaling.
import { describe, expect, it } from 'vitest'
import { pongBounds, taskbarEdge } from './placement'

// A 1920x1080 screen at 100%, and the same screen at 150% (1280x720 DIPs).
const screen = { x: 0, y: 0, width: 1920, height: 1080 }
const size = { width: 140, height: 150 }

describe('taskbarEdge', () => {
  it('finds the taskbar on each edge', () => {
    expect(taskbarEdge(screen, { x: 0, y: 0, width: 1920, height: 1032 })).toBe('bottom')
    expect(taskbarEdge(screen, { x: 0, y: 48, width: 1920, height: 1032 })).toBe('top')
    expect(taskbarEdge(screen, { x: 62, y: 0, width: 1858, height: 1080 })).toBe('left')
    expect(taskbarEdge(screen, { x: 0, y: 0, width: 1858, height: 1080 })).toBe('right')
    expect(taskbarEdge(screen, screen)).toBe('none')
  })
})

describe('pongBounds', () => {
  it('sits on top of a bottom taskbar, near the clock', () => {
    expect(pongBounds(screen, { x: 0, y: 0, width: 1920, height: 1032 }, size)).toEqual({
      x: 1920 - 140 - 24,
      y: 1032 - 150,
      ...size
    })
  })

  it('works in DIPs at 150% and on a second monitor', () => {
    const scaled = { x: 1920, y: 0, width: 1280, height: 720 }
    const work = { x: 1920, y: 0, width: 1280, height: 688 }
    expect(pongBounds(scaled, work, size)).toEqual({ x: 1920 + 1280 - 164, y: 688 - 150, ...size })
  })

  it('stays inside the screen with the taskbar on the right or top', () => {
    const right = pongBounds(screen, { x: 0, y: 0, width: 1858, height: 1080 }, size)
    expect(right.x + right.width).toBeLessThanOrEqual(1858)
    const top = pongBounds(screen, { x: 0, y: 48, width: 1920, height: 1032 }, size)
    expect(top.y + top.height).toBe(1080)
  })

  it('grows up and left for the bubble, keeping the corner', () => {
    const work = { x: 0, y: 0, width: 1920, height: 1032 }
    const small = pongBounds(screen, work, size)
    const big = pongBounds(screen, work, { width: 460, height: 330 })
    expect(big.x + big.width).toBe(small.x + small.width)
    expect(big.y + big.height).toBe(small.y + small.height)
  })
})
