import { useState } from 'react'
import Pong, { type PongMood } from '../../components/Pong'

const MOODS: PongMood[] = ['sleep', 'peek', 'ask', 'listen', 'happy', 'snooze']

// Phase 0 placeholder: click Pong to cycle through his moods.
// Phase 6 replaces this with the bubble, click-through and scheduler-driven moods.
export default function PongWindow() {
  const [index, setIndex] = useState(0)

  return (
    <div
      style={{ height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={() => setIndex((i) => (i + 1) % MOODS.length)}
    >
      <Pong mood={MOODS[index]} size={120} />
    </div>
  )
}
