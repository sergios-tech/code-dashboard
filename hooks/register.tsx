import type { Register } from 'claude-code'

const PANE_ID = 'st-code'
const PLUGIN = 'st-code'
const TITLE = "Sergio's Tech · Code"

export const register: Register = on => {
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

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text bold>SERGIO'S TECH · CODE</Text>
  })
}
