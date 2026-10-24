// A running agent's bar: a three-cell block bouncing along its track, one cell every 100 ms on the
// surface's own clock, so the pane does not redraw to animate it.
import type { ClientModule } from 'claude-code'

type Props = { width: number; color: string; track: string }
type Ref = { at: number; step: number }
type State = { ref: Ref }

const STEP_MS = 100
const BLOCK = 3

const Sweep: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const span = Math.max(0, props.width - BLOCK)
  const ref = surface.state?.ref ?? { at: 0, step: 1 }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (span === 0) return
      // At either end of the track the block turns round.
      if (ref.at + ref.step > span || ref.at + ref.step < 0) ref.step = -ref.step
      ref.at += ref.step
      surface.setState({ ref })
    })
  }
  const at = Math.min(ref.at, span)
  return (
    <Text>
      <Text color={props.track}>{'▱'.repeat(at)}</Text>
      <Text color={props.color}>{'▰'.repeat(Math.min(BLOCK, props.width))}</Text>
      <Text color={props.track}>{'▱'.repeat(Math.max(0, props.width - at - BLOCK))}</Text>
    </Text>
  )
}

export default Sweep
