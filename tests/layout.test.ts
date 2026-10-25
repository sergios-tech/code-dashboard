import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseConfig } from '../hooks/config'
import { recordCall } from '../hooks/domain/activity'
import { LOOP_ACTIVE_MS } from '../hooks/domain/agents'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_SESSION,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  normalizeCard,
} from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/schema'
import { clampWidth, wideColumns } from '../hooks/view/layout'
import { buildViewModel } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'
import { busy } from './fixture'
import { cellWidth, engine, pane, rowsOf, spawn } from './kit'

/** The model beneath the plugin: every request ends at once, for any loop. */
const model = (on: On) => {
  on('turn.step', async function* (_$, e) {
    const usage = { input_tokens: 1000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, output_tokens: 3000, model: e.model }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
}

/** The header dot's colour: the pulse's while work runs, else the plain dot's, `○` at rest. */
const headerDot = async (ui: { find: (q: { type: string; text?: RegExp }) => Promise<{ props: Record<string, unknown> } | undefined> }) => {
  const pulse = await ui.find({ type: 'Client' })
  return pulse ? (pulse.props.props as { color: string }).color : (await ui.find({ type: 'Text', text: /^[●○]$/ }))?.props.color
}

/** One model request in a loop: a subagent's or another loop's with an id, the main loop's without. */
const step = async ($: Engine, agentId?: string, name = 'claude-sonnet-5-5') => {
  const s = $.turn.step({ turnId: `S-${agentId ?? 'main'}`, index: 0, model: name, messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) void _
  await s.result
}

/** A reading as the host sends it, context and cost both changed. */
const reading = (percent: number, usd: number) => ({
  context: { window: 200_000, tokens: percent * 2000, percent },
  cost: { usd },
  rateLimits: [],
  changed: ['context' as const, 'cost' as const],
})

const ok = { result: {}, text: 'ok' }

/** The direct children of a drawn tree's root. */
const childrenOf = (tree: unknown): unknown[] => ((tree as { children?: unknown[] }).children ?? []).filter(c => c !== null && c !== undefined)

const FRESH: Snapshot = {
  main: DEFAULT_MAIN,
  usage: DEFAULT_USAGE,
  turn: DEFAULT_TURN,
  agents: [],
  loops: [],
  architect: DEFAULT_ARCHITECT,
  activity: DEFAULT_ACTIVITY,
  log: [],
  view: DEFAULT_VIEW,
  roster: DEFAULT_ROSTER,
  session: DEFAULT_SESSION,
}

test('a fresh session draws on every surface and width, empty panels hidden but AGENTS when wide', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    // The wide layout holds an empty AGENTS beside INFO; one column hides it until the first agent.
    const isWide = cols >= 110
    if (surface === 'terminal') {
      expect(await ui.find({ text: /SERGIO'S TECH · CODE/ })).toBeDefined(); expect(await ui.find({ text: /INFO/ })).toBeDefined()
      expect(await ui.find({ text: /TOOLS & FILES|ARCHITECT/ })).toBeUndefined(); expect((await ui.find({ text: /^no agents yet$/ })) !== undefined).toBe(isWide)
      expect(await ui.find({ type: 'Text', text: /^ LOG $/ })).toBeDefined(); expect(await ui.find({ text: /TURN|loops/ })).toBeUndefined()
    } else {
      // Off the terminal the words are in the pictures, one `<text>` each, and no agent means no time axis.
      const svgs = await ui.findAll({ type: 'Svg' })
      const all = svgs.map(s => String(s.props.source)).join('')
      for (const word of ["SERGIO'S", 'INFO', 'LOG']) expect(all).toContain(`>${word}<`)
      expect(/>(TOOLS|ARCHITECT|TURN|loops)</.test(all)).toBe(false); expect(all.includes('>AGENTS<')).toBe(isWide)
      expect(svgs.some(s => /on one time axis$/.test(String(s.props.alt)))).toBe(false)
    }
    await ui.unmount()
  }
})
test('one column shows AGENTS once a loop no card claims has stepped, as two columns do', async ($, on) => {
  const clock = engine(on)
  model(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  await clock.advance(1000)
  // A workflow script's agents are loops, not cards.
  await $.agent.spawn({ ...spawn('general-purpose', 'wf one'), workflow: { runId: 'wf_1', agentIndex: 1 } })
  await $.agent.spawn({ ...spawn('general-purpose', 'wf two'), workflow: { runId: 'wf_1', agentIndex: 2 } })
  await step($, 'm1')
  await step($, 'm2')
  for (const cols of [64, 103, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    expect(rows.some(r => /AGENTS ─+ 0 running · 0 total ┐/.test(r))).toBe(true)
    expect(rows.some(r => r.includes('loops  2 seen · 2 active  ●●'))).toBe(true)
    await ui.unmount()
  }
  const C = COLORS
  /** Each frame's border colour, top to bottom, the header dot's colour and AGENTS' empty row. */
  const look = async () => {
    const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
    const borders = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'single').map(b => b.props.borderColor)
    const dot = await headerDot(ui)
    const empty = (await rowsOf(ui)).find(r => /only loops running|no agents yet/.test(r))?.replace(/[│ ]+/g, ' ').trim()
    await ui.unmount()
    return { borders, dot, empty }
  }
  // An active loop is activity, as a running agent is: AGENTS is green, the rest the frame red, the header dot green.
  expect(await look()).toEqual({ borders: [C.frame, C.green, C.frame], dot: C.green, empty: 'only loops running' })
  // Once the loops end, nothing runs.
  for (const id of ['m1', 'm2']) await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `T-${id}`, agentId: id, reason: 'answer' })
  expect(await look()).toEqual({ borders: [C.idle, C.idle, C.idle], dot: C.idle, empty: 'no agents yet' })
})
test('a loop that falls quiet without ending draws as idle once it no longer counts as active', async ($, on) => {
  const clock = engine(on)
  model(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'q1' }))
  await clock.advance(1000)
  await $.agent.spawn({ ...spawn('general-purpose', 'wf quiet'), workflow: { runId: 'wf_q', agentIndex: 1 } })
  await step($, 'q1')
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const borders = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'single').map(b => b.props.borderColor)
  expect(await borders()).toEqual([COLORS.frame, COLORS.green, COLORS.frame])
  // No event arrives: the pane redraws by itself when the loop stops counting as active.
  await clock.advance(LOOP_ACTIVE_MS)
  expect(await borders()).toEqual([COLORS.idle, COLORS.idle, COLORS.idle])
  await ui.unmount()
})
test('a busy session draws inside every width from 28 to 220, frames whole, docked and inline (Review Focus 1)', { timeoutMs: 30_000 }, async ($, on) => {
  engine(on)
  const s = busy()
  // The test's `$` has no `state` noun to write through, so the busy session is what every read of the plugin's state answers.
  const { turn: _t, view: _v, roster: _r, ...seed } = s
  on('state.get', (_$, e) => ({ value: { value: (seed as Record<string, unknown>)[e.key], version: 1 } }) as never)
  for (const placement of ['dock', 'inline'] as const) for (let cols = 28; cols <= 220; cols++) {
    const ui = await $.ui.mount({ ...pane(cols, placement), surface: 'terminal' })
    const rows = await rowsOf(ui)
    for (const r of rows) expect(cellWidth(r) <= clampWidth(cols)).toBe(true)
    // A row that starts with a side border ends with one, or with the closing edge of a second frame beside it that ends on that row.
    for (const r of rows.filter(x => /^[│├]/.test(x.trimStart()))) expect(/[│┤]$|└─*┘$/.test(r.trimEnd())).toBe(true)
    if (placement === 'inline') expect(rows.length <= 8).toBe(true)
    await ui.unmount()
  }
})
test('docked, the black fill covers every body row; inline, the frame fits the tree', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  const fillOf = async (placement: 'dock' | 'inline', layout?: string) => {
    if (layout) await $.command.run({ command: 'st-code', args: `layout ${layout}` } as never)
    const ui = await $.ui.mount({ ...pane(120, placement), surface: 'terminal' })
    const root = (await ui.drawn()) as unknown as { props: Record<string, unknown> }
    await ui.unmount()
    return [root.props.backgroundColor, root.props.minHeight]
  }
  expect(await fillOf('dock')).toEqual([COLORS.fill, 70])
  expect(await fillOf('inline')).toEqual([COLORS.fill, undefined])
  expect(await fillOf('dock', 'mini')).toEqual([COLORS.fill, 70])
})
test('inline, the pane is a summary of at most 8 rows', async ($, on) => {
  const clock = engine(on)
  model(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await clock.advance(1000)
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await step($, undefined, 'claude-opus-5-5')
  for (const d of ['one', 'two', 'three', 'four', 'five', 'six']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await step($, 'm1')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T-m2', agentId: 'm2', reason: 'answer' })
  await $.session.measure(reading(20, 1)); await $.session.measure(reading(51, 3.12))
  await step($, 'loop-1')
  await $.turn.complete({ answer: 'done', durationMs: 72_000, isAborted: false, turnId: 'T1', reason: 'answer' })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols, 'inline'), surface: 'terminal' })
    expect(childrenOf(await ui.drawn()).length <= 8).toBe(true)
    const rows = await rowsOf(ui)
    // Every part has something to say here, so every row is drawn, each within the pane: eight rows.
    expect(rows).toHaveLength(8)
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
    expect(rows[0]?.trimEnd()).toBe(cols >= 64 ? '● OPUS 5.5 IDLE   ◐ ▰▰▰▰▱▱▱▱ 51%   $ 3.12' : '● OPUS 5.5 IDLE   ◐ 51%  $ 3.12')
    // Running agents first, newest first; the finished one follows them.
    expect(rows.slice(1, 7).map(r => r.slice(0, 12).trimEnd())).toEqual(['● task six', '● task five', '● task four', '● task three', '● task one', '✓ task two'])
    expect(rows[7]).toMatch(/^loops 1 seen · 1 active +● *$/)
    // No frames, no header bar and no log.
    expect(rows.some(r => /[┌│└]/.test(r))).toBe(false); expect(await ui.find({ text: /LOG|INFO|SERGIO/ })).toBeUndefined()
    expect(rows.some(r => r.includes('⟲'))).toBe(false)
    await ui.unmount()
  }
})
test('wide puts info and tools left, agents and architect right, and the log underneath', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'g1' }))
  on('tool.call', () => ok)
  await clock.advance(1000)
  await $.agent.spawn(spawn('Explore', 'map the call sites'))
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as never)
  const ui = await $.ui.mount({ ...pane(120), surface: 'terminal' })
  const rows = await rowsOf(ui)
  const { left, right, gap } = wideColumns(120)
  const top = rows.findIndex(r => r.startsWith('┌ INFO'))
  const below = (from: number, at: number) => rows.findIndex((r, i) => i > from && r.slice(at).startsWith('└'))
  // Both columns start on the row under the header's gap, each frame as wide as its column.
  expect(top).toBe(2); expect(rows[top]?.indexOf('┌ AGENTS')).toBe(left + gap)
  expect(rows[top]?.charAt(left - 1)).toBe('┐'); expect(rows[top]?.endsWith('┐')).toBe(true)
  const tools = rows.findIndex(r => r.startsWith('┌ TOOLS & FILES'))
  expect(tools > below(top, 0)).toBe(true)
  const log = rows.findIndex(r => r.startsWith('┌ LOG'))
  expect(log > below(tools, 0)).toBe(true); expect(log > below(top, left + gap)).toBe(true)
  expect(rows[log]?.endsWith('┐')).toBe(true); expect(cellWidth(rows[log] ?? '')).toBe(120)
  await ui.unmount()

  // The model gives each panel its column's width, and the log the rows the taller column leaves.
  const s: Snapshot = {
    ...FRESH,
    agents: [normalizeCard({ id: 'a', status: 'running', spawnedAt: 1 })],
    activity: recordCall(DEFAULT_ACTIVITY, { tool: 'Read', input: { file_path: '/r/a.ts' }, hasFailed: false, inSubagent: false, ms: 1, at: 1 }),
    log: Array.from({ length: 20 }, (_, i) => ({ at: i + 1, who: 'you', text: `line ${i}`, agentId: null, kind: 'info' as const, mark: null })),
  }
  const vmAt = (cols: number, bodyRows = 26) => buildViewModel(s, { cfg: parseConfig({}), now: 2, bodyColumns: cols, placement: 'dock', viewedAgentId: null, bodyRows })
  const wide = vmAt(120)
  expect(wide.columns).toEqual({ left: ['info', 'tools'], right: ['agents'], leftWidth: left, rightWidth: right, gap })
  expect([wide.widths.info, wide.widths.tools, wide.widths.agents, wide.widths.log]).toEqual([left, left, right, 120])
  // One column stacks info (4), agents (4) and tools (8) under the header: in 22 rows the log takes the 2 left.
  expect(vmAt(100, 22).columns).toBeNull(); expect(vmAt(100, 22).log?.lines).toHaveLength(2)
  // Two columns: the header and the taller column (12) leave the log every row left of 26 (10), padded to it.
  expect(wide.log?.lines).toHaveLength(10); expect(wide.log?.rows).toBe(10)
})
test('the wide layout holds AGENTS beside INFO from the start; a column the config empties gives the other the width', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'w1' }))
  on('tool.call', () => ok)
  await clock.advance(1000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as never)
  const { left, gap } = wideColumns(130)
  const at = (rows: string[], label: string) => rows.findIndex(r => r.startsWith(`┌ ${label}`))
  // No agent yet: AGENTS stands empty beside INFO, and the first agent takes its row with nothing moving.
  const ui = await $.ui.mount({ ...pane(130), surface: 'terminal' })
  const before = await rowsOf(ui)
  const top = at(before, 'INFO')
  expect(before[top]?.indexOf('┌ AGENTS')).toBe(left + gap); expect(before[top]?.endsWith(' 0 running · 0 total ┐')).toBe(true)
  expect(before[top + 1]?.slice(left + gap)).toMatch(/^│ no agents yet +│$/)
  await ui.unmount()
  await $.agent.spawn(spawn('Explore', 'map the call sites'))
  const split = await $.ui.mount({ ...pane(130), surface: 'terminal' })
  const after = await rowsOf(split)
  expect(after[top]?.indexOf('┌ AGENTS')).toBe(left + gap); expect(after[top + 1]?.slice(left + gap)).toMatch(/^│ ● 1: map the call sites/)
  for (const label of ['TOOLS & FILES', 'LOG']) expect(at(after, label)).toBe(at(before, label))
  await split.unmount()

  // The model: the empty AGENTS is the wide layout's alone, and a column the config leaves empty gives the other the pane's width.
  const vmWith = (panels: string, cols = 120) => buildViewModel(FRESH, { cfg: parseConfig({ panels }), now: 2, bodyColumns: cols, placement: 'dock', viewedAgentId: null, bodyRows: 40 })
  expect(vmWith('info,agents,log', 100).agents).toBeNull()
  expect(vmWith('info,agents,log').agents).toMatchObject({ shown: [], all: [], meta: '0 running · 0 total', isActive: false, rows: 1 })
  expect(vmWith('info,agents,log').columns).toMatchObject({ left: ['info'], right: ['agents'], leftWidth: wideColumns(120).left })
  for (const [panels, p] of [['info,log', 'info'], ['info,architect,log', 'info'], ['agents,log', 'agents']] as const) {
    const vm = vmWith(panels)
    expect(vm.layout).toBe('wide'); expect(vm.columns).toBeNull(); expect(vm.widths[p]).toBe(120)
  }
})
test('while nothing runs, every frame and the header ○ are the idle dark red', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'r1' }))
  on('tool.call', () => ok)
  await clock.advance(1000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as never)
  const C = COLORS
  /** Each frame's border colour, top to bottom, and the colour of the header's dot. */
  const look = async () => {
    const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
    const borders = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'single').map(b => b.props.borderColor)
    const dot = await headerDot(ui)
    await ui.unmount()
    return { borders, dot }
  }
  /** The desktop's pictures, where the frames are strokes. */
  const strokes = async () => {
    const ui = await $.ui.mount({ ...pane(66), surface: 'desktop' })
    const svg = (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.source)).join('')
    await ui.unmount()
    return svg
  }
  // Nothing runs: INFO, TOOLS & FILES and LOG, and the header's dot too.
  expect(await look()).toEqual({ borders: [C.idle, C.idle, C.idle], dot: C.idle })
  expect(await strokes()).toContain(`stroke="${C.idle}"`)
  // A background agent after the turn: AGENTS is green, the rest the frame red, and the dot green.
  await $.agent.spawn(spawn('Explore', 'map the call sites'))
  expect(await look()).toEqual({ borders: [C.frame, C.green, C.frame, C.frame], dot: C.green })
  expect(await strokes()).not.toContain(`stroke="${C.idle}"`)
  // A turn: INFO is green too, and the dot stays green.
  await $.turn.start({ text: 'go', turnId: 'T1' })
  expect(await look()).toEqual({ borders: [C.green, C.green, C.frame, C.frame], dot: C.green })
})
test('every atom holding garbage still draws the header and LOG (Review Focus 1)', async ($, on) => {
  engine(on)
  let junk: unknown = null
  let reads = 0
  // Every read of the plugin's state answers junk, as a broken or much older build might have left it.
  on('state.get', () => {
    reads++
    return { value: { value: junk, version: 1 } } as never
  })
  for (const value of [null, 7, 'x', [], { tools: 'no' }, [null, 3, 'y']]) {
    junk = value
    for (const cols of [64, 120]) {
      reads = 0
      const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
      // One read per stored key: the whole snapshot came from junk.
      expect(reads >= 10).toBe(true)
      expect(await ui.find({ type: 'Text', text: /SERGIO'S TECH · CODE/ })).toBeDefined(); expect(await ui.find({ type: 'Text', text: /^ LOG $/ })).toBeDefined()
      expect(await ui.find({ text: /nothing yet/ })).toBeDefined(); expect(await ui.find({ text: /NaN|undefined|null|object/ })).toBeUndefined()
      for (const r of await rowsOf(ui)) expect(cellWidth(r) <= cols).toBe(true)
      await ui.unmount()
    }
    const mini = await $.ui.mount({ ...pane(64, 'inline'), surface: 'terminal' })
    expect(await rowsOf(mini)).toEqual(['○ IDLE'.padEnd(64)])
    await mini.unmount()
  }
})
test('config hides panels and motion off stops the pulse', { options: { panels: 'info,log', motion: 'off' } }, async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'h1' }))
  on('tool.call', () => ok)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await clock.advance(1000)
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as never)
  await $.session.measure(reading(10, 1)); await $.session.measure(reading(20, 2))
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    expect(rows.some(r => r.includes('┌ INFO'))).toBe(true); expect(rows.some(r => r.includes('┌ LOG'))).toBe(true)
    for (const label of ['AGENTS', 'TOOLS & FILES']) expect(rows.some(r => r.includes(`┌ ${label}`))).toBe(false)
    // Work runs, yet the header's dot is plain text: no pulse module, and nothing else here ticks.
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(COLORS.green)
    await ui.unmount()
  }
  // The inline summary leaves out the hidden panels' rows too.
  const mini = await $.ui.mount({ ...pane(64, 'inline'), surface: 'terminal' })
  expect(await rowsOf(mini)).toEqual([expect.stringMatching(/^● WORKING {3}◐ ▰▰▱▱▱▱▱▱ 20% {3}\$ 2\.00 *$/)])
  await mini.unmount()
})
test('with motion off the clocks still tick', { options: { motion: 'off' } }, async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'k1' }))
  await clock.advance(1000)
  await $.agent.spawn(spawn('Explore', 'look around'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Client' })).map(c => c.props.module)).toEqual(['hooks/client/elapsed.tsx'])
  await ui.unmount()
})
