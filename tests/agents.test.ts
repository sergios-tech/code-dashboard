import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentCard, Loop } from '../types'
import { parseConfig } from '../hooks/config'
import Sweep from '../hooks/client/sweep'
import {
  AGENTS_MAX,
  LIST_SHOWN,
  LOOPS_MAX,
  LOOP_ACTIVE_MS,
  addCard,
  agentGlyph,
  applyStep,
  cardTitle,
  finishCard,
  isLoopActive,
  listOrder,
  modelTag,
  newCard,
  noteTool,
  stepLoop,
} from '../hooks/domain/agents'
import { modelFamily } from '../hooks/format/text'
import { DEFAULT_VIEW, normalizeCard } from '../hooks/state/schema'
import { addAgent, finishAgent, loadSnapshot, noteAgentStep, noteArchitectType } from '../hooks/state/store'
import type { Snapshot } from '../hooks/state/store'
import type { Draw } from '../hooks/view/draw'
import { COLORS } from '../hooks/view/palette'
import { agentsPanel } from '../hooks/view/panels/agents'
import { agentTone, svgLanes } from '../hooks/view/svg'
import { NOW, busy } from './fixture'
import { ELS, cellWidth, draw, drawRows, engine, found, pane, rowsOf, spawn, texts, vmOf } from './kit'

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
const framesIntact = (rows: string[]) => rows.slice(1).every(r => r.trim() === '' || /^[┌│├└].*[┐│┤┘]$/.test(r))

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
test('cards and loops stay bounded (Review Focus 5)', () => {
  let list: AgentCard[] = []
  for (let i = 0; i < 30; i++) list = addCard(list, newCard({ id: `a${i}`, type: 't', model: '', description: '', at: i }))
  expect(list).toHaveLength(24)
  let loops: Loop[] = []; for (let i = 0; i < 100; i++) loops = stepLoop(loops, `l${i}`, i)
  expect(loops).toHaveLength(60)
  expect([AGENTS_MAX, LOOPS_MAX, LOOP_ACTIVE_MS]).toEqual([24, 60, 15_000])
  expect([list[0]?.id, list[23]?.id]).toEqual(['a6', 'a29'])
  expect(loops[0]?.id).toBe('l40'); expect(stepLoop(loops, 'l99', 200).find(l => l.id === 'l99')?.steps).toBe(2)
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
test('the list shows running agents first, newest first, then the rest newest first; six rows', () => {
  const at = (id: string, status: AgentCard['status']) => normalizeCard({ id, status })
  const list = [at('a', 'done'), at('b', 'running'), at('c', 'failed'), at('d', 'running'), at('e', 'stopped')]
  expect(listOrder(list).map(c => c.id)).toEqual(['d', 'b', 'e', 'c', 'a'])
  expect(listOrder([])).toEqual([]); expect(LIST_SHOWN).toBe(6)
  const loop = { id: 'l', steps: 1, firstAt: 0, lastAt: 1000, isDone: false }
  expect([isLoopActive(loop, 1000 + LOOP_ACTIVE_MS - 1), isLoopActive(loop, 1000 + LOOP_ACTIVE_MS), isLoopActive({ ...loop, isDone: true }, 1000)]).toEqual([true, false, false])
})
test('the glyph and tone read ✗ in error for a failed agent or an ended one cut at max_tokens', () => {
  const c = (status: AgentCard['status'], lastStop: string | null = null) => normalizeCard({ id: 'x', status, lastStop })
  expect(['running', 'done', 'failed', 'stopped'].map(s => agentGlyph(c(s as AgentCard['status'])))).toEqual(['●', '✓', '✗', '■'])
  expect([agentGlyph(c('done', 'max_tokens')), agentGlyph(c('stopped', 'max_tokens')), agentGlyph(c('running', 'max_tokens')), agentGlyph(c('done', 'end_turn'))]).toEqual(['✗', '✗', '●', '✓'])
  expect([c('running'), c('done'), c('failed'), c('stopped'), c('done', 'max_tokens'), c('running', 'max_tokens')].map(agentTone))
    .toEqual([COLORS.orange, COLORS.green, COLORS.error, COLORS.dim, COLORS.error, COLORS.orange])
})
test('the model tag is the family name only when it differs from the main model', () => {
  const m = (model: string) => normalizeCard({ id: 'x', model })
  expect(['claude-haiku-4-5', 'claude-sonnet-5-5[1m]', 'claude-fable-5-1', 'gpt-x', ''].map(modelFamily)).toEqual(['Haiku', 'Sonnet', 'Fable', 'gpt-x', ''])
  expect([modelTag(m('claude-haiku-4-5'), 'Opus 5.5'), modelTag(m('claude-opus-5-5'), 'Opus 5.5'), modelTag(m(''), 'Opus 5.5'), modelTag(m('claude-opus-5-1'), 'Opus 5.5')]).toEqual(['Haiku', '', '', 'Opus'])
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

const agents = (s: Snapshot, w: number, o: Partial<Draw> = {}) =>
  drawRows(agentsPanel(draw({ now: NOW, hasClient: false, motion: false, ...o }), vmOf(s, w, 'dock', NOW).agents!, w, () => () => undefined)).slice(1)
test('AGENTS is one row per agent, running first, with counts in the meta', () => {
  expect(agents(busy(), 66).slice(0, 6)).toEqual([
    '┌ AGENTS ─────────────────────────────────── 2 running · 5 total ┐',
    '│ ● 1: Count tests by file          Haiku   ▰▰▰▱▱▱▱▱▱▱▱▱▱▱  0:37 │',
    '│ ● 2: Check versions                       ▰▰▰▱▱▱▱▱▱▱▱▱▱▱  0:59 │',
    '│ ✗ 3: List pane structure          Fable   ▰▰▰▰▰▰▰▰▰▰▰▰▰▰  0:10 │',
    '│ ✓ 4: Review README claims         Sonnet  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰  0:11 │',
    '│ ✓ 5: Map hooks to events          Haiku   ▰▰▰▰▰▰▰▰▰▰▰▰▰▰  0:15 │',
  ])
})
test('the tag goes under 50 inside cells and the bar narrows to 10, then 6', () => {
  const at = (w: number) => agents(busy(), w)[1] ?? ''
  expect(at(54)).toContain('Haiku'); expect(at(53)).not.toContain('Haiku')
  expect(at(53)).toContain(' ▰▰▰▱▱▱▱▱▱▱ '); expect(at(50)).toContain(' ▰▰▰▱▱▱▱▱▱▱ '); expect(at(49)).toContain(' ▰▰▰▱▱▱ ')
})
test('more than six agents leave the oldest finished ones under +N earlier at the top', () => {
  const s = busy(); const extra = [0, 1, 2].map(i => normalizeCard({ id: `x${i}`, description: `Old ${i}`, status: 'done', spawnedAt: NOW - 300_000, endedAt: NOW - 290_000 }))
  const rows = agents({ ...s, agents: [...extra, ...s.agents] }, 66)
  expect(rows[1]).toContain('+2 earlier'); expect(rows.filter(r => /│ [●✓✗■] \d:/.test(r))).toHaveLength(6)
})
test('each hotkey sits on a hidden Button; the visible one has orange digits and no hotkey', () => {
  const tree = agentsPanel(draw({ now: NOW }), vmOf(busy(), 66, 'dock', NOW).agents!, 66, () => () => undefined)
  const buttons = found(tree, 'Button')
  expect(buttons.filter(b => b.hotkey).map(b => b.hotkey)).toEqual(['1', '2', '3', '4', '5'])
  expect(buttons.filter(b => !b.hotkey)).toHaveLength(5)
  expect(texts(tree).find(t => t.text === '1')?.color).toBe(COLORS.orange)
  expect(texts(tree).find(t => t.text === ':')?.color).toBe(COLORS.dim)
})
test('a digit or a click opens an agent under the frame, and again closes it', async ($, on) => {
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
  expect(await ui.find({ text: /2 running · 2 total/ })).toBeDefined()
  // Newest first: the second spawn takes digit 1. Its tag is blank (the main model), the first agent's reads Sonnet.
  const rows = await rowsOf(ui)
  expect(rows.some(r => /^│ ● 1: Map the call sites +▰▰▰/.test(r))).toBe(true)
  expect(rows.some(r => /^│ ● 2: Write the parser tests +Sonnet +▰▰▰/.test(r))).toBe(true)
  expect((await ui.find({ key: 'key-ag2' }))?.props.hotkey).toBe('1'); expect((await ui.find({ key: 'key-ag1' }))?.props.hotkey).toBe('2')
  expect((await ui.find({ key: 'card-ag2' }))?.props.hotkey).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Map the call sites$/ })).toBeUndefined()
  await ui.press({ key: 'card-ag2' })
  expect(await ui.find({ type: 'Text', text: /^Map the call sites$/ })).toBeDefined() // the opened block, full task
  expect(await ui.find({ type: 'Text', text: /^Explore · Opus 5\.5 · running · 0 steps · ctx 0 · out 0$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^no tool calls yet$/ })).toBeDefined()
  await ui.press({ key: 'card-ag2' })
  expect(await ui.find({ type: 'Text', text: /^no tool calls yet$/ })).toBeUndefined() // pressed again: closed
  await ui.unmount()
  // A newer agent takes digit 1 and the others move down a row: each digit opens whichever agent sits in that row now.
  await $.agent.spawn(spawn('Plan', 'Third task'))
  const moved = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await moved.find({ key: 'key-ag3' }))?.props.hotkey).toBe('1'); expect((await moved.find({ key: 'key-ag2' }))?.props.hotkey).toBe('2')
  expect((await moved.find({ key: 'key-ag1' }))?.props.hotkey).toBe('3')
  await moved.unmount()
})
test('a running bar sweeps as a Client; the frame is green while any agent runs', () => {
  const tree = agentsPanel(draw({ now: NOW }), vmOf(busy(), 66, 'dock', NOW).agents!, 66, () => () => undefined)
  expect(found(tree, 'Client').filter(c => String(c.module).endsWith('sweep.tsx'))).toHaveLength(2)
  expect(found(tree, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.green])
})
test('with no agent running the frame is red and no bar sweeps', () => {
  const s = { ...busy(), agents: busy().agents.filter(c => c.status !== 'running') }
  const tree = agentsPanel(draw({ now: NOW }), vmOf(s, 66, 'dock', NOW).agents!, 66, () => () => undefined)
  expect(found(tree, 'Client').filter(c => String(c.module).endsWith('sweep.tsx'))).toHaveLength(0)
  expect(found(tree, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.frame])
})
test('the opened agent and the loops sit inside the AGENTS frame under dividers', () => {
  const s = { ...busy(), view: { ...DEFAULT_VIEW, expanded: 'a3' } }
  const rows = agents(s, 66)
  expect(rows.slice(6)).toEqual([
    '├────────────────────────────────────────────────────────────────┤',
    '│ Check versions                                                 │',
    '│ Explore · running · 3 steps · ctx 12k · out 300                │',
    '│ · package.json                                                 │',
    '├────────────────────────────────────────────────────────────────┤',
    '│ loops  2 seen · 1 active  ✓●                                   │',
    '└────────────────────────────────────────────────────────────────┘',
  ])
})
test('an opened agent that drops out of the six rows is not drawn (Review Focus 5)', () => {
  const s = busy(); const more = [0, 1].map(i => normalizeCard({ id: `n${i}`, description: `New ${i}`, status: 'running', spawnedAt: NOW - 1000 }))
  const rows = agents({ ...s, agents: [...s.agents, ...more], view: { ...DEFAULT_VIEW, expanded: 'a1' } }, 66)
  expect(rows.some(r => r.includes('Map hooks to events'))).toBe(false); expect(rows.filter(r => r.startsWith('├'))).toHaveLength(1)
  const gone = agents({ ...s, view: { ...DEFAULT_VIEW, expanded: 'no-such-agent' } }, 66) // Review Focus 2
  expect(gone.filter(r => r.startsWith('├'))).toHaveLength(1)
})
test('loops are no panel of their own any more', () => {
  expect(parseConfig({ panels: 'agents,loops,log' }).panels).toEqual(['agents', 'log'])
  expect(vmOf(busy(), 66, 'dock', NOW).panels.includes('loops' as never)).toBe(false)
})
test('the opened block counts into the rows, a cut agent reads max_tokens, a failed one failed, an unknown model is left out', () => {
  const vmFor = (c: AgentCard) => vmOf({ agents: [c], view: { expanded: c.id, layout: null } }, 64, 'dock', NOW).agents!
  const cut = vmFor(normalizeCard({ id: 'c', type: 'Plan', model: 'claude-haiku-4-5', status: 'failed', lastStop: 'max_tokens', steps: 2, ctx: 1500, out: 2100, endedAt: NOW }))
  expect(cut.expanded?.facts).toBe('Plan · Haiku 4.5 · max_tokens · 2 steps · ctx 2k · out 2k')
  const failed = vmFor(normalizeCard({ id: 'f', type: 'Plan', status: 'failed', steps: 1, endedAt: NOW }))
  expect(failed.expanded?.facts).toBe('Plan · failed · 1 step · ctx 0 · out 0')
  const running = vmFor(normalizeCard({ id: 'r', type: 'Plan', status: 'running', lastStop: 'max_tokens' }))
  expect(running.expanded?.facts).toMatch(/^Plan · running · /)
  // Divider and block, then no loops row (none seen): 1 list row + 1 + (1 task + 1 facts + 1 no-tools row).
  expect(failed.expanded?.rows).toBe(3); expect(failed.rows).toBe(1 + 1 + 3)
  const answered = vmFor(normalizeCard({ id: 'a', description: 'Look', status: 'done', answer: 'Found it.', tools: [{ tool: 'Read', text: 'Read → a', isError: false }, { tool: 'Read', text: 'Read → b', isError: false }] }))
  expect(answered.expanded?.answer).toBe('» Found it.'); expect(answered.expanded?.rows).toBe(1 + 1 + 2 + 1)
})
test('the sweep moves one cell every 100 ms and bounces at the ends', () => {
  const timers: { ms: number; fn: () => void }[] = []
  const surface = {
    elements: ELS,
    state: undefined as unknown,
    setState(next: unknown) { surface.state = next },
    every(ms: number, fn: () => void) { timers.push({ ms, fn }); return () => undefined },
    columns: 1,
    rows: 1,
  }
  const frames = (props: { width: number; color: string; track: string }, n: number) => {
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      if (i > 0) timers[0]?.fn()
      out.push(drawRows(Sweep(props, surface as never) as RenderElement)[0] ?? '')
    }
    return out
  }
  expect(frames({ width: 6, color: COLORS.orange, track: COLORS.faint }, 6)).toEqual(['▰▰▰▱▱▱', '▱▰▰▰▱▱', '▱▱▰▰▰▱', '▱▱▱▰▰▰', '▱▱▰▰▰▱', '▱▰▰▰▱▱'])
  expect(timers.map(t => t.ms)).toEqual([100])
})
test('maxCards is gone (Review Focus 2)', () => expect('maxCards' in parseConfig({ maxCards: 3 })).toBe(false))
test('a wide, emoji or 300-character title keeps the bar and clock in place; an unknown model is dim, an empty one has no tag (Review Focus 4)', () => {
  const odd = [
    normalizeCard({ id: 'w1', description: '日本語のタスク🚀'.repeat(20), model: 'gpt-x', status: 'running', spawnedAt: NOW - 5000 }),
    normalizeCard({ id: 'w2', description: 'x'.repeat(300), model: '', status: 'done', spawnedAt: NOW - 9000, endedAt: NOW - 4000 }),
  ]
  const s = { ...busy(), agents: odd }
  for (const r of agents(s, 66).slice(1, 3)) { expect(cellWidth(r)).toBe(66); expect(r).toMatch(/ [▰▱]{14} {1,2}\d+:\d\d │$/) }
  const tree = agentsPanel(draw({ now: NOW, hasClient: false, motion: false }), vmOf(s, 66, 'dock', NOW).agents!, 66, () => () => undefined)
  expect(texts(tree).find(t => t.text.trim() !== '' && t.text.trim() === modelTag(odd[0]!, 'Opus 5.5'))?.color).toBe(COLORS.dim)
  expect(modelTag(odd[1]!, 'Opus 5.5')).toBe('')
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
  // Opened, the task wraps to at most two rows, the last one cut.
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await ui.press({ key: 'card-x1' })
  await ui.unmount()
  for (const cols of [40, 64]) {
    const rows = await check(cols)
    const task = rows.filter(r => /^│ (fix 🚀 the|x+…?) *│$/.test(r))
    expect(task.length).toBe(2); expect(task[1]?.includes('…')).toBe(true)
  }
  // Four agents with the same task are four rows, each one line, the digits counting from the newest.
  for (let i = 0; i < 3; i++) await $.agent.spawn(spawn('general-purpose', description))
  for (const cols of [40, 64]) {
    const rows = await check(cols, 4)
    expect(rows.filter(r => r.includes('1: fix 🚀 the')).length).toBe(1)
    expect(rows.filter(r => /^│ ● \d: fix 🚀 the x+…/.test(r))).toHaveLength(4)
  }
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
    expect(await ui.find({ text: /1 running · 1 total/ })).toBeDefined() // the same panel above it
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
  // Still running when a request hit max_tokens: it stays a steady orange ●.
  expect((await rowsOf(live)).some(r => /^│ ● 3: task one /.test(r))).toBe(true)
  expect((await live.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(COLORS.orange)
  expect((await live.find({ type: 'Text', text: /^hit max_tokens$/ }))?.props.color).toBe(COLORS.error)
  await live.unmount()
  await clock.advance(102_000)
  await end($, 'm1', 'answer', 'All green.')
  await end($, 'm2', 'aborted')
  await end($, 'm3', 'error')
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  const all = await rowsOf(ui)
  const rows = all.join('\n')
  expect(rows.match(/spawned · general-purpose/g)).toHaveLength(3)
  expect(rows).toMatch(/done · 1m42s/)
  expect((await ui.find({ type: 'Text', text: /^failed$/ }))?.props.color).toBe(COLORS.error)
  expect(await ui.find({ type: 'Text', text: /^stopped$/ })).toBeDefined()
  expect(await ui.find({ text: /0 running · 3 total/ })).toBeDefined()
  // Ended agents list newest first; the one cut at max_tokens reads ✗ although it answered.
  expect(all.some(r => /^│ ✗ 1: task three /.test(r))).toBe(true)
  expect(all.some(r => /^│ ■ 2: task two /.test(r))).toBe(true)
  expect(all.some(r => /^│ ✗ 3: task one /.test(r))).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^✗$/ }))?.props.color).toBe(COLORS.error)
  expect((await ui.find({ type: 'Text', text: /^■$/ }))?.props.color).toBe(COLORS.dim)
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
test('the agent being viewed is marked ▶ before its title, and the log follows it', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `v${++n}` }))
  await clock.advance(1000)
  await $.turn.start({ text: 'main prompt', turnId: 'T1' })
  await $.agent.spawn(spawn('Explore', 'Look around'))
  const viewing = (cols: number) => $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, view: { agentId: 'v1' } }, surface: 'terminal' })
  const wide = await viewing(64)
  expect((await rowsOf(wide)).some(r => r.includes('● ▶ 1: Look around'))).toBe(true)
  expect(await wide.find({ text: /LOG · THIS AGENT/ })).toBeDefined(); expect(await wide.find({ text: /main prompt/ })).toBeUndefined()
  expect(await wide.find({ text: /spawned · Explore/ })).toBeDefined()
  await wide.unmount()
  // A newer agent takes digit 1; the viewed one keeps its mark on the row it now sits in.
  await $.agent.spawn(spawn('Explore', 'Look again'))
  const narrow = await viewing(40)
  const rows = await rowsOf(narrow)
  expect(rows.some(r => r.includes('● ▶ 2: Look around'))).toBe(true); expect(rows.some(r => r.includes('▶ 1:'))).toBe(false)
  for (const r of rows) expect(cellWidth(r) <= 40).toBe(true)
  await narrow.unmount()
})
test('the open agent shows its task, facts, last 3 tools (✗ in error colour) and the start of its answer inside the frame', () => {
  let c = applyStep(newCard({ id: 'a', type: 'Explore', model: 'claude-sonnet-5-5', description: 'Map the call sites', at: 1000 }),
    { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5 }, stopReason: 'end_turn' })
  for (const [text, isError] of [['Glob → **/*.ts', false], ['Bash → ls', false], ['Read → src/a.ts', true], ['Grep → parse', false]] as const) c = noteTool(c, { tool: 'x', text, isError })
  c = finishCard(c, 'answer', 'The parser handles nested blocks. '.repeat(12), 9000)
  const vm = vmOf({ agents: [c], view: { expanded: 'a', layout: null } }, 64, 'dock', 9000)
  const a = vm.agents
  if (!a?.expanded) throw new Error('no expanded block')
  const tree = agentsPanel(draw(), a, vm.width, () => () => undefined)
  const rows = drawRows(tree)
  expect(rows).toContain(`│ Map the call sites${' '.repeat(42)} │`)
  expect(rows).toContain(`│ Explore · Sonnet 5.5 · done · 1 step · ctx 10 · out 5${' '.repeat(7)} │`)
  expect(rows.some(r => r.includes('· Glob'))).toBe(false)
  expect(rows.filter(r => /^│ [·✗] (Bash|Read|Grep) → /.test(r))).toHaveLength(3)
  const toolColor = (s: string) => texts(tree).find(t => t.text === s)?.color
  expect(toolColor('✗ Read → src/a.ts')).toBe(COLORS.error); expect(toolColor('· Bash → ls')).toBe(COLORS.text)
  const answer = rows.filter(r => r.startsWith('│ » The parser handles nested blocks.'))
  expect(answer).toHaveLength(1); expect(answer[0]?.endsWith('… │')).toBe(true)
  expect(texts(tree).find(t => t.text.startsWith('» The parser'))?.color).toBe(COLORS.text)
  expect(texts(tree).find(t => t.text === 'Map the call sites')?.bold).toBe(true)
  expect(texts(tree).find(t => t.text.startsWith('Explore ·'))?.color).toBe(COLORS.dim)
  // One divider above the block; no second frame. The log's share is worked out from these rows.
  expect(rows.filter(r => r.startsWith('├'))).toHaveLength(1); expect(rows.filter(r => r.startsWith('┌'))).toHaveLength(1)
  expect(rows.length).toBe(1 + 2 + a.rows)
  for (const r of rows) expect(cellWidth(r) <= 64).toBe(true)
})
test('an agent with no tool call yet says so, dim', () => {
  const vm = vmOf({ agents: [normalizeCard({ id: 'q', description: 'Quiet', status: 'running', spawnedAt: NOW })], view: { expanded: 'q', layout: null } }, 64, 'dock', NOW)
  const tree = agentsPanel(draw(), vm.agents!, vm.width, () => () => undefined)
  expect(texts(tree).find(t => t.text === 'no tool calls yet')?.color).toBe(COLORS.dim)
})
test('loops no card claim show as N seen · M active, newest last, under AGENTS', async ($, on) => {
  const clock = engine(on)
  model(on)
  const claimed = ['keep', 'wf-2', 'wf-2']
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: claimed.shift() ?? 'extra' }))
  await clock.advance(1000)
  await step($, 'wf-1'); await step($, 'wf-2')
  const rowOf = async () => {
    const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
    const rows = await rowsOf(ui)
    await ui.unmount()
    return rows.find(r => r.includes('loops')) ?? ''
  }
  // Loops alone draw nothing: the row shows only while AGENTS does.
  const quiet = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await quiet.find({ text: /AGENTS/ })).toBeUndefined(); expect(await quiet.find({ text: /loops/ })).toBeUndefined()
  await quiet.unmount()
  await $.agent.spawn(spawn('Explore', 'a real agent'))
  expect(await rowOf()).toMatch(/^│ loops {2}2 seen · 2 active {2}●● *│$/)
  await end($, 'wf-1', 'answer')
  expect(await rowOf()).toMatch(/loops {2}2 seen · 1 active {2}✓●/)
  await clock.advance(LOOP_ACTIVE_MS)
  expect(await rowOf()).toMatch(/loops {2}2 seen · 0 active {2}✓○/)
  // A card spawned under a loop's id claims it.
  await $.agent.spawn(spawn('Explore', 'claimed'))
  expect(await rowOf()).toMatch(/loops {2}1 seen · 0 active {2}✓ *│$/)
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
    expect(await ui.find({ text: /24 running · 24 total/ })).toBeDefined(); expect(await ui.find({ text: /^\+18 earlier$/ })).toBeDefined()
    // All running: the newest takes digit 1, the sixth newest digit 6, and older ones have no row.
    expect((await ui.find({ key: 'key-b30' }))?.props.hotkey).toBe('1'); expect((await ui.find({ key: 'key-b25' }))?.props.hotkey).toBe('6')
    expect(await ui.find({ key: 'card-b24' })).toBeUndefined()
    const rows = await rowsOf(ui)
    expect(rows.some(r => /loops {2}60 seen · 15 active/.test(r))).toBe(true)
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
