// A running clock, ticking on the surface's own clock so the pane need not redraw each second.
// `since` and `now` come from the hooks module's clock; between redraws the module adds its own ticks.
import type { ClientModule } from 'claude-code'

import { fmtTimer } from '../format/text'

type Props = { since: number; now: number; endAt: number | null; color: string }
type Ref = { base: number; ticks: number; lastNow: number; isRunning: boolean }
type State = { ref: Ref }

const TICK_MS = 1000

const Elapsed: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, ticks: 0, lastNow: Number.NaN, isRunning: true }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: the local count starts again from it.
    ref.lastNow = props.now
    ref.base = (props.endAt ?? props.now) - props.since
    ref.ticks = 0
  }
  ref.isRunning = props.endAt === null
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(TICK_MS, () => {
      // A finished clock holds its value: no redraws.
      if (!ref.isRunning) return
      ref.ticks += 1
      surface.setState({ ref })
    })
  }
  return <Text color={props.color}>{fmtTimer(ref.base + ref.ticks * TICK_MS)}</Text>
}

export default Elapsed
