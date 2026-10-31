// CheckinWindow.tsx: the check-in window. Runs in the RENDERER.
// Main decides what it shows (window.pong.onCheckinOpen): today's entry card, or the
// missed days. The window only ever opens after a click or a hotkey, so it may take focus.
import { useEffect, useRef, useState } from 'react'
import '../../styles/card.css'
import type { CheckinRequest } from '../../../../shared/types'
import EntryCard from './EntryCard'

export default function CheckinWindow() {
  const [request, setRequest] = useState<CheckinRequest | null>(null)
  // Bumped on every open: a new `key` makes React start the card fresh (empty box,
  // preselected task) instead of showing what was left from last time.
  const [opened, setOpened] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.pong.checkinRequest().then(setRequest) // in case main asked before we loaded
    // The return value (stop listening) runs when the component goes away.
    return window.pong.onCheckinOpen((next) => {
      setRequest(next)
      setOpened((n) => n + 1)
    })
  }, [])

  // Esc hides the window from anywhere in it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.pong.hideWindow('checkin')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The window is as tall as the card: ResizeObserver tells us whenever the card's
  // height changes (the "+ New task" panel opens, a % row appears), and main resizes.
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => {
      window.pong.fitCheckin(Math.min(900, Math.max(200, Math.ceil(entry.contentRect.height))))
    })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])

  const hide = () => window.pong.hideWindow('checkin')

  return (
    <div ref={root}>
      {request?.mode === 'entry' && <EntryCard key={opened} source={request.source} onDone={hide} />}
    </div>
  )
}
