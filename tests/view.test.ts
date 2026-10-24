import { expect, test } from 'claude-code/testing'

import Pulse from '../hooks/client/pulse'
import { DEFAULT_ARCHITECT, DEFAULT_MAIN, normalizeCard } from '../hooks/state/schema'
import { dividerRow, frame } from '../hooks/view/frame'
import { header } from '../hooks/view/header'
import { WIDE_LEFT, WIDE_RIGHT, clampWidth, headerRight, pickLayout, wideColumns } from '../hooks/view/layout'
import type { ViewModel } from '../hooks/view/model'
import { COLORS, TEXT_TOKENS, contrast, familyColor, levelColor, to256 } from '../hooks/view/palette'
import { ELS, cellWidth, draw, drawRows, engine, found, pane, rowsOf, texts, vmOf } from './kit'

const line = (text: string) => ELS.Text({ children: [text] })

const IDLE: ViewModel['header'] = { model: 'Opus 5.5', isRunning: false, isActive: false, arch: null }
const WORKING: ViewModel['header'] = { model: 'Opus 5.5', isRunning: true, isActive: true, arch: null }

// ---------------------------------------------------------------- palette and layout math

test('the palette holds the Signal tokens and their 256-colour fallbacks', () => {
  expect(COLORS).toEqual({ fill: '#000000', text: '#d0d0d0', dim: '#9e9e9e', muted: '#4e4e4e', faint: '#303030', frame: '#d70000', brand: '#ff0000', orange: '#ff7f00', green: '#5fd75f', pulse: '#5f875f', gold: '#ffd700', architect: '#d7af00', error: '#ff5f5f' })
  const fallback = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, to256(v)]))
  expect(fallback).toEqual({ fill: '#000000', text: '#c6c6c6', dim: '#9e9e9e', muted: '#4e4e4e', faint: '#303030', frame: '#d70000', brand: '#ff0000', orange: '#ff8700', green: '#87d787', pulse: '#87af87', gold: '#ffd700', architect: '#d7af00', error: '#ff8787' })
})
test('every text token reads at 4.5:1 on black in both colour depths; muted, faint and frame never carry text', () => {
  for (const k of TEXT_TOKENS) {
    expect(contrast(COLORS[k], '#000000') >= 4.5).toBe(true)
    expect(contrast(to256(COLORS[k]), '#000000') >= 4.5).toBe(true)
  }
  for (const k of ['muted', 'faint', 'frame', 'fill'] as const) expect(TEXT_TOKENS.includes(k)).toBe(false)
})
test('no token is blue', () => {
  for (const hex of Object.values(COLORS)) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
    expect(b > r && b > g).toBe(false)
  }
})
test('levels go green, gold from 80, coral from 90, by the rounded figure (Review Focus 3)', () => {
  const { green, gold, error } = COLORS
  expect([Number.NaN, -5, 0, 79.4, 79.5, 80, 89.4, 89.5, 90, 100, 104].map(levelColor)).toEqual([green, green, green, green, gold, gold, gold, error, error, error, error])
})
test('model families: Opus brand, Sonnet orange, Haiku green, Fable gold, any other dim', () => {
  expect(['claude-opus-5-5', 'Sonnet 5.5', 'claude-haiku-4-5', 'Fable 5.1', 'gpt-x', ''].map(familyColor)).toEqual([COLORS.brand, COLORS.orange, COLORS.green, COLORS.gold, COLORS.dim, COLORS.dim])
})
test('contrast runs from 1 (none) to 21 (white on black)', () => {
  expect(Math.round(contrast('#ffffff', '#000000') * 100) / 100).toBe(21); expect(contrast('#000', '#000000')).toBe(1)
})
test('layout picks mini inline, wide from 110 docked, compact otherwise; overrides win', () => {
  expect(pickLayout('auto', null, 'inline', 120)).toBe('mini'); expect(pickLayout('auto', null, 'dock', 110)).toBe('wide')
  expect(pickLayout('auto', null, 'dock', 109)).toBe('compact'); expect(pickLayout('auto', 'compact', 'dock', 200)).toBe('compact')
  expect(clampWidth(28)).toBe(40); expect(clampWidth(220)).toBe(220)
})
test('the wide layout puts info, trends and tools left, agents and architect right', () => {
  expect(WIDE_LEFT).toEqual(['info', 'trends', 'tools']); expect(WIDE_RIGHT).toEqual(['agents', 'loops', 'architect'])
})
test('forced layouts: mini anywhere, wide only with room for two 40-column columns', () => {
  expect(pickLayout('mini', null, 'dock', 120)).toBe('mini'); expect(pickLayout('compact', 'auto', 'dock', 120)).toBe('wide')
  expect(pickLayout('wide', null, 'dock', 82)).toBe('wide'); expect(pickLayout('auto', 'wide', 'dock', 64)).toBe('compact')
  expect(clampWidth(Number.NaN)).toBe(40)
  expect(wideColumns(120)).toEqual({ left: 59, right: 59, gap: 2 }); expect(wideColumns(111)).toEqual({ left: 54, right: 55, gap: 2 })
  expect([...WIDE_LEFT, ...WIDE_RIGHT].sort()).toEqual(['agents', 'architect', 'info', 'loops', 'tools', 'trends'])
})
test('the header keeps the brand and drops status words to fit', () => {
  expect(headerRight('Opus 5.5', true, 'ARCHITECT ADVISING', 60)).toBe('● OPUS 5.5 WORKING · ARCHITECT ADVISING')
  expect(headerRight('Opus 5.5', true, 'ARCHITECT ADVISING', 18)).toBe('● OPUS 5.5 WORKING')
  expect(headerRight('Opus 5.5', false, null, 11)).toBe('○ OPUS 5.5')
  expect(headerRight('Opus 5.5', false, null, 15)).toBe('○ OPUS 5.5 IDLE'); expect(headerRight('Opus 5.5', true, null, 3)).toBe('●')
  expect(headerRight('', false, null, 40)).toBe('○ IDLE')
})

// ---------------------------------------------------------------- view model

test('the view model hides panels with nothing to show and reads the header from state', () => {
  const fresh = vmOf({})
  // A fresh session shows INFO and the log, which draws as `nothing yet` when empty.
  expect([fresh.width, fresh.layout, fresh.panels, fresh.viewedAgentId]).toEqual([64, 'compact', ['info', 'log'], null])
  expect(fresh.header).toEqual({ model: '', isRunning: false, isActive: false, arch: null })
  expect(vmOf({}, 28).width).toBe(40); expect(vmOf({}, 120).layout).toBe('wide'); expect(vmOf({}, 120, 'inline').layout).toBe('mini')
  expect(vmOf({ view: { expanded: null, layout: 'compact' } }, 120).layout).toBe('compact')
  const busy = vmOf({ main: { ...DEFAULT_MAIN, model: 'claude-opus-5-5' }, agents: [normalizeCard({ id: 'a', status: 'running' })] })
  expect(busy.header).toEqual({ model: 'Opus 5.5', isRunning: false, isActive: true, arch: null })
  const consult = { id: 'c1', at: 1, endAt: null, moment: 'before a plan' as const, via: 'advisor' }
  expect(vmOf({ architect: { ...DEFAULT_ARCHITECT, consults: [consult] } }).header.arch).toBe('ARCHITECT ADVISING')
  expect(vmOf({ architect: { ...DEFAULT_ARCHITECT, consults: [{ ...consult, endAt: 5 }] } }).header.arch).toBe('ARCHITECT ON CALL')
})

// ---------------------------------------------------------------- frame, header and pulse

test('a frame sets its caps label into the top border, the meta at the right', () => {
  const rows = drawRows(frame(draw(), { key: 'f', label: 'info', meta: '○ idle', width: 30, children: [line('hello')] }))
  expect(rows).toEqual([`┌ INFO ${'─'.repeat(14)} ○ idle ┐`, `│ hello${' '.repeat(22)}│`, `└${'─'.repeat(28)}┘`])
  const quiet = drawRows(frame(draw(), { key: 'f', label: 'a very long section label', meta: 'meta', width: 20, children: [] }))
  expect(quiet[0]).toBe('┌ A VERY LONG SE… ─┐')
  const tree = frame(draw(), { key: 'f', label: 'info', width: 40, isActive: true, children: [] })
  expect(found(tree, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.green])
  expect(found(frame(draw(), { key: 'f', label: 'info', width: 40, children: [] }), 'Box').some(b => b.borderColor === COLORS.frame)).toBe(true)
  expect(found(tree, 'Text').find(t => t.bold)?.color).toBe(COLORS.text)
})
test('dividers join the side borders in the frame colour, green while the frame holds running work', () => {
  const kids = [line('a'), dividerRow(draw(), 'd'), line('b')]
  expect(drawRows(frame(draw(), { key: 'f', label: 'info', width: 20, dividers: [1], children: kids }))).toEqual([
    `┌ INFO ${'─'.repeat(12)}┐`, `│ a${' '.repeat(16)}│`, `├${'─'.repeat(18)}┤`, `│ b${' '.repeat(16)}│`, `└${'─'.repeat(18)}┘`,
  ])
  const live = frame(draw(), { key: 'f', label: 'info', width: 20, isActive: true, dividers: [1], children: kids })
  expect(found(live, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.green])
  expect(texts(live).find(t => t.text.startsWith('├'))?.color).toBe(COLORS.green)
  const idle = frame(draw(), { key: 'f', label: 'info', width: 20, dividers: [1], children: kids })
  expect(found(idle, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.frame])
  expect(texts(idle).find(t => t.text.startsWith('├'))?.color).toBe(COLORS.frame)
})
test('the header dot pulses as a Client only while work runs and motion is on', () => {
  const pulse = found(header(draw(), WORKING, 64, true), 'Client')
  // The engine rewrites the module literal to the plugin-relative path as the file loads.
  expect(pulse.map(c => c.module)).toEqual(['hooks/client/pulse.tsx'])
  expect(found(header(draw(), WORKING, 64, false), 'Client')).toEqual([])
  expect(found(header(draw({ hasClient: false }), WORKING, 64, true), 'Client')).toEqual([])
  expect(found(header(draw(), IDLE, 64, true), 'Client')).toEqual([])
  const still = drawRows(header(draw(), WORKING, 64, false))
  expect(still).toEqual([`▌SERGIO'S TECH · CODE${' '.repeat(25)}● OPUS 5.5 WORKING`])
  expect(drawRows(header(draw(), IDLE, 40, true))[0]?.endsWith('○ OPUS 5.5 IDLE')).toBe(true)
})
test('the pulse alternates bright and dim every 600 ms while active, and holds still at rest', () => {
  const timers: { ms: number; fn: () => void }[] = []
  const surface = {
    elements: ELS,
    state: undefined as unknown,
    setState(next: unknown) {
      surface.state = next
    },
    every(ms: number, fn: () => void) {
      timers.push({ ms, fn })
      return () => undefined
    },
    columns: 1,
    rows: 1,
  }
  const props = { active: true, color: COLORS.text, dim: COLORS.text }
  const colorOf = (p: typeof props) => (Pulse(p, surface as never) as unknown as { props: { color: string } }).props.color
  expect(colorOf(props)).toBe(COLORS.text)
  expect(timers.map(t => t.ms)).toEqual([600])
  timers[0]?.fn()
  expect(colorOf(props)).toBe(COLORS.text)
  timers[0]?.fn()
  expect(colorOf(props)).toBe(COLORS.text)
  expect(colorOf({ ...props, active: false })).toBe(COLORS.text)
  timers[0]?.fn()
  expect(colorOf({ ...props, active: false })).toBe(COLORS.text)
  expect(timers).toHaveLength(1)
})

// ---------------------------------------------------------------- the mounted pane

test('the header bar is crimson-filled with white brand text', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // A Box's shown text includes its children's, so the query names the Text itself.
  const brand = await ui.find({ type: 'Text', text: /SERGIO'S TECH · CODE/ })
  expect(brand?.props.color).toBe(COLORS.text)
  const bars = await ui.findAll({ type: 'Box', text: /^▌SERGIO'S TECH · CODE/ })
  expect(bars.some(b => b.props.backgroundColor === COLORS.frame)).toBe(true)
  await ui.unmount()
})
test('a fresh pane draws its header within the pane on every surface and width', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [28, 40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      const rows = await rowsOf(ui)
      expect(rows.length > 0).toBe(true)
      for (const r of rows) expect(cellWidth(r) <= clampWidth(cols)).toBe(true)
      expect(rows[0]?.startsWith("▌SERGIO'S TECH · CODE")).toBe(true); expect(rows[0]?.endsWith('○ IDLE')).toBe(true)
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      await ui.unmount()
    }
  }
})
test('the text drawing truncates, wraps and pads as the terminal does', () => {
  const box = (wrap: string | undefined) =>
    ELS.Box({ width: 10, borderStyle: 'single', paddingX: 1, flexDirection: 'column', children: [ELS.Text({ wrap, children: ['abcdefghijkl'] })] })
  expect(drawRows(box('truncate'))).toEqual(['┌────────┐', '│ abcde… │', '└────────┘'])
  expect(drawRows(box(undefined))).toEqual(['┌────────┐', '│ abcdef │', '│ ghijkl │', '└────────┘'])
  expect(cellWidth('ab🚀')).toBe(4); expect(cellWidth('é')).toBe(1)
})
