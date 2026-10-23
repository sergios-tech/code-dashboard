import { expect, mock, test } from 'claude-code/testing'

test('the pane opens with the brand header', async ($, on) => {
  mock.clock(on); on('ui.status', () => ({ value: undefined }))
  const ui = await $.ui.mount({ plugin: 'st-code', component: 'Pane', requestId: 'st-code', surface: 'terminal',
    props: { title: "Sergio's Tech · Code", isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect(await ui.find({ text: /SERGIO'S TECH · CODE/ })).toBeDefined()
  await ui.unmount()
})
