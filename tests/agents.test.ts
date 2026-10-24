import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentCard, Loop } from '../types'
import { parseConfig } from '../hooks/config'
import {
  AGENTS_MAX,
  LOOPS_MAX,
  LOOP_ACTIVE_MS,
  addCard,
  applyStep,
  cardFit,
  cardTitle,
  finishCard,
  isLoopActive,
  lanes,
  newCard,
  noteTool,
  stepLoop,
  titleLines,
} from '../hooks/domain/agents'
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
} from '../hooks/state/schema'
import { addAgent, finishAgent, loadSnapshot, noteAgentStep, noteArchitectType } from '../hooks/state/store'
import type { Snapshot } from '../hooks/state/store'
import type { Draw } from '../hooks/view/draw'
import { buildViewModel } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'
import { agentsPanel } from '../hooks/view/panels/agents'
import { svgLanes } from '../hooks/view/svg'
import { cellWidth, drawRows, engine, pane, rowsOf, spawn } from './kit'

type Usage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number }
type Stop = 'end_turn' | 'max_tokens' | 'tool_use'

/** The model beneath the plugin: each request ends as `reply` says, for any loop, at once (tests move the clock). */
const model = (on: On) => {
  const reply: { stopReason: Stop; usage: Usage | null } = { stopReason: 'end_turn', usage: null }
  on('turn.step', async function* (_$, e) {
    const usage = reply.usage ? { ...reply.usage, model: e.model } : null
    yield { kind: 'stop' as const, stopReason: reply.stopReason, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: reply.stopReason, usage }
  })
  return reply
}

/** One model request in a loop: a subagent's or another loop's with an id, the main loop's without. */
const step = async ($: Engine, agentId?: string, name = 'claude-sonnet-5-5') => {
  const s = $.turn.step({ turnId: `S-${agentId ?? 'main'}`, index: 0, model: name, messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) void _
  await s.result
}

/** A subagent's run ends. */
const end = ($: Engine, agentId: string, reason: 'answer' | 'aborted' | 'error', answer = '') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: reason === 'aborted', turnId: `T-${agentId}`, agentId, reason })

/** Every row of a mounted pane past the header is blank or framed on both sides: no frame was broken. */
const framesIntact = (rows: string[]) => rows.slice(1).every(r => r.trim() === '' || /^[┌│└].*[┐│┘]$/.test(r))

// Element constructors that build the plain data a surface's table does, so a renderer is drawn here
// without a mount.
const el =
  (type: string) =>
  ({ children, ...props }: Record<string, unknown> & { children?: unknown[] }) =>
    ({ type, props, children: children ?? [] }) as unknown as RenderElement
const ELS = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client') }
const draw = (): Draw => ({ els: ELS as never, C: COLORS, hasClient: true, motion: true, surface: 'terminal', now: 0 })
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
/** Every element of a type in a drawn tree, with the text of its string children. */
const found = (tree: unknown, type: string): { props: Record<string, unknown>; text: string }[] => {
  if (typeof tree !== 'object' || tree === null) return []
  const n = tree as Node
  const text = (n.children ?? []).filter((c): c is string => typeof c === 'string').join('')
  return [...(n.type === type ? [{ props: n.props ?? {}, text }] : []), ...(n.children ?? []).flatMap(c => found(c, type))]
}

const FRESH: Snapshot = {
  main: DEFAULT_MAIN,
  usage: DEFAULT_USAGE,
  turn: DEFAULT_TURN,
  receipt: null,
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

// The kit's `$` carries no `state` noun, so the store functions get a small in-memory one, and a clock.
const memoryState = (now: number) => {
  const held = new Map<string, { value: unknown; version: number }>()
  const keyOf = (r: { plugin: string; key: string; id?: string }) => `${r.plugin}/${r.key}/${r.id ?? ''}`
  return {
    clock: { now: async () => now },
    state: {
      get: async (r: { plugin: string; key: string; id?: string }) => ({ ...(held.get(keyOf(r)) ?? { value: undefined, version: 0 }) }),
      set: async (r: { plugin: string; key: string; id?: string }, value: unknown, o?: { ifVersion?: number }) => {
        const at = held.get(keyOf(r))?.version ?? 0
        if (o?.ifVersion !== undefined && o.ifVersion !== at) return { isSet: false, version: at }
        held.set(keyOf(r), { value, version: at + 1 })
        return { isSet: true, version: at + 1 }
      },
    },
  } as never as EngineInterface
}

// ---------------------------------------------------------------- pure modules

test("a card's context is its latest step's whole input; output adds up", () => {
  const c = applyStep(applyStep(newCard({ id: 'a', type: 't', model: '', description: 'd', at: 1 }),
    { model: 'm', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }, stopReason: 'tool_use' }),
    { model: 'm', usage: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 7 }, stopReason: 'end_turn' })
  expect(c.ctx).toBe(120); expect(c.out).toBe(12); expect(c.steps).toBe(2)
  const bare = applyStep(c, { model: '', usage: null, stopReason: null })
  expect([bare.ctx, bare.out, bare.steps, bare.model, bare.lastStop]).toEqual([120, 12, 3, 'm', 'end_turn'])
})
test('lanes share one axis; cards and loops stay bounded (Review Focus 5)', () => {
  let list: AgentCard[] = []
  for (let i = 0; i < 30; i++) list = addCard(list, newCard({ id: `a${i}`, type: 't', model: '', description: '', at: i }))
  expect(list).toHaveLength(24)
  let loops: Loop[] = []; for (let i = 0; i < 100; i++) loops = stepLoop(loops, `l${i}`, i)
  expect(loops).toHaveLength(60)
  const g = lanes([{ ...newCard({ id: 'x', type: 't', model: '', description: '', at: 10 }), endedAt: 55 }], 100, 18)[0]
  expect(g).toEqual({ id: 'x', before: 0, bar: 9, after: 9 })
  expect([AGENTS_MAX, LOOPS_MAX, LOOP_ACTIVE_MS]).toEqual([24, 60, 15_000])
  expect([list[0]?.id, list[23]?.id]).toEqual(['a6', 'a29'])
  expect(loops[0]?.id).toBe('l40'); expect(stepLoop(loops, 'l99', 200).find(l => l.id === 'l99')?.steps).toBe(2)
  // Two agents on the same axis: the later one starts where the earlier one's bar is halfway.
  const a = newCard({ id: 'a', type: 't', model: '', description: '', at: 10 })
  const b = { ...newCard({ id: 'b', type: 't', model: '', description: '', at: 55 }), endedAt: 100 }
  expect(lanes([a, b], 100, 18).map(l => [l.before, l.bar, l.after])).toEqual([[0, 18, 0], [9, 9, 0]])
})
test('a card ends as done, stopped or failed, keeps its last 3 tools, and stores no credential', () => {
  const c = newCard({ id: 'a', type: 'Explore', model: 'm', description: 'use token=abcdefgh12345 here', at: 1 })
  expect(c.description).toBe('use token=••• here')
  expect([finishCard(c, 'answer', 'ok', 9).status, finishCard(c, 'aborted', '', 9).status, finishCard(c, 'error', '', 9).status]).toEqual(['done', 'stopped', 'failed'])
  expect(finishCard(c, 'refusal', '', 9).status).toBe('failed')
  const done = finishCard(c, 'answer', 'a'.repeat(500), 9)
  expect([done.endedAt, Array.from(done.answer).length, done.answer.endsWith('…')]).toEqual([9, 400, true])
  let t = c
  for (const n of ['a', 'b', 'c', 'd', 'password=hunter2hunter2']) t = noteTool(t, { tool: 'Bash', text: n, isError: n === 'c' })
  expect(t.tools.map(n => n.text)).toEqual(['c', 'd', 'password=•••']); expect(t.tools[0]?.isError).toBe(true)
  expect(cardTitle(newCard({ id: 'b', type: 'Plan', model: '', description: '  ', at: 1 }))).toBe('Plan')
})
test('a title fills two rows by cells; cards fit by width and the limit', () => {
  expect(titleLines('Write the parser tests', 10, 12)).toEqual(['Write the', 'parser tests'])
  expect(titleLines('Write the parser tests now', 10, 12)).toEqual(['Write the', 'parser test…'])
  expect(titleLines('x'.repeat(30), 10, 12)).toEqual(['x'.repeat(10), `${'x'.repeat(11)}…`])
  expect(titleLines('fix 🚀\n\tthe bug', 7, 12)).toEqual(['fix 🚀', 'the bug'])
  expect([cardFit(36, 3), cardFit(60, 3), cardFit(116, 3), cardFit(116, 6), cardFit(10, 3)]).toEqual([1, 2, 3, 5, 1])
  const loop = { id: 'l', steps: 1, firstAt: 0, lastAt: 1000, isDone: false }
  expect([isLoopActive(loop, 1000 + LOOP_ACTIVE_MS - 1), isLoopActive(loop, 1000 + LOOP_ACTIVE_MS), isLoopActive({ ...loop, isDone: true }, 1000)]).toEqual([true, false, false])
})
test('the SVG axis draws on OLED black in palette colours, its labels escaped', () => {
  const run = newCard({ id: 'r', type: 't', model: '', description: 'a <b> & c', at: 10 })
  const done = finishCard(newCard({ id: 'd', type: 't', model: '', description: 'done one', at: 20 }), 'answer', '', 60)
  const svg = svgLanes([run, done], 100, 480)
  expect(svg.startsWith('<svg')).toBe(true); expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg).toContain(`<rect x="0" y="0" width="480" height="52" fill="${COLORS.fill}"/>`); expect(COLORS.fill).toBe('#000000')
  expect(svg).toContain('a &lt;b&gt; &amp; c'); expect(svg.includes('<b>')).toBe(false)
  expect(svg).toContain(`fill="${COLORS.orange}"`); expect(svg).toContain(`fill="${COLORS.green}"`)
  const palette: string[] = Object.values(COLORS)
  for (const m of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) expect(palette.includes(m[1] ?? '')).toBe(true)
})
test('offered architect types are remembered once each; a card claims its loop; the architect is neither', async () => {
  const $ = memoryState(5000)
  await noteArchitectType($, 'fable-advisor'); await noteArchitectType($, 'fable-advisor')
  expect((await loadSnapshot($)).roster.architectTypes).toEqual(['fable-advisor'])
  for (let i = 0; i < 25; i++) await noteArchitectType($, `t${i}`)
  expect((await loadSnapshot($)).roster.architectTypes).toHaveLength(20)
  // A loop no card claims steps and ends; a card spawned with its id takes it over.
  expect(await noteAgentStep($, 'w1', { model: 'm', usage: null, stopReason: 'end_turn' })).toBeNull()
  expect(await finishAgent($, 'w1', 'answer', '')).toBeNull()
  expect((await loadSnapshot($)).loops).toEqual([{ id: 'w1', steps: 1, firstAt: 5000, lastAt: 5000, isDone: true }])
  await addAgent($, newCard({ id: 'w1', type: 't', model: '', description: 'd', at: 5000 }))
  const s = await loadSnapshot($)
  expect([s.loops, s.agents.map(c => c.id)]).toEqual([[], ['w1']])
  expect((await noteAgentStep($, 'w1', { model: 'm', usage: null, stopReason: 'tool_use' }))?.steps).toBe(1)
  expect((await finishAgent($, 'w1', 'aborted', 'bye'))?.status).toBe('stopped')
})

// ---------------------------------------------------------------- the AGENTS panel

test('subagents become cards, then lanes past the limit; a card expands on its hotkey', async ($, on) => {
  const clock = engine(on)
  model(on)
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: e.subagentType === 'Explore' ? 'claude-opus-5-5' : 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await clock.advance(1000)
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await step($, undefined, 'claude-opus-5-5')
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /AGENTS 2\/2/ })).toBeDefined(); expect(await ui.find({ text: /1-2 expand/ })).toBeDefined()
  const first = await ui.find({ key: 'card-ag1' })
  expect([first?.type, first?.props.hotkey, first?.props.label]).toEqual(['Button', '1', 'Write the parser tests'])
  expect((await ui.find({ key: 'card-ag2' }))?.props.hotkey).toBe('2')
  expect(await ui.find({ type: 'Text', text: /^general-purpose · Sonnet 5\.5$/ })).toBeDefined() // differs from main: named
  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined() // the main model: the type alone
  expect(await ui.find({ type: 'Text', text: /^starting…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● running$/ })).toBeDefined()
  expect((await ui.find({ key: 'card-box-ag1' }))?.props.borderColor).toBe(COLORS.orange)
  expect((await rowsOf(ui)).some(r => /│ ┌─+┐ ┌─+┐ +│/.test(r))).toBe(true) // two bordered cards side by side
  expect(await ui.find({ type: 'Text', text: /^Write the parser tests$/ })).toBeUndefined()
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ type: 'Text', text: /^Write the parser tests$/ })).toBeDefined() // the expanded block, full task
  expect(await ui.find({ type: 'Text', text: /^general-purpose · Sonnet 5\.5 · running · 0 steps$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^no tool calls yet$/ })).toBeDefined()
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ type: 'Text', text: /^no tool calls yet$/ })).toBeUndefined() // pressed again: closed
  await ui.unmount()

  await clock.advance(30_000)
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const lanesUi = await $.ui.mount({ ...pane(64), surface })
    expect(await lanesUi.find({ text: /AGENTS 4\/4/ })).toBeDefined(); expect(await lanesUi.find({ text: /1-4 expand/ })).toBeDefined()
    expect(await lanesUi.find({ type: 'Text', text: /━/ })).toBeDefined()
    expect((await lanesUi.find({ key: 'card-ag4' }))?.props.hotkey).toBe('4')
    expect(await lanesUi.find({ key: 'card-box-ag1' })).toBeUndefined()
    await lanesUi.unmount()
  }
  // On one axis: the first agent's bar runs from the left edge, a late one's is a sliver at the right.
  const rows = await rowsOf(await $.ui.mount({ ...pane(64), surface: 'terminal' }))
  const bar = (title: string) => rows.find(r => r.includes(title))?.match(/━+/)?.[0].length ?? 0
  expect(rows.some(r => /^│ ● 1: Write the par… ━{20,} +0:30 │$/.test(r))).toBe(true)
  expect(rows.some(r => /^│ ● 4: Review the pa… ·{20,}━ +0:00 │$/.test(r))).toBe(true)
  expect(bar('1: Write') > bar('4: Review')).toBe(true)
})
test('cards that cannot fit a 40-column pane fall back to lanes', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await clock.advance(1000)
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ type: 'Text', text: /━/ })).toBeDefined() // lanes
  expect(await narrow.find({ key: 'card-box-w1' })).toBeUndefined()
  for (const r of await rowsOf(narrow)) expect(cellWidth(r) <= 40).toBe(true)
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await wide.find({ type: 'Text', text: /━/ })).toBeUndefined() // two cards fit in 64
  expect(await wide.find({ text: /task beta/ })).toBeDefined(); expect(await wide.find({ key: 'card-box-w2' })).toBeDefined()
  await wide.unmount()
})
test('a description with newlines, emoji and a 300-char word stays one row per line (Review Focus 3)', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `x${++n}` }))
  await clock.advance(1000)
  const description = 'fix 🚀\n\tthe ' + 'x'.repeat(300)
  await $.agent.spawn(spawn('general-purpose', description))
  const check = async (cols: number, spawned = 1) => {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
    expect(framesIntact(rows)).toBe(true)
    expect(rows.filter(r => r.includes('spawned ·'))).toHaveLength(spawned)
    expect(rows.some(r => r.includes('\t'))).toBe(false)
    await ui.unmount()
    return rows
  }
  for (const cols of [40, 64]) expect((await check(cols)).some(r => r.includes('1: fix 🚀 the'))).toBe(true)
  // Opened, the task wraps to at most three rows, the last one cut.
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await ui.press({ key: 'card-x1' })
  await ui.unmount()
  for (const cols of [40, 64]) {
    const rows = await check(cols)
    const task = rows.filter(r => /^│ (fix 🚀 the|x+…?) *│$/.test(r))
    expect(task.length).toBe(3); expect(task[2]?.includes('…')).toBe(true)
  }
  // Past the card limit the same task is one lane row.
  for (let i = 0; i < 3; i++) await $.agent.spawn(spawn('general-purpose', description))
  for (const cols of [40, 64]) expect((await check(cols, 4)).filter(r => r.includes('1: fix 🚀 the')).length).toBe(1)
})
test('desktop draws the agents as an SVG axis on black', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `d${++n}` }))
  await clock.advance(1000)
  await $.agent.spawn(spawn('Explore', 'Map <the> call & sites'))
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    const svg = await ui.find({ type: 'Svg' })
    const source = String(svg?.props.source ?? '')
    expect(source.startsWith('<svg')).toBe(true); expect(source).toContain('fill="#000000"')
    expect(source).toContain('Map &lt;the&gt; call &amp; sites'); expect(String(svg?.props.alt)).toMatch(/^1 agent on one time axis$/)
    expect(await ui.find({ text: /AGENTS 1\/1/ })).toBeDefined() // the same panel above it
    await ui.unmount()
  }
  const terminal = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  await terminal.unmount()
})
test('spawns and ends are logged; max_tokens is flagged in error colour', async ($, on) => {
  const clock = engine(on)
  const reply = model(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  await clock.advance(1000)
  for (const d of ['one', 'two', 'three']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  reply.stopReason = 'max_tokens'
  reply.usage = { input_tokens: 1000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, output_tokens: 3000 }
  await step($, 'm1')
  const live = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect((await live.find({ key: 'card-box-m1' }))?.props.borderColor).toBe(COLORS.error)
  expect((await live.find({ key: 'card-box-m2' }))?.props.borderColor).toBe(COLORS.orange)
  expect(await live.find({ type: 'Text', text: /^ctx 41k · out 3k · 1 st$/ })).toBeDefined()
  expect((await live.find({ type: 'Text', text: /^● max_tokens$/ }))?.props.color).toBe(COLORS.error)
  expect((await live.find({ type: 'Text', text: /^hit max_tokens$/ }))?.props.color).toBe(COLORS.error)
  await live.unmount()
  await clock.advance(102_000)
  await end($, 'm1', 'answer', 'All green.')
  await end($, 'm2', 'aborted')
  await end($, 'm3', 'error')
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  const rows = (await rowsOf(ui)).join('\n')
  expect(rows.match(/spawned · general-purpose/g)).toHaveLength(3)
  expect(rows).toMatch(/done · 1m42s/)
  expect((await ui.find({ type: 'Text', text: /^failed$/ }))?.props.color).toBe(COLORS.error)
  expect(await ui.find({ type: 'Text', text: /^stopped$/ })).toBeDefined()
  expect(await ui.find({ text: /AGENTS 0\/3/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^✓ max_tokens$/ }))?.props.color).toBe(COLORS.error)
  expect((await ui.find({ type: 'Text', text: /^■ stopped$/ }))?.props.color).toBe(COLORS.dim)
  expect((await ui.find({ type: 'Text', text: /^✗ failed$/ }))?.props.color).toBe(COLORS.error)
  expect((await ui.find({ key: 'card-box-m2' }))?.props.borderDimColor).toBe(true)
  await ui.unmount()
})
test("a subagent's answer is masked before it is stored or drawn in the open card", async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `r${++n}` }))
  await clock.advance(1000)
  await $.agent.spawn(spawn('Explore', 'Find the deploy key'))
  await clock.advance(2000)
  const secret = 'ghp_Zx9Qw3Lm7Kd2Vb8Rt5'
  await end($, 'r1', 'answer', `Found it: use ${secret} to deploy.`)
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  await ui.press({ key: 'card-r1' })
  const rows = await rowsOf(ui)
  expect(rows.some(r => r.includes(secret) || r.includes('Zx9Qw3Lm7Kd2'))).toBe(false)
  expect(rows.some(r => r.startsWith('│ » Found it: use ••• to deploy.'))).toBe(true)
  await ui.unmount()
})
test('the agent being viewed is marked ▶, as a card and as a lane, and the log follows it', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `v${++n}` }))
  await clock.advance(1000)
  await $.turn.start({ text: 'main prompt', turnId: 'T1' })
  await $.agent.spawn(spawn('Explore', 'Look around'))
  const viewing = (cols: number) => $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, view: { agentId: 'v1' } }, surface: 'terminal' })
  const card = await viewing(64)
  expect((await rowsOf(card)).some(r => r.includes('▶ 1: Look around'))).toBe(true)
  expect(await card.find({ text: /LOG · THIS AGENT/ })).toBeDefined(); expect(await card.find({ text: /main prompt/ })).toBeUndefined()
  expect(await card.find({ text: /spawned · Explore/ })).toBeDefined()
  await card.unmount()
  await $.agent.spawn(spawn('Explore', 'Look again'))
  const lane = await viewing(40)
  expect((await rowsOf(lane)).some(r => r.includes('● ▶ 1: Look around'))).toBe(true)
  await lane.unmount()
})
test('the open card shows its task, facts, last 3 tools (✗ in error colour) and the start of its answer', () => {
  let c = applyStep(newCard({ id: 'a', type: 'Explore', model: 'claude-sonnet-5-5', description: 'Map the call sites', at: 1000 }),
    { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5 }, stopReason: 'end_turn' })
  for (const [text, isError] of [['Glob → **/*.ts', false], ['Bash → ls', false], ['Read → src/a.ts', true], ['Grep → parse', false]] as const) c = noteTool(c, { tool: 'x', text, isError })
  c = finishCard(c, 'answer', 'The parser handles nested blocks. '.repeat(12), 9000)
  const vm = buildViewModel({ ...FRESH, agents: [c], view: { expanded: 'a', layout: null } }, { cfg: parseConfig({}), now: 9000, bodyColumns: 64, placement: 'dock', viewedAgentId: null })
  const a = vm.agents
  if (!a?.expanded) throw new Error('no expanded block')
  const tree = agentsPanel(draw(), a, vm.width, () => () => undefined)
  const rows = drawRows(tree)
  expect(rows).toContain(`│ Map the call sites${' '.repeat(42)} │`)
  expect(rows).toContain(`│ Explore · Sonnet 5.5 · done · 1 step${' '.repeat(24)} │`)
  expect(rows.some(r => r.includes('· Glob'))).toBe(false)
  expect(rows.filter(r => /^│ [·✗] (Bash|Read|Grep) → /.test(r))).toHaveLength(3)
  const texts = found(tree, 'Text')
  const toolColor = (s: string) => texts.find(t => t.text === s)?.props.color
  expect(toolColor('✗ Read → src/a.ts')).toBe(COLORS.error); expect(toolColor('· Bash → ls')).toBe(COLORS.text)
  const answer = rows.filter(r => /^│ (» )?The parser|^│ (blocks|nested|handles)/.test(r))
  expect(rows.some(r => r.startsWith('│ » The parser handles nested blocks.'))).toBe(true)
  expect(answer.length <= 3).toBe(true)
  // The log's share is worked out from these rows: the panel draws exactly what the view model counts.
  expect(rows.length).toBe(1 + 2 + a.rows + a.expanded.rows)
  for (const r of rows) expect(cellWidth(r) <= 64).toBe(true)
})
test('loops no card claims show as N seen · M active, newest last', async ($, on) => {
  const clock = engine(on)
  model(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'wf-2' }))
  await clock.advance(1000)
  await step($, 'wf-1'); await step($, 'wf-2')
  const rowOf = async () => {
    const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
    const rows = await rowsOf(ui)
    await ui.unmount()
    return rows.find(r => r.includes('LOOPS')) ?? ''
  }
  expect(await rowOf()).toMatch(/^ LOOPS {2}2 seen · 2 active {2}●● *$/)
  await end($, 'wf-1', 'answer')
  expect(await rowOf()).toMatch(/LOOPS {2}2 seen · 1 active {2}✓●/)
  await clock.advance(LOOP_ACTIVE_MS)
  expect(await rowOf()).toMatch(/LOOPS {2}2 seen · 0 active {2}✓○/)
  const quiet = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await quiet.find({ text: /AGENTS/ })).toBeUndefined()
  await quiet.unmount()
  // A card spawned under a loop's id claims it.
  await $.agent.spawn(spawn('Explore', 'claimed'))
  expect(await rowOf()).toMatch(/LOOPS {2}1 seen · 0 active {2}✓ *$/)
})
test('30 agents and 100 other loops keep their bounds, and the pane still draws (Review Focus 5)', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = engine(on)
  model(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `b${++n}` }))
  await clock.advance(1000)
  for (let i = 0; i < 30; i++) await $.agent.spawn(spawn('general-purpose', `task ${i}`))
  for (let i = 0; i < 100; i++) {
    await clock.advance(1000)
    await step($, `loop-${i}`)
  }
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /AGENTS 24\/24/ })).toBeDefined(); expect(await ui.find({ text: /^\+18 earlier$/ })).toBeDefined()
    expect((await ui.find({ key: 'card-b30' }))?.props.hotkey).toBe('6'); expect(await ui.find({ key: 'card-b24' })).toBeUndefined()
    const rows = await rowsOf(ui)
    expect(rows.some(r => /LOOPS {2}60 seen · 15 active/.test(r))).toBe(true)
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
    await ui.unmount()
  }
})
test('offering and spawning pass the event on unchanged', async ($, on) => {
  engine(on)
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'p1' }))
  expect(await $.agent.offer({ agent: 'fable-advisor', description: 'reviews plans', source: 'plugin', provider: { plugin: 'engine', tier: 'core' } })).toEqual({ isOffered: true })
  expect(await $.agent.spawn(spawn('Explore', 'pass it on'))).toEqual({ model: 'claude-sonnet-5-5', agentId: 'p1' })
})
