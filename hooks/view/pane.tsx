// The panels under the pane's header, in one column or in two with the log under both, each drawn
// in the cells the view model gave it. Pure.
import type { RenderElement } from 'claude-code'

import type { Panel } from '../config'
import type { Draw } from './draw'
import type { ViewModel } from './model'
import { agentsPanel } from './panels/agents'
import type { Expand } from './panels/agents'
import { architectPanel } from './panels/architect'
import { infoPanel } from './panels/info'
import { logPanel } from './panels/log'
import { toolsPanel } from './panels/tools'

/** One panel's drawing, in the cells the view model gave it: its column's while the wide layout splits. */
const panel = (d: Draw, vm: ViewModel, p: Panel, expand: Expand): RenderElement | null => {
  const w = vm.widths[p]
  if (p === 'info') return infoPanel(d, vm.info, w)
  if (p === 'agents') return vm.agents ? agentsPanel(d, vm.agents, w, expand) : null
  if (p === 'architect') return vm.architect ? architectPanel(d, vm.architect, w) : null
  if (p === 'tools') return vm.tools ? toolsPanel(d, vm.tools, w) : null
  return p === 'log' && vm.log ? logPanel(d, vm.log, w) : null
}

/** The panels under the header: one column in config order, or two side by side with the log full width beneath. */
export const body = (d: Draw, vm: ViewModel, expand: Expand): (RenderElement | null)[] => {
  const { Box } = d.els
  const draw = (p: Panel) => panel(d, vm, p, expand)
  const c = vm.columns
  if (!c) return vm.panels.map(draw)
  return [
    <Box key="wide" columnGap={c.gap} width={vm.width}>
      <Box key="wide-left" flexDirection="column" width={c.leftWidth} flexShrink={0}>
        {c.left.map(draw)}
      </Box>
      <Box key="wide-right" flexDirection="column" width={c.rightWidth} flexShrink={0}>
        {c.right.map(draw)}
      </Box>
    </Box>,
    vm.panels.includes('log') ? draw('log') : null,
  ]
}
