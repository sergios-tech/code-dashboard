// The pane's drawing: one state snapshot, one view model, then the header and the panels in one
// column, in two with the log under both, or the inline summary instead of all of them. Off the
// terminal each of those blocks is drawn as a picture of its cells.
import type { On, RenderElement } from 'claude-code'

import type { Config, Panel } from '../config'
import { PANE_ID } from '../state/atoms'
import { loadSnapshot, toggleExpanded } from '../state/store'
import type { Draw } from '../view/draw'
import { header } from '../view/header'
import { miniPane } from '../view/mini'
import { buildViewModel } from '../view/model'
import type { ViewModel } from '../view/model'
import { COLORS } from '../view/palette'
import { agentsPanel } from '../view/panels/agents'
import type { Expand } from '../view/panels/agents'
import { architectPanel } from '../view/panels/architect'
import { infoPanel } from '../view/panels/info'
import { logPanel } from '../view/panels/log'
import { toolsPanel } from '../view/panels/tools'
import { trendsPanel } from '../view/panels/trends'
import { pictures } from '../view/picture'

/** One panel's drawing, in the cells the view model gave it: its column's in the wide layout. */
const panel = (d: Draw, vm: ViewModel, p: Panel, expand: Expand): RenderElement | null => {
  const w = vm.widths[p]
  if (p === 'info') return infoPanel(d, vm.info, w)
  if (p === 'agents') return vm.agents ? agentsPanel(d, vm.agents, w, expand) : null
  if (p === 'architect') return vm.architect ? architectPanel(d, vm.architect, w) : null
  if (p === 'tools') return vm.tools ? toolsPanel(d, vm.tools, w) : null
  if (p === 'trends') return vm.trends ? trendsPanel(d, vm.trends, w) : null
  return p === 'log' && vm.log ? logPanel(d, vm.log, w) : null
}

/** The panels under the header: one column in config order, or two side by side with the log full width beneath. */
const body = (d: Draw, vm: ViewModel, expand: Expand): (RenderElement | null)[] => {
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

export const wireRender = (on: On, cfg: Config): void => {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const [s, now] = await Promise.all([loadSnapshot($), $.clock.now()])
    const vm = buildViewModel(s, {
      cfg,
      now,
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      viewedAgentId: e.props.view?.agentId ?? null,
      bodyRows: e.props.scroll?.bodyRows ?? e.viewport?.rows,
    })
    // VS Code's webview takes no client modules, whatever its element table holds.
    const hasClient = 'Client' in els && e.surface !== 'vscode'
    const d: Draw = { els, C: COLORS, hasClient, motion: cfg.motion, surface: e.surface, isPicture: e.surface !== 'terminal', now }
    // An agent's hotkey opens its details inside the AGENTS frame, or closes them.
    const expand: Expand = id => () => toggleExpanded($, id)
    const { Box } = els
    // The OLED black is filled in rather than left to the host's pane colour. Docked, it fills every
    // body row, not only the rows the panels take: the dark-ansi theme paints the dock bright black.
    if (!d.isPicture) {
      const fillRows = e.props.placement === 'dock' ? e.props.scroll?.bodyRows : undefined
      if (vm.mini) return miniPane(d, vm.mini, vm.width, fillRows)
      return (
        <Box flexDirection="column" width={vm.width} minHeight={fillRows} backgroundColor={COLORS.fill}>
          {header(d, vm.header, vm.width)}
          {body(d, vm, expand)}
        </Box>
      )
    }
    // Off the terminal each block is one picture of its cells, beside the hidden hotkey Buttons.
    const blocks = vm.mini ? [miniPane(d, vm.mini, vm.width)] : [header(d, vm.header, vm.width), ...body(d, vm, expand)]
    return (
      <Box flexDirection="column" width={vm.width} backgroundColor={COLORS.fill}>
        {pictures(d, blocks.filter((b): b is RenderElement => b !== null), vm.width)}
      </Box>
    )
  })
}
