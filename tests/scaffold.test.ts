import { expect, mock, test } from 'claude-code/testing'

test('the pane opens with the brand header', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'st-code-display', component: 'Pane', requestId: 'st-code-display', surface: 'terminal',
    props: { title: "Sergio's Tech · Code Display", isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect(await ui.find({ text: /SERGIO'S TECH · CODE DISPLAY/ })).toBeDefined()
  await ui.unmount()
})
