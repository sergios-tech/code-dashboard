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

/** One panel's drawing; each panel's renderer joins here as it is added. */
const panel = (d: Draw, vm: ViewModel, p: Panel): RenderElement | null => (p === 'log' ? logPanel(d, vm.log, vm.width) : null)

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
    const d: Draw = { els, C: COLORS, hasClient: 'Client' in els, motion: cfg.motion, surface: e.surface, now }
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
