// PercentPicker.tsx: the 25 / 50 / 75 / 100% buttons. Runs in the RENDERER.
import type { Progress } from '../../../shared/types'

const STEPS: { value: Progress; sub: string }[] = [
  { value: 0.25, sub: 'started' },
  { value: 0.5, sub: 'halfway' },
  { value: 0.75, sub: 'almost' },
  { value: 1, sub: 'done' }
]

export default function PercentPicker(props: { value: Progress; onChange: (value: Progress) => void }) {
  return (
    <div className="pcts" role="group" aria-label="How far along?">
      {STEPS.map((step) => (
        <button
          key={step.value}
          type="button"
          className="pct"
          aria-pressed={props.value === step.value}
          onClick={() => props.onChange(step.value)}
        >
          <b>{step.value * 100}%</b>
          <small>{step.sub}</small>
        </button>
      ))}
    </div>
  )
}
