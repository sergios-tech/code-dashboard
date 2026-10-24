// The crimson header bar: the brand on the left, the main model's state on the right.
import type { RenderElement } from 'claude-code'

import type { Draw } from './draw'
import { headerRight } from './layout'
import type { ViewModel } from './model'

const BRAND = "▌SERGIO'S TECH · CODE"
const BRAND_CELLS = Array.from(BRAND).length

/**
 * One full-width row filled with `brand`. Its dot marks any running work (a turn or a subagent)
 * and pulses while there is some; its words describe the main loop alone, so background agents
 * after a turn read `● OPUS 5.5 IDLE`.
 */
export const header = (d: Draw, vm: ViewModel['header'], width: number, motion: boolean): RenderElement => {
  const { els, C } = d
  const { Box, Text } = els
  // Flush to both edges with one space between, so 40 columns still fit `● OPUS 5.5 WORKING`.
  const right = headerRight(vm.model, vm.isRunning, vm.arch, width - BRAND_CELLS - 1)
  const words = right.slice(1)
  const dot =
    d.hasClient && motion && vm.isActive && 'Client' in els ? (
      <els.Client key="st-code-pulse" module="../client/pulse.tsx" width={1} height={1} props={{ active: true, color: C.text, dim: C.text }} />
    ) : (
      <Text bold color={C.text} backgroundColor={C.frame}>
        {vm.isActive ? '●' : '○'}
      </Text>
    )
  return (
    <Box width={width} backgroundColor={C.frame} justifyContent="space-between">
      <Text bold color={C.text} backgroundColor={C.frame} wrap="truncate">
        {BRAND}
      </Text>
      <Box>
        {dot}
        <Text bold color={C.text} backgroundColor={C.frame}>
          {words}
        </Text>
      </Box>
    </Box>
  )
}
