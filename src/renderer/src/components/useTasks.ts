// useTasks.ts: loads the duties and MFOs a note can be tagged with. Runs in the RENDERER.
// A "hook": a function starting with `use` that React components call to share logic.
import { useCallback, useEffect, useState } from 'react'
import type { Duty, Entry, Output } from '../../../shared/types'

export interface Tasks {
  duties: Duty[]
  outputs: Output[] // every MFO, done ones too
  recent: Output[] // the 5 chips
  last: Entry | null // the newest tagged note: its MFO and % are preselected
  reload: () => Promise<Tasks>
}

export function useTasks(): Tasks {
  const [data, setData] = useState<Omit<Tasks, 'reload'>>({ duties: [], outputs: [], recent: [], last: null })

  // useCallback keeps the same function between renders, so effects that use it
  // don't re-run for nothing. Promise.all asks main for all four at once.
  const reload = useCallback(async (): Promise<Tasks> => {
    const [duties, outputs, recent, last] = await Promise.all([
      window.pong.listDuties(),
      window.pong.listOutputs(),
      window.pong.recentOutputs(),
      window.pong.lastTagged()
    ])
    const next = { duties, outputs, recent, last }
    setData(next)
    return { ...next, reload }
  }, [])

  // Again whenever main says something changed, e.g. an MFO added in the Tasks tab
  // while the check-in card is open.
  useEffect(() => {
    reload()
    return window.pong.onDataChanged(() => reload())
  }, [reload])

  return { ...data, reload }
}

// Under the task chips: where the note's % lands on the DAR sheet. The note's own
// words never go to the DAR; only the task's row and the day's highest %.
export function dutyLine(output: Output | undefined, duties: Duty[]): string {
  const duty = output && duties.find((d) => d.id === output.dutyId)
  if (!duty) return 'Not tagged: the note stays in Pong and adds nothing to the DAR.'
  const section = duty.category === 'core' ? 'A.) Specific duties' : 'B.) Support functions'
  return `On the DAR: the % goes in the row "${output.title}", under ${duty.title} (${section}). Your note's words stay in Pong.`
}
