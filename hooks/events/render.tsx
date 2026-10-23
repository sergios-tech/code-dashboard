// The pane's drawing: one state snapshot, one view model, then the header and each panel in turn.
import type { On, RenderElement } from 'claude-code'

import type { Config, Panel } from '../config'
import { PANE_ID } from '../state/atoms'
import { loadSnapshot } from '../state/store'
import type { Draw } from '../view/draw'
import { header } from '../view/header'
import { buildViewModel } from '../view/model'
import type { ViewModel } from '../view/model'
import { COLORS } from '../view/palette'
import { logPanel } from '../view/panels/log'
import { turnPanel } from '../view/panels/turn'
import { vitalsPanel } from '../view/panels/vitals'

/** One panel's drawing; each panel's renderer joins here as it is added. */
const panel = (d: Draw, vm: ViewModel, p: Panel): RenderElement | null => {
  if (p === 'vitals') return vitalsPanel(d, vm.vitals, vm.width)
  if (p === 'turn') return vm.turn ? turnPanel(d, vm.turn, vm.width) : null
  return p === 'log' ? logPanel(d, vm.log, vm.width) : null
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
    const d: Draw = { els, C: COLORS, hasClient, motion: cfg.motion, surface: e.surface, now }
    const { Box } = els
    // The OLED black is filled in rather than left to the host's pane colour.
    return (
      <Box flexDirection="column" width={vm.width} backgroundColor={COLORS.bg}>
        {header(d, vm.header, vm.width, d.motion)}
        {vm.panels.map(p => panel(d, vm, p))}
      </Box>
    )
  })
}
