// The header row on the black fill: the brand on the left, the state dot and the main model on the right.
import type { RenderElement } from 'claude-code'

import { canAnimate, clientNode } from './draw'
import type { Draw } from './draw'
import { headerFit } from './layout'
import type { ViewModel } from './model'
import { familyColor } from './palette'

const BRAND_CELLS = Array.from("▌SERGIO'S TECH · CODE").length

/** The state dot: `●` green, pulsing while work runs where the surface animates (a client module, or SMIL in a picture), else a plain `●`; `○` in the idle dark red at rest. */
export const stateDot = (d: Draw, isActive: boolean): RenderElement => {
  const { els, C } = d
  const { Text } = els
  return canAnimate(d) && isActive ? (
    clientNode(d, 'st-code-pulse', 'pulse', 1, { active: true, color: C.green, dim: C.pulse })
  ) : (
    <Text key="st-code-dot" bold={isActive} color={isActive ? C.green : C.idle}>
      {isActive ? '●' : '○'}
    </Text>
  )
}

/**
 * One unfilled row of `width` cells. Its dot marks any running work (a turn or a subagent) and
 * pulses while there is some; with nothing running it is a `○` in the idle dark red. INFO's frame
 * says whether the main loop works, so the row carries no state word. The right side drops the
 * architect suffix, then the model to fit, and always keeps the dot.
 */
export const header = (d: Draw, vm: ViewModel['header'], width: number): RenderElement => {
  const { els, C } = d
  const { Box, Text } = els
  // Flush to both edges with one space between, so 32 columns still fit `● OPUS 5.5`.
  const fit = headerFit(vm.model, vm.arch, width - BRAND_CELLS - 1)
  const name = vm.model.trim().toUpperCase()
  const dot = stateDot(d, vm.isActive)
  // The words are one Text of coloured runs, so the row reads as one string.
  const words: RenderElement[] = []
  if (name && fit !== 'dot') {
    words.push(
      <Text key="model" bold color={familyColor(name)}>
        {` ${name}`}
      </Text>,
    )
  }
  if (fit === 'arch' && vm.arch) {
    words.push(
      <Text key="sep" color={C.dim}>
        {' · '}
      </Text>,
      <Text key="arch" color={vm.isAdvising ? C.architect : C.dim}>
        {vm.arch}
      </Text>,
    )
  }
  return (
    <Box width={width} justifyContent="space-between">
      <Text wrap="truncate">
        <Text color={C.brand}>▌</Text>
        <Text bold color={C.brand}>
          SERGIO'S TECH
        </Text>
        <Text color={C.dim}> · </Text>
        <Text bold color={C.orange}>
          CODE
        </Text>
      </Text>
      <Box flexShrink={0}>
        {dot}
        {words.length > 0 ? <Text>{words}</Text> : null}
      </Box>
    </Box>
  )
}
