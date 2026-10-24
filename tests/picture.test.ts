import { expect, test } from 'claude-code/testing'

import { layoutCells, standIn } from '../hooks/view/cells'
import type { Draw } from '../hooks/view/draw'
import { frame } from '../hooks/view/frame'
import { header } from '../hooks/view/header'
import { clampWidth } from '../hooks/view/layout'
import { agentsPanel } from '../hooks/view/panels/agents'
import { CELL_PX, SVG_MAX, pictures, rowsSvg } from '../hooks/view/picture'
import { NOW, busy } from './fixture'
import { ELS, draw, engine, found, pane, spawn, vmOf } from './kit'

const line = (text: string) => ELS.Text({ children: [text] })

test('off the terminal each block is one sized picture of its cells, under the SVG cap', async ($, on) => {
  engine(on)
  for (const surface of ['desktop', 'vscode'] as const) for (const cols of [53, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.length >= 3).toBe(true) // header, INFO, LOG
    for (const s of svgs) {
      expect(s.props.width).toBe(Math.ceil(clampWidth(cols) * CELL_PX)); expect(typeof s.props.height).toBe('number')
      expect(String(s.props.source).length <= SVG_MAX).toBe(true)
    }
    expect(await ui.find({ type: 'Text', text: /SERGIO'S TECH/ })).toBeUndefined()
    await ui.unmount()
  }
})
test('a picture sets words at their cells and draws frame glyphs as strokes', () => {
  const svg = rowsSvg(layoutCells(frame(draw(), { key: 'f', label: 'info', width: 20, children: [line('a <b>')] }), 20, standIn), 20)
  expect(svg).toContain('<path d='); expect(svg).not.toContain('┌'); expect(svg).toContain('&lt;b&gt;')
  expect(svg).toContain('textLength="31.2"') // INFO: 4 cells
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="156" height="51"')).toBe(true)
})
test('the sweep and the pulse animate in SMIL, and nothing animates with motion off', () => {
  const vm = vmOf(busy(), 66, 'dock', NOW)
  const pic = (o: Partial<Draw>) => {
    const d = draw({ now: NOW, isPicture: true, hasClient: false, ...o })
    return pictures(d, [header(d, vm.header, 66), agentsPanel(d, vm.agents!, 66, () => () => undefined)], 66).flatMap(e => found(e, 'Svg')).map(s => String(s.source)).join('')
  }
  const animated = pic({})
  expect(animated).toContain('attributeName="x"'); expect(animated).toContain('values="#5fd75f;#5f875f"')
  expect(pic({ motion: false }).includes('<animate')).toBe(false)
})
test('the hotkeys stay on hidden Buttons beside the pictures, and the agents axis follows the AGENTS picture', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `v${++n}` }))
  await clock.advance(1000)
  await $.agent.spawn(spawn('Explore', 'Map the call sites')); await $.agent.spawn(spawn('Explore', 'Count the tests'))
  const ui = await $.ui.mount({ ...pane(66), surface: 'vscode' })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)).toEqual(['1', '2'])
  const svgs = await ui.findAll({ type: 'Svg' })
  const axis = svgs.findIndex(s => /on one time axis$/.test(String(s.props.alt)))
  const agentsPic = async () => String((await ui.findAll({ type: 'Svg' }))[axis - 1]?.props.source)
  expect(axis > 0).toBe(true); expect(await agentsPic()).toContain('>AGENTS<'); expect(await agentsPic()).not.toContain('>steps<')
  await ui.press({ key: 'key-v1' })
  expect(await agentsPic()).toContain('>steps<') // the opened agent's facts row
  await ui.unmount()
})
