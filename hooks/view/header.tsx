// The header row on the black fill: the brand on the left, the main model's state on the right.
import type { RenderElement } from 'claude-code'

import { canAnimate } from './draw'
import type { Draw } from './draw'
import { headerFit } from './layout'
import type { ViewModel } from './model'
import { familyColor } from './palette'

const BRAND_CELLS = Array.from("▌SERGIO'S TECH · CODE").length

/**
 * One unfilled row of `width` cells. Its dot marks any running work (a turn or a subagent) and
 * pulses while there is some; its words describe the main loop alone, so background agents after a
 * turn read `● OPUS 5.5 IDLE`. The right side drops the architect suffix, then the state word, then
 * the model to fit, and always keeps the dot.
 */
export const header = (d: Draw, vm: ViewModel['header'], width: number): RenderElement => {
  const { els, C } = d
  const { Box, Text } = els
  // Flush to both edges with one space between, so 40 columns still fit `● OPUS 5.5 WORKING`.
  const fit = headerFit(vm.model, vm.isRunning, vm.arch, width - BRAND_CELLS - 1)
  const name = vm.model.trim().toUpperCase()
  const Client = 'Client' in els ? els.Client : null
  const dot =
    canAnimate(d) && Client && vm.isActive ? (
      <Client key="st-code-pulse" module="../client/pulse.tsx" width={1} height={1} props={{ active: true, color: C.green, dim: C.pulse }} />
    ) : (
      <Text key="st-code-dot" bold={vm.isActive} color={vm.isActive ? C.green : C.dim}>
        {vm.isActive ? '●' : '○'}
      </Text>
    )
  const showState = fit === 'state' || fit === 'arch'
  // The words are one Text of coloured runs, so the row reads as one string.
  const words: RenderElement[] = []
  if (name && fit !== 'dot') {
    words.push(
      <Text key="model" bold color={familyColor(name)}>
        {` ${name}`}
      </Text>,
    )
  }
  if (showState) {
    words.push(
      <Text key="state" color={C.dim}>
        {vm.isRunning ? ' WORKING' : ' IDLE'}
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
