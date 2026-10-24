import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Elapsed from '../hooks/client/elapsed'
import { EDIT_TOOLS, afterCall } from '../hooks/domain/turn'
import { EFFORT_LEVEL, limitOf, stepSpeed, usageFrom } from '../hooks/domain/vitals'
import { DEFAULT_TURN, DEFAULT_USAGE, normalizeTurn } from '../hooks/state/schema'
import { COLORS } from '../hooks/view/palette'
import { cellWidth, engine, pane, rowsOf, spawn } from './kit'

const at = (ms: number) => new Date(ms).toISOString()

/** A model beneath the plugin that answers one request: 800 ms to its first words, 2 s more to stop after 120 tokens (the mocked clock moves as it streams). */
const answering = (on: On, clock: ReturnType<typeof engine>) =>
  on('turn.step', async function* (_$, e) {
    await clock.advance(800)
    yield { kind: 'text' as const, index: 0, text: 'hello' }
    await clock.advance(2000)
    const usage = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'model-a' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })

/** A model beneath the plugin that answers one request per entry: its first piece after `firstMs`, its stop `decodeMs` later, with `out` output tokens. */
const streaming = (on: On, clock: ReturnType<typeof engine>, steps: { firstMs: number; decodeMs: number; out: number }[]) => {
  let i = 0
  on('turn.step', async function* (_$, e) {
    const step = steps[i++] ?? { firstMs: 0, decodeMs: 0, out: 0 }
    await clock.advance(step.firstMs)
    yield { kind: 'text' as const, index: 0, text: 'the answer' }
    await clock.advance(step.decodeMs)
    const usage = { input_tokens: 10, output_tokens: step.out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'model-a' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: 'the answer', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
}

// ---------------------------------------------------------------- pure modules

test("a request's speed: time to first piece, then output tokens per second to the stop", () => {
  expect(stepSpeed(1000, 1800, 3800, 120)).toEqual({ ttftMs: 800, tokPerS: 60 })
  expect(stepSpeed(1000, null, 3800, 120)).toBeNull(); expect(stepSpeed(1000, 1800, 1800, 120)?.tokPerS).toBeNull()
  expect(stepSpeed(1000, 1800, 3800, null)?.tokPerS).toBeNull(); expect(stepSpeed(1000, 1800, 3800, 0)?.tokPerS).toBeNull()
  expect(stepSpeed(1000, 900, 3800, 120)?.ttftMs).toBe(0)
})
test('a window too short or too quick for its tokens has no rate; the envelope starts the window', () => {
  // A short answer that arrived whole 2.6 s after the request: 150 tokens in 17 ms is a burst, not a pace.
  expect(stepSpeed(0, 2600, 2617, 150)).toEqual({ ttftMs: 2600, tokPerS: null })
  // Longer than the shortest window, still faster than any model streams.
  expect(stepSpeed(0, 6400, 6700, 618)?.tokPerS).toBeNull()
  expect(stepSpeed(0, 1000, 1200, 40)?.tokPerS).toBe(200); expect(stepSpeed(0, 1000, 1199, 40)?.tokPerS).toBeNull()
  expect(stepSpeed(0, 1000, 1500, 500)?.tokPerS).toBe(1000); expect(stepSpeed(0, 1000, 1500, 501)?.tokPerS).toBeNull()
  // Thinking that streamed no text: the envelope at 1 s, the first piece at 6.4 s, 618 tokens over the 5.44 s since the envelope.
  expect(Math.round(stepSpeed(0, 6400, 6440, 618, 1000)?.tokPerS ?? 0)).toBe(114)
  // A normal stream reads the same with its envelope just ahead of the first piece; a start after it is ignored.
  expect(stepSpeed(1000, 1800, 3800, 120, 1800)).toEqual({ ttftMs: 800, tokPerS: 60 }); expect(stepSpeed(1000, 1800, 3800, 120, 2000)?.tokPerS).toBe(60)
})
test('the effort scale has four steps and max shares the top one', () => {
  expect(EFFORT_LEVEL).toEqual({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 })
})
test('edits count from every loop; the error streak only from the main loop', () => {
  const t = afterCall(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: true, isEdit: false }), { inSubagent: false, hasFailed: false, isEdit: true })
  expect(t).toEqual({ edits: 1, errorStreak: 0 })
  const streak = afterCall(afterCall(DEFAULT_TURN, { inSubagent: false, hasFailed: true, isEdit: false }), { inSubagent: false, hasFailed: true, isEdit: false })
  expect(streak).toEqual({ edits: 0, errorStreak: 2 })
  expect(afterCall(streak, { inSubagent: false, hasFailed: false, isEdit: false }).errorStreak).toBe(0)
  expect([...EDIT_TOOLS].sort()).toEqual(['Edit', 'NotebookEdit', 'Write'])
})
test('the turn keeps only what the moments need', () => {
  expect(normalizeTurn({ startedAt: 5, costAtStart: 1, edits: 3, errors: 2, errorStreak: 1, isReviewing: true })).toEqual({ edits: 3, errorStreak: 1 })
  const t = afterCall(afterCall(DEFAULT_TURN, { inSubagent: false, hasFailed: true, isEdit: false }), { inSubagent: true, hasFailed: true, isEdit: true })
  expect(t).toEqual({ edits: 1, errorStreak: 1 })
  expect(afterCall(t, { inSubagent: false, hasFailed: false, isEdit: false }).errorStreak).toBe(0)
})
test('a window keeps its reset time in milliseconds; unusable times become unknown', () => {
  expect(limitOf({ kind: 'five_hour', percentUsed: 19, resetsAt: '1970-01-01T03:10:00.000Z' })).toEqual({ kind: 'five_hour', pct: 19, resetsAt: 11_400_000 })
  expect(limitOf({ kind: 'seven_day', percentUsed: 3 }).resetsAt).toBeNull()
  expect(limitOf({ kind: 'spend_limit', percentUsed: 1, resetsAt: 'soon' }).resetsAt).toBeNull()
})
test('a host reading stores what it reports and nothing it does not (Review Focus 4)', () => {
  const prev = { ...DEFAULT_USAGE, compactions: 2, lastCompactAt: 7, window: 100 }
  const full = usageFrom({ context: { percent: 51, tokens: 102_000, window: 200_000 }, cost: { usd: 3.12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 38, resetsAt: at(60_000) }] }, prev)
  expect(full).toEqual({ pct: 51, tokens: 102_000, window: 200_000, costUsd: 3.12, limits: [{ kind: 'five_hour', pct: 38, resetsAt: 60_000 }], compactions: 2, lastCompactAt: 7 })
  const bare = usageFrom({ context: { percent: null, window: 200_000 }, rateLimits: [] }, prev)
  expect([bare.pct, bare.tokens, bare.costUsd, bare.limits]).toEqual([null, null, null, []])
  const junk = usageFrom({ context: { percent: Number.NaN, tokens: Number.NaN, window: Number.NaN }, cost: { usd: Number.NaN }, rateLimits: null as never }, prev)
  expect([junk.pct, junk.tokens, junk.window, junk.costUsd, junk.limits]).toEqual([null, null, 100, null, []])
})

// ---------------------------------------------------------------- the clock module

test('the elapsed clock counts from a fresh reading and holds still once it has an end', () => {
  const el =
    (type: string) =>
    ({ children, ...props }: Record<string, unknown> & { children?: unknown[] }) =>
      ({ type, props, children: children ?? [] })
  const timers: (() => void)[] = []
  const surface = {
    elements: { Text: el('Text') },
    state: undefined as unknown,
    setState(next: unknown) {
      surface.state = next
    },
    every(_ms: number, fn: () => void) {
      timers.push(fn)
      return () => undefined
    },
    columns: 1,
    rows: 1,
  }
  const shown = (p: { since: number; now: number; endAt: number | null; color: string }) =>
    (Elapsed(p, surface as never) as unknown as { children: string[] }).children[0]
  const run = { since: 1000, now: 4000, endAt: null, color: COLORS.green }
  expect(shown(run)).toBe('0:03')
  timers[0]?.(); timers[0]?.()
  expect(shown(run)).toBe('0:05')
  expect(shown({ ...run, now: 70_000 })).toBe('1:09')
  expect(shown({ ...run, now: 71_000, endAt: 31_000 })).toBe('0:30')
  timers[0]?.()
  expect(shown({ ...run, now: 71_000, endAt: 31_000 })).toBe('0:30')
  expect(timers).toHaveLength(1)
})

// ---------------------------------------------------------------- the INFO panel

test('the main loop is timed per request and a subagent request is left alone', async ($, on) => {
  const clock = engine(on)
  answering(on, clock)
  const before = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await before.find({ text: /ttft/ })).toBeUndefined() // nothing measured yet: no line
  expect(await before.find({ text: /waiting for the first request/ })).toBeDefined()
  await before.unmount()
  let n = 0
  const run = async (agentId?: string) => {
    const s = $.turn.step({ turnId: `S${++n}`, index: 0, model: 'model-a', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    await s.result
  }
  await run('someone-else')
  const quiet = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await quiet.find({ text: /ttft/ })).toBeUndefined(); expect(await quiet.find({ text: /\d req/ })).toBeUndefined()
  await quiet.unmount()
  await run()
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /ttft 0\.8s · 60 tok\/s/ })).toBeDefined()
    await ui.unmount()
  }
})
test('a response that arrives in one burst reads — tok/s, and the next timed one reads its rate', async ($, on) => {
  const clock = engine(on)
  // A short answer delivered whole 2.6 s in, its 150 tokens 17 ms apart; then an answer streamed over 2 s.
  streaming(on, clock, [
    { firstMs: 2600, decodeMs: 17, out: 150 },
    { firstMs: 800, decodeMs: 2000, out: 120 },
  ])
  let n = 0
  const run = async () => {
    const s = $.turn.step({ turnId: `B${++n}`, index: 0, model: 'model-a', messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  await run()
  for (const cols of [40, 64]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /spend {2}ttft 2\.6s · — tok\/s/ })).toBeDefined(); expect(await ui.find({ text: /\d tok\/s/ })).toBeUndefined()
    for (const r of await rowsOf(ui)) expect(cellWidth(r) <= cols).toBe(true)
    await ui.unmount()
  }
  await run()
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /spend {2}ttft 0\.8s · 60 tok\/s/ })).toBeDefined()
  await ui.unmount()
})

test('a finished turn leaves nothing in the pane', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  await $.turn.start({ turnId: 'T1', text: 'go' })
  await $.turn.complete({ answer: 'ok', durationMs: 4000, isAborted: false, turnId: 'T1', reason: 'answer' })
  expect((await rowsOf(ui)).some(r => /last turn|receipt|TURN/.test(r))).toBe(false)
  await ui.unmount()
})
test('a running turn draws no TURN panel', async ($, on) => {
  engine(on)
  await $.turn.start({ turnId: 'T1', text: 'go' })
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(rows.some(r => r.includes('TURN'))).toBe(false); expect(rows.some(r => r.includes('┌ INFO'))).toBe(true)
  await ui.unmount()
})
test("a subagent's turn neither restarts nor ends the main turn", async ($, on) => {
  const clock = engine(on)
  await clock.advance(1000)
  await $.turn.start({ text: 'main work', turnId: 'T1' })
  await $.turn.start({ text: 'sub work', turnId: 'T2', agentId: 'a1' })
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'T2', agentId: 'a1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // The main loop is still running: INFO reads working.
  expect(await ui.find({ text: /● working/ })).toBeDefined()
  await ui.unmount()
})
test('a surface without client modules draws the clock as plain text', async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await clock.advance(1000)
  await $.agent.spawn(spawn('Explore', 'look around'))
  await clock.advance(65_000)
  const ui = await $.ui.mount({ ...pane(64), surface: 'vscode' })
  // The clock is its value at this draw, as a word of the AGENTS picture.
  expect((await ui.findAll({ type: 'Svg' })).some(s => String(s.props.source).includes('>1:05<'))).toBe(true)
  await ui.unmount()
})
