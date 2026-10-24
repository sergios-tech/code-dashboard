// The `/st-code` command: open, close, reset, or choose the layout.
import type { EngineInterface, On } from 'claude-code'

import type { Layout } from '../../types'
import { PANE_ID, PLUGIN } from '../state/atoms'
import { resetAll, setLayout } from '../state/store'

const TITLE = "Sergio's Tech · Code"
const USAGE = 'Usage: /st-code [open|close|reset|layout auto|compact|wide|mini]'
const LAYOUTS: readonly Layout[] = ['auto', 'compact', 'wide', 'mini']

/** Opens the pane: columns apply when docked beside the transcript, rows when seated inline above the prompt. */
export function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE_ID, title: TITLE, columns: 66, rows: 8 })
}

/** Declares `/st-code` for the session; session.ts calls it, as a plugin may hook `session.start` only once. */
export function registerCommand($: EngineInterface) {
  return $.command.register({
    name: PLUGIN,
    description: "Sergio's Tech Code dashboard: open, close, reset, or set the layout",
    argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
  })
}

export const wireCommand = (on: On): void => {
  on('command.run', { command: PLUGIN }, async ($, e) => {
    const [first = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const verb = first === '' ? 'open' : first

    if (verb === 'close') {
      await $.ui.close({ id: PANE_ID })
      return { text: 'Dashboard closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      return { text: 'Dashboard reset.' }
    }
    if (verb === 'layout') {
      const layout = LAYOUTS.find(l => l === arg)
      if (!layout) return { text: USAGE }
      await setLayout($, layout)
      const opened = await openPane($)
      return { text: opened.isPlaced ? `Dashboard layout: ${layout}.` : `Layout set to ${layout}; the dashboard is not shown yet: ${opened.reason}` }
    }
    if (verb === 'open') {
      const opened = await openPane($)
      if (!opened.isPlaced) return { text: `The dashboard is not shown yet: ${opened.reason}` }
      return { text: 'Dashboard opened. Focus it with ctrl+x tab; 1-6 expand agents.' }
    }
    return { text: USAGE }
  })
}
