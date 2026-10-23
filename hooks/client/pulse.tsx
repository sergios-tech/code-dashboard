// The header's state dot, pulsing bright and dim on the surface's own frame clock while work runs,
// so the pane itself does not redraw twice a second just to animate one glyph.
import type { ClientModule } from 'claude-code'

type Props = { active: boolean; color: string; dim: string }
type Ref = { isBright: boolean; active: boolean }
type State = { ref: Ref }

const PHASE_MS = 600

const Pulse: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { isBright: true, active: props.active }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(PHASE_MS, () => {
      // At rest the dot holds still: no redraws until it is active again.
      if (!ref.active) return
      ref.isBright = !ref.isBright
      surface.setState({ ref })
    })
  }
  const isBright = !props.active || ref.isBright
  return (
    <Text color={isBright ? props.color : props.dim} bold={isBright}>
      ●
    </Text>
  )
}

export default Pulse
