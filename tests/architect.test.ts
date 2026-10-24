import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

import type { Architect } from '../types'
import { parseConfig } from '../hooks/config'
import {
  CONSULTS_MAX,
  IDS_MAX,
  SEEN_MAX,
  adviceLine,
  consultLine,
  consultTimeline,
  endConsult,
  handbackOf,
  isAdvising,
  momentOf,
  startConsult,
} from '../hooks/domain/architect'
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
import { addArchitectId, loadSnapshot, markSeen } from '../hooks/state/store'
import type { Snapshot } from '../hooks/state/store'
import { buildViewModel } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'
import { architectPanel } from '../hooks/view/panels/architect'
import { busy, NOW } from './fixture'
import { cellWidth, draw, drawRows, engine, found, pane, rowsOf, spawn, texts, vmOf } from './kit'

/** The stand-ins of kit.engine, with every status line the plugin sets recorded. */
const watched = (on: On) => {
  const clock = mock.clock(on)
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return { clock, statuses }
}

/** The model beneath the plugin: every request ends at once, with no usage. */
const model = (on: On) =>
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

/** One model request in a subagent's loop. */
const step = async ($: Engine, agentId: string) => {
  const s = $.turn.step({ turnId: `S-${agentId}`, index: 0, model: 'model-x', messageCount: 1, agentId })
  for await (const _ of s) void _
  await s.result
}

let rowN = 0

/** One row of the main loop's reply, as the engine appends it. */
const reply = ($: Engine, content: unknown[]) =>
  $.session.append({
    message: { type: 'assistant', role: 'assistant', content: content as never },
    door: 'response',
    origin: { kind: 'model', model: 'model-x' },
    uuid: `row-${++rowN}`,
  })

const advisorUse = (id: string) => ({ type: 'server_tool_use', id, name: 'advisor', input: {} })
const advisorResult = (id: string) => ({ type: 'advisor_tool_result', tool_use_id: id, content: { type: 'advisor_redacted_result' } })

/** The pane's rows at a width, unmounted again. */
const drawn = async ($: Engine, cols = 100, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ ...pane(cols), surface })
  const rows = await rowsOf(ui)
  await ui.unmount()
  return rows
}

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

test('consults open, close by id, and draw on a shared timeline', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 'c1', at: 0, moment: 'before a plan', via: 'advisor tool' })
  a = startConsult(a, { id: 'c1', at: 5, moment: 'before done', via: 'x' }); expect(a.consults).toHaveLength(1)
  expect(isAdvising(a)).toBe(true)
  a = endConsult(a, 10, 'Use a queue', 'c1'); expect(isAdvising(a)).toBe(false); expect(a.lastAdvice).toBe('Use a queue')
  a = startConsult(a, { id: 'c2', at: 50, moment: 'before done', via: 'y' })
  expect(consultTimeline(a, 100, 20).split('◆').length - 1).toBe(2)
  // From the first consult to now: the first ran briefly, the second still runs to the right edge.
  expect(consultTimeline(a, 100, 20)).toBe(`◆━${'─'.repeat(7)}◆${'━'.repeat(10)}`)
  expect(consultTimeline(DEFAULT_ARCHITECT, 100, 6)).toBe('──────'); expect(consultTimeline(a, 100, Number.NaN)).toBe('')
  // An end names its consult; without a name the latest open one ends, and no advice keeps the last.
  expect(endConsult(a, 60, null, 'nope').consults).toEqual(a.consults)
  const b = endConsult(a, 60, null)
  expect([b.consults[1]?.endAt, b.lastAdvice]).toEqual([60, 'Use a queue'])
})
test('moments are inferred from the turn so far', () => {
  expect(momentOf({ edits: 0, errorStreak: 0 })).toBe('before a plan'); expect(momentOf({ edits: 3, errorStreak: 2 })).toBe('error repeats')
  expect(momentOf({ edits: 3, errorStreak: 0 })).toBe('before done'); expect(momentOf({ edits: 0, errorStreak: 2 })).toBe('error repeats')
  expect(momentOf({ edits: 3, errorStreak: 1 })).toBe('before done')
})
test('hand-backs and advice lines', () => {
  expect(handbackOf('<agent-message from="ab12">\nThe report follows:\n**Ship it** now')).toEqual({ from: 'ab12', body: '**Ship it** now' })
  expect(adviceLine('## **Ship it** now')).toBe('Ship it now')
  const hb = '<agent-message from="a1940a83">\n[Hand-back] The text below is the final report. The report follows:\n  Add parser tests first.\n  - more\n</agent-message>'
  expect(handbackOf(hb)).toEqual({ from: 'a1940a83', body: 'Add parser tests first.' })
  expect(handbackOf('<agent-message from="x">\nPlain report line\n</agent-message>')).toEqual({ from: 'x', body: 'Plain report line' })
  expect(handbackOf('fix the parser')).toBeNull(); expect(handbackOf('<agent-message from="x">\n</agent-message>')).toBeNull()
  expect(adviceLine('[note] header\n\n> - __Fix card overflow first__\nmore')).toBe('Fix card overflow first')
  expect(adviceLine('use token=abcdefgh12345 here')).toBe('use token=••• here') // masked before it is kept
  const long = adviceLine('x '.repeat(200))
  expect([Array.from(long).length, long.endsWith('…')]).toEqual([160, true])
  expect(adviceLine('')).toBe('')
})
test('the panel says when the last consult ran and how long it took', () => {
  const a = startConsult(DEFAULT_ARCHITECT, { id: 'c1', at: 1000, moment: 'before a plan', via: 'advisor tool' })
  expect(consultLine(DEFAULT_ARCHITECT, 0)).toBe('not consulted yet')
  expect(consultLine(a, 5000)).toMatch(/^consulting since \d\d:\d\d:\d\d$/)
  const done = endConsult(a, 15_000, null)
  expect(consultLine(done, 135_000)).toBe('last 2m ago · took 14s'); expect(consultLine(done, 45_000)).toBe('last 30s ago · took 14s')
  expect(consultLine(done, 15_000 + 3_900_000)).toBe('last 1h05m ago · took 14s')
})
test('consults, architect ids and seen tool calls stay bounded (Review Focus 5)', async () => {
  let a: Architect = DEFAULT_ARCHITECT
  for (let i = 0; i < 50; i++) a = startConsult(a, { id: `c${i}`, at: i, moment: 'before a plan', via: 'v' })
  expect(a.consults).toHaveLength(40); expect(a.consults[0]?.id).toBe('c10')
  const $ = memoryState(1000)
  for (let i = 0; i < 50; i++) await addArchitectId($, `a${i}`)
  for (let i = 0; i < 70; i++) await markSeen($, `s${i}`)
  const s = (await loadSnapshot($)).architect
  expect([s.ids.length, s.seen.length, s.ids[0], s.seen[0]]).toEqual([40, 60, 'a10', 's10'])
  expect(await markSeen($, 's69')).toBe(false); expect(await markSeen($, 'fresh')).toBe(true)
  expect([CONSULTS_MAX, IDS_MAX, SEEN_MAX]).toEqual([40, 40, 60])
})
test('the panel draws within 40, 64 and 120 columns, the moments narrowed to the lit one when tight', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 'c1', at: 1000, moment: 'before a plan', via: 'advisor tool' })
  a = endConsult(a, 15_000, `Split the parser 🚀\tbefore ${'x'.repeat(300)}`, 'c1')
  a = startConsult(a, { id: 'c2', at: 60_000, moment: 'before done', via: 'fable-advisor' })
  for (const cols of [40, 64, 120]) {
    const vm = buildViewModel({ ...FRESH, architect: a }, { cfg: parseConfig({ layout: 'compact' }), now: 135_000, bodyColumns: cols, placement: 'dock', viewedAgentId: null })
    const v = vm.architect
    if (!v) throw new Error('no architect panel')
    const rows = drawRows(architectPanel(draw(), v, vm.width))
    // The log's share is worked out from these rows: the gap, the two borders and the body.
    expect(rows.length).toBe(3 + v.rows); expect(v.rows).toBe(5)
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
    expect(rows.slice(1).every(r => /^[┌│└].*[┐│┘]$/.test(r))).toBe(true)
    expect(rows[1]).toMatch(/^┌ ARCHITECT ─+ consults 2 ┐$/)
    expect(rows[2]).toMatch(/^│ ● advising +│$/)
    expect(rows[3]).toMatch(/^│ ◆━+─+◆━+ │$/)
    expect(rows.some(r => r.includes('◆ before done') && r.includes('(inferred)'))).toBe(true)
    expect(rows.some(r => r.includes('◇ before a plan'))).toBe(cols >= 64)
    expect(rows.some(r => r.startsWith('│ » Split the parser 🚀 before x'))).toBe(true)
  }
})
// ---------------------------------------------------------------- the ARCHITECT panel

test('the server-side advisor is read from assistant rows: advising, then on call', async ($, on) => {
  const { clock, statuses } = watched(on)
  await clock.advance(1000)
  await $.turn.start({ text: 'plan it', turnId: 'T1' })
  await reply($, [{ type: 'text', text: 'Checking the plan.' }, advisorUse('srv1')])
  await reply($, [advisorUse('srv1')]) // the same call read again opens no second consult
  const mid = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect(await mid.find({ type: 'Text', text: /^ ARCHITECT $/ })).toBeDefined(); expect(await mid.find({ text: /^ consults 1 $/ })).toBeDefined()
  expect((await mid.findAll({ type: 'Text', text: /^● advising$/ })).some(t => t.props.color === COLORS.architect)).toBe(true)
  expect(await mid.find({ type: 'Text', text: /^consulting since \d\d:\d\d:\d\d$/ })).toBeDefined()
  expect((await mid.find({ type: 'Text', text: /^◆ before a plan$/ }))?.props.color).toBe(COLORS.architect)
  expect(await mid.find({ type: 'Text', text: /^◇ before done$/ })).toBeDefined(); expect(await mid.find({ type: 'Text', text: /^\(inferred\)$/ })).toBeDefined()
  expect(await mid.find({ type: 'Text', text: / WORKING · ARCHITECT ADVISING$/ })).toBeDefined()
  expect((await rowsOf(mid)).filter(r => /architect +before a plan · advisor tool/.test(r))).toHaveLength(1)
  await mid.unmount()
  expect(statuses.at(-1)).toBe('architect advising')

  await clock.advance(14_000)
  await reply($, [advisorResult('srv1')])
  await clock.advance(120_000)
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /^○ on call$/ })).toBeDefined(); expect(await after.find({ text: /advising/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: /^last 2m ago · took 14s$/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: / · ARCHITECT ON CALL$/ })).toBeDefined()
  const rows = await rowsOf(after)
  expect(rows.some(r => /^│ ◆━{6}─{53} │$/.test(r))).toBe(true) // 14s of 2m14s, across the 60 cells inside the frame
  expect(rows.some(r => /architect +advice returned/.test(r))).toBe(true)
  await after.unmount()
  expect(statuses.at(-1)).toBe('architect 1')
})
test('a consult whose start and result share one row closes there; other server tools are left alone', async ($, on) => {
  const clock = engine(on)
  await clock.advance(1000)
  await $.turn.start({ text: 'go', turnId: 'T4' })
  await reply($, [{ type: 'server_tool_use', id: 'ws1', name: 'web_search', input: {} }, { type: 'web_search_tool_result', tool_use_id: 'ws1', content: [] }])
  expect((await drawn($)).some(r => r.includes('ARCHITECT'))).toBe(false)
  await reply($, [advisorUse('srv9'), advisorResult('srv9'), { type: 'web_search_tool_result', tool_use_id: 'ws2', content: [] }])
  const rows = await drawn($)
  expect(rows.some(r => /^│ ○ on call +│$/.test(r))).toBe(true); expect(rows.some(r => r.includes('consults 1'))).toBe(true)
  expect(rows.filter(r => /architect +(before a plan · advisor tool|advice returned)/.test(r))).toHaveLength(2)
})
test("a background architect's advice is read from its hand-back", async ($, on) => {
  const clock = engine(on)
  model(on)
  const ids = ['fab1', 'fab2', 'w1']
  let n = 0
  on('agent.spawn', () => ({ model: 'model-x', agentId: ids[n++] ?? 'extra' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await clock.advance(1000)
  await $.turn.start({ text: 'review it', turnId: 'H1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await step($, 'fab1')
  // The architect is a consult: no card, and its requests are not among the other loops.
  let rows = await drawn($)
  expect(rows.some(r => r.includes('AGENTS'))).toBe(false); expect(rows.some(r => r.includes('loops'))).toBe(false)
  expect(rows.some(r => /^│ ● advising +│$/.test(r))).toBe(true)
  expect(rows.some(r => /architect +before a plan · fable-advisor/.test(r))).toBe(true); expect(rows.some(r => r.includes('spawned ·'))).toBe(false)

  await $.tool.call({ tool: 'SubagentHandback', message: '## Ship it after one more parser test.\n- details', agentId: 'fab1' } as never)
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'A1', agentId: 'fab1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /^» Ship it after one more parser test\.$/ })).some(t => t.props.color === COLORS.architect)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^○ on call$/ })).toBeDefined()
  await ui.unmount()
  // The same report opening the main loop's next turn is not logged again, nor as an engine line.
  await $.turn.start({ text: '<agent-message from="fab1">\n[Hand-back] The report follows:\n  Ship it after one more parser test.\n</agent-message>', turnId: 'H2' })
  rows = await drawn($)
  expect(rows.filter(r => /architect +advice: Ship it after one more parser test\./.test(r))).toHaveLength(1)
  expect(rows.some(r => /architect +advice returned/.test(r))).toBe(true); expect(rows.some(r => r.includes('agent message'))).toBe(false)

  // A report that reaches the main loop only as the hand-back turn is the fallback.
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'second look'))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'A2', agentId: 'fab2', reason: 'answer' })
  await $.turn.start({ text: '<agent-message from="fab2">\nThe report follows:\n**Rename the flag** first', turnId: 'H3' })
  rows = await drawn($)
  expect(rows.some(r => /^│ » Rename the flag first +│$/.test(r))).toBe(true); expect(rows.some(r => r.includes('consults 2'))).toBe(true)
  // A hand-back from an agent that is not the architect is an engine line, and leaves the advice alone.
  await $.agent.spawn(spawn('general-purpose', 'write tests'))
  await $.tool.call({ tool: 'SubagentHandback', message: 'Tests written.', agentId: 'w1' } as never)
  await $.turn.start({ text: '<agent-message from="w1">\nThe report follows:\nTests written.', turnId: 'H4' })
  rows = await drawn($)
  expect(rows.some(r => /engine +agent message from w1/.test(r))).toBe(true); expect(rows.some(r => r.includes('» Rename the flag first'))).toBe(true)
})
test("an architect's answer at its end is its advice", async ($, on) => {
  const clock = engine(on)
  on('agent.spawn', () => ({ model: 'model-x', agentId: 'arc1' }))
  await clock.advance(1000)
  await $.agent.spawn(spawn('code-architect', 'design review'))
  await clock.advance(9000)
  await $.turn.complete({ answer: '\n> **Keep the store flat.**\nWhy: fewer writes.', durationMs: 9000, isAborted: false, turnId: 'A1', agentId: 'arc1', reason: 'answer' })
  const rows = await drawn($)
  expect(rows.some(r => /^│ » Keep the store flat\. +│$/.test(r))).toBe(true)
  expect(rows.some(r => /^│ last 0s ago · took 9s +│$/.test(r))).toBe(true)
  expect(rows.some(r => /architect +advice: Keep the store flat\./.test(r))).toBe(true)
})
test('with no architect anywhere, the panel and status field stay hidden', async ($, on) => {
  const { clock, statuses } = watched(on)
  on('agent.spawn', () => ({ model: 'model-x', agentId: 'g1' }))
  await clock.advance(1000)
  await $.turn.start({ text: 'write the tests', turnId: 'N1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await reply($, [{ type: 'server_tool_use', id: 'ws1', name: 'web_search', input: {} }])
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'N1', reason: 'answer' })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /ARCHITECT/ })).toBeUndefined(); expect(await ui.find({ text: /consults|on call|advising/ })).toBeUndefined()
    expect(await ui.find({ text: /1 running · 1 total/ })).toBeDefined()
    await ui.unmount()
  }
  await clock.advance(0)
  expect(statuses.at(-1)).toBe('agents 1/1'); expect(statuses.some(t => /architect/.test(t ?? ''))).toBe(false)
})
test('config renames the architect and turns the moments off', { options: { architectLabel: 'REVIEWER', moments: false } }, async ($, on) => {
  const { clock, statuses } = watched(on)
  on('agent.spawn', () => ({ model: 'model-x', agentId: 'r1' }))
  await clock.advance(1000)
  await $.turn.start({ text: 'review it', turnId: 'T3' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ REVIEWER $/ })).toBeDefined(); expect(await ui.find({ type: 'Text', text: / · REVIEWER ADVISING$/ })).toBeDefined()
  expect(await ui.find({ text: /ARCHITECT/ })).toBeUndefined()
  expect(await ui.find({ text: /\(inferred\)/ })).toBeUndefined(); expect(await ui.find({ text: /before a plan/ })).toBeUndefined()
  expect((await rowsOf(ui)).some(r => /reviewer +consulted · fable-advisor/.test(r))).toBe(true)
  await ui.unmount()
  expect(statuses.at(-1)).toBe('reviewer advising')
})
test('an architect type offered before /clear is still known after it', { options: { matchDescriptions: true } }, async ($, on) => {
  const clock = engine(on)
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.spawn', () => ({ model: 'model-x', agentId: 'rv1' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await clock.advance(1000)
  // Its name does not match the pattern; its description does, and the listing is not sent again after a clear.
  await $.agent.offer({ agent: 'design-reviewer', description: 'An architect who reviews plans', source: 'plugin', provider: { plugin: 'engine', tier: 'core' } })
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await $.agent.spawn(spawn('design-reviewer', 'review the plan'))
  const rows = await drawn($, 64)
  expect(rows.some(r => /^│ ● advising +│$/.test(r))).toBe(true); expect(rows.some(r => r.includes('AGENTS'))).toBe(false)
  expect(rows.some(r => /architect +before a plan · design-reviewer/.test(r))).toBe(true)
})
// ---------------------------------------------------------------- the ARCHITECT panel, recoloured

test('ARCHITECT keeps its rows in architect gold', () => {
  const tree = architectPanel(draw(), vmOf(busy(), 66, 'dock', NOW).architect!, 66)
  const rows = drawRows(tree).slice(1)
  expect(rows[0]).toBe('┌ ARCHITECT ───────────────────────────────────────── consults 1 ┐')
  const content = rows.slice(1, 6).map(r => r.slice(2, -2).trimEnd())
  expect(content[1]).toMatch(/^◆━+─+$/)
  expect([content[0], content[2], content[3], content[4]]).toEqual(['○ on call', 'last 1m ago · took 30s', '◆ before a plan  ◇ error repeats  ◇ before done  (inferred)', '» Lock the palette before the frames.'])
  expect(texts(tree).find(t => t.text === '◆ before a plan')).toMatchObject({ color: COLORS.architect, bold: true })
  expect(texts(tree).find(t => t.text === '○ on call')?.color).toBe(COLORS.dim)
  expect(found(tree, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.frame])
})
test('while the architect advises, its whole frame is green', () => {
  const s = busy(); const open = { ...s, architect: { ...s.architect, consults: [{ ...s.architect.consults[0]!, endAt: null }] } }
  const tree = architectPanel(draw(), vmOf(open, 66, 'dock', NOW).architect!, 66)
  expect(found(tree, 'Box').filter(b => b.borderStyle === 'single').map(b => b.borderColor)).toEqual([COLORS.green])
  expect(texts(tree).find(t => t.text === '● advising')).toMatchObject({ color: COLORS.architect, bold: true })
})
