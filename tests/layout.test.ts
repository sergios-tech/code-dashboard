import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseConfig } from '../hooks/config'
import { recordCall } from '../hooks/domain/activity'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_DENIALS,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TRENDS,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  normalizeCard,
} from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/store'
import { clampWidth, wideColumns } from '../hooks/view/layout'
import { buildViewModel } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'
import { cellWidth, engine, pane, rowsOf, spawn } from './kit'

/** The model beneath the plugin: every request ends at once, for any loop. */
const model = (on: On) => {
  on('turn.step', async function* (_$, e) {
    const usage = { input_tokens: 1000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, output_tokens: 3000, model: e.model }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
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

/** Every frame and card drawn whole: each row opens as many corners as it closes. */
const cornersPaired = (rows: string[]) =>
  rows.every(r => r.split('┌').length === r.split('┐').length && r.split('└').length === r.split('┘').length)

const FRESH: Snapshot = {
  main: DEFAULT_MAIN,
  usage: DEFAULT_USAGE,
  turn: DEFAULT_TURN,
  agents: [],
  loops: [],
  architect: DEFAULT_ARCHITECT,
  activity: DEFAULT_ACTIVITY,
  trends: DEFAULT_TRENDS,
  denials: DEFAULT_DENIALS,
  log: [],
  view: DEFAULT_VIEW,
  roster: DEFAULT_ROSTER,
}

test('a fresh session draws on every surface and width, empty panels hidden', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    expect(await ui.find({ text: /SERGIO'S TECH · CODE/ })).toBeDefined(); expect(await ui.find({ text: /INFO/ })).toBeDefined()
    expect(await ui.find({ text: /AGENTS|TRENDS|TOOLS & FILES|ARCHITECT/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ LOG $/ })).toBeDefined(); expect(await ui.find({ text: /TURN|loops/ })).toBeUndefined()
    await ui.unmount()
  }
})
test('no drawn row is wider than the pane, from 28 to 220 columns (Review Focus 2)', { timeoutMs: 15_000 }, async ($, on) => {
  const clock = engine(on)
  model(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `w${++n}` }))
  on('tool.call', () => ok)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await clock.advance(1000)
  await $.turn.start({ text: 'build the parser', turnId: 'T1' })
  for (const d of ['parse the 🚀 config\twith tabs\nand newlines', 'x'.repeat(300), 'map the call sites']) await $.agent.spawn(spawn('general-purpose', d))
  await step($, 'w1')
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'review the plan'))
  for (let i = 0; i < 20; i++) {
    const file_path = `/repo/src/mod${i % 6}/${'deep'.repeat(i % 2 ? 1 : 20)}${i % 3}.ts`
    await $.tool.call((i % 4 === 0 ? { tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } : { tool: 'Read', file_path }) as never)
  }
  for (let i = 1; i <= 5; i++) await $.session.measure(reading(i * 10, i * 0.5))
  await step($, 'loop-1')
  for (const surface of ['terminal', 'desktop'] as const) for (const cols of [28, 40, 64, 120, 220]) {
    const ui = await $.ui.mount({ ...pane(cols), surface })
    const rows = await rowsOf(ui)
    for (const r of rows) expect(cellWidth(r) <= clampWidth(cols)).toBe(true)
    expect(rows[0]?.startsWith("▌SERGIO'S TECH · CODE")).toBe(true); expect(cornersPaired(rows)).toBe(true)
    for (const label of ['INFO', 'TRENDS', 'AGENTS', 'loops', 'ARCHITECT', 'TOOLS & FILES', 'LOG']) expect(rows.some(r => r.includes(label))).toBe(true)
    await ui.unmount()
  }
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
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await step($, 'm1')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'T-m2', agentId: 'm2', reason: 'answer' })
  // A first reading with cost alone leaves no gap at the start of the one-row sparkline.
  await $.session.measure({ context: { window: 200_000 }, cost: { usd: 0.5 }, rateLimits: [], changed: ['cost'] })
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
    expect(rows[1]).toMatch(/^◐ ctx +[▁-█ ]+ +51% *$/)
    // Running agents first, newest first; the finished one follows them.
    expect(rows.slice(2, 7).map(r => r.slice(0, 12).trimEnd())).toEqual(['● task five', '● task four', '● task three', '● task one', '✓ task two'])
    expect(rows[7]).toMatch(/^loops 1 seen · 1 active +● *$/)
    // No frames, no header bar and no log.
    expect(rows.some(r => /[┌│└]/.test(r))).toBe(false); expect(await ui.find({ text: /LOG|INFO|SERGIO/ })).toBeUndefined()
    expect(rows.some(r => r.includes('⟲'))).toBe(false)
    await ui.unmount()
  }
})
test('wide puts info, trends and tools left, agents and architect right, and the log underneath', async ($, on) => {
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
  // Two columns: the header and the taller column (10) leave the log its most.
  expect(wide.log?.lines).toHaveLength(8)
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
  for (const value of [null, 7, 'x', [], { tools: 'no', samples: 3 }, [null, 3, 'y']]) {
    junk = value
    for (const cols of [64, 120]) {
      reads = 0
      const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
      // One read per stored key: the whole snapshot came from junk.
      expect(reads >= 12).toBe(true)
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
    for (const label of ['AGENTS', 'TRENDS', 'TOOLS & FILES']) expect(rows.some(r => r.includes(`┌ ${label}`))).toBe(false)
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
