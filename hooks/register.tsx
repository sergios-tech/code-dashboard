import type { Register } from 'claude-code'

import { parseConfig } from './config'
import { wireRender } from './events/render'
import { PANE_ID, PLUGIN } from './state/atoms'

const TITLE = "Sergio's Tech · Code"

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PLUGIN,
      description: "Sergio's Tech Code dashboard: open, close, reset, or set the layout",
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    return next(e)
  })

  on('command.run', { command: PLUGIN }, async $ => {
    // columns apply when docked beside the transcript, rows when seated inline above the prompt.
    const opened = await $.ui.open({ id: PANE_ID, title: TITLE, columns: 66, rows: 8 })
    return { text: opened.isPlaced ? "Sergio's Tech Code opened." : `Not shown yet: ${opened.reason}` }
  })

  wireRender(on, cfg)
}
