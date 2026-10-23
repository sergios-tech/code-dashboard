import { expect, test } from 'claude-code/testing'

import type { LogLine } from '../types'
import { parseConfig } from '../hooks/config'
import { LOG_MAX, appendLog, logRows, promptLine } from '../hooks/domain/log'
import { statusText } from '../hooks/domain/status'
import { DEFAULT_ARCHITECT, DEFAULT_USAGE, normalizeCard } from '../hooks/state/schema'
import { cellWidth, engine, pane, rowsOf } from './kit'

// The test kit's `$` takes the engine's full command input; only the name and arguments matter here.
const slash = ($: { command: { run: (i: never) => Promise<{ text?: string }> } }, args: string) => $.command.run({ command: 'st-code', args } as never)

const status = (s: Partial<Parameters<typeof statusText>[0]>, o: Record<string, unknown> = {}) =>
  statusText({ usage: DEFAULT_USAGE, agents: [], architect: DEFAULT_ARCHITECT, denials: { count: 0 }, ...s }, parseConfig(o))

// ---------------------------------------------------------------- pure modules

test('prompts and engine-opened turns read as one log line', () => {
  expect(promptLine('fix the login redirect')).toEqual({ who: 'you', text: 'fix the login redirect' })
  expect(promptLine('<task-notification from="abcdef123456">…').who).toBe('engine')
  expect(promptLine('<task-notification from="abcdef123456">…').text).toBe('task notification from abcdef12')
  expect(promptLine('<agent-message>').text).toBe('agent message')
  expect(promptLine('a'.repeat(300)).text).toHaveLength(70)
  expect(promptLine('line one\nline two\twith a tab').text).toBe('line one line two with a tab')
  expect(promptLine('use password=hunter2hunter2 now').text).toBe('use password=••• now')
})
test('the log keeps the last 60 lines (Review Focus 5)', () => {
  let l: LogLine[] = []
  for (let i = 0; i < 1000; i++) l = appendLog(l, { at: i, who: 'you', text: String(i), agentId: null, kind: 'info' })
  expect(l).toHaveLength(60); expect(l[59]?.text).toBe('999')
  expect(l[0]?.text).toBe('940'); expect(LOG_MAX).toBe(60)
})
test('the log gets what the other panels leave, between 4 and 8 rows', () => {
  expect(logRows(70, 10)).toBe(8); expect(logRows(20, 10)).toBe(7); expect(logRows(14, 10)).toBe(4)
  expect(logRows(3, 10)).toBe(4); expect(logRows(Number.NaN, 0)).toBe(4)
})
test('the status line says only what it has', () => {
  expect(statusText({ usage: DEFAULT_USAGE, agents: [], architect: DEFAULT_ARCHITECT, denials: { count: 0 } }, parseConfig({}))).toBeUndefined()
  expect(statusText({ usage: { ...DEFAULT_USAGE, pct: 51.2 }, agents: [], architect: DEFAULT_ARCHITECT, denials: { count: 1 } }, parseConfig({}))).toBe('ctx 51% · denied 1')
})
test('the status line counts running agents and names the architect by its label', () => {
  const agents = [normalizeCard({ id: 'a', status: 'running' }), normalizeCard({ id: 'b', status: 'done' }), normalizeCard({ id: 'c', status: 'running' })]
  const consult = { id: 'c1', at: 1, endAt: null, moment: 'before a plan' as const, via: 'advisor' }
  const open = { ...DEFAULT_ARCHITECT, consults: [consult] }
  expect(status({ usage: { ...DEFAULT_USAGE, pct: 51.2 }, agents, architect: open, denials: { count: 1 } })).toBe('ctx 51% · agents 2/3 · architect advising · denied 1')
  expect(status({ architect: { ...open, consults: [{ ...consult, endAt: 4 }, { ...consult, id: 'c2', endAt: 9 }] } })).toBe('architect 2')
  expect(status({ architect: { ...DEFAULT_ARCHITECT, ids: ['x'] } }, { architectLabel: 'Advisor' })).toBe('advisor 0')
})

// ---------------------------------------------------------------- the mounted pane

test('a fresh session shows the header and an empty LOG; a prompt lands in it', async ($, on) => {
  engine(on)
  const fresh = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await fresh.find({ text: /LOG/ })).toBeDefined()
  expect(await fresh.find({ text: /nothing yet/ })).toBeDefined()
  await fresh.unmount()
  await $.turn.start({ text: 'fix the login redirect', turnId: 'T1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /LOG/ })).toBeDefined()
  expect(await ui.find({ text: /fix the login redirect/ })).toBeDefined()
  expect(await ui.find({ text: /nothing yet/ })).toBeUndefined()
  await ui.unmount()
})
test('log rows are timed, labelled by source, one row each and within the width', async ($, on) => {
  const clock = engine(on)
  // The mocked clock starts at 0, which has no time of day to show.
  await clock.advance(45_296_000)
  await $.turn.start({ text: 'first\nsecond line with 🚀 and a tab\t' + 'w'.repeat(300), turnId: 'T1' })
  await $.turn.start({ text: '<task-notification from="abcdef123456">x', turnId: 'T2' })
  for (const cols of [28, 40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    const at = rows.findIndex(r => r.includes('┌ LOG'))
    expect(at > 0).toBe(true)
    expect(rows[at - 1]?.trim()).toBe('')
    // The frame is intact and holds the two entries, one row each.
    expect(rows[at + 1]).toMatch(/^│ \d\d:\d\d:\d\d you {9}first second/)
    expect(rows[at + 2]).toMatch(/^│ \d\d:\d\d:\d\d engine {6}task notif/)
    if (cols >= 64) expect(rows[at + 2]).toContain('task notification from abcdef12')
    expect(rows[at + 3]?.startsWith('└')).toBe(true)
    for (const r of rows) expect(cellWidth(r) <= Math.max(40, cols)).toBe(true)
    await ui.unmount()
  }
})
test('a credential in a prompt is masked before it is stored', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'deploy with token=abcd1234efgh5678', turnId: 'T1' })
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: /abcd1234/ })).toBeUndefined()
  expect(await ui.find({ text: /token=•••/ })).toBeDefined()
  await ui.unmount()
})
test('1,000 prompts leave a pane that draws the newest lines and no more than 8 (Review Focus 5)', async ($, on) => {
  engine(on)
  for (let i = 0; i < 1000; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `L${i}` })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(rows.filter(r => /prompt \d+/.test(r))).toHaveLength(8)
  expect(await ui.find({ text: /prompt 999/ })).toBeDefined()
  expect(await ui.find({ text: /prompt 991/ })).toBeUndefined()
  await ui.unmount()
})
test('only the viewed agent\'s lines show, under a THIS AGENT label', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'main prompt', turnId: 'T1' })
  const ui = await $.ui.mount({ ...pane(64), props: { ...pane(64).props, view: { agentId: 'nobody' } }, surface: 'terminal' })
  expect(await ui.find({ text: /LOG · THIS AGENT/ })).toBeDefined()
  expect(await ui.find({ text: /main prompt/ })).toBeUndefined()
  expect(await ui.find({ text: /nothing yet/ })).toBeDefined()
  await ui.unmount()
})
test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.turn.start({ text: 'fix the login redirect', turnId: 'T1' })
  const before = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await before.find({ text: /fix the login redirect/ })).toBeDefined()
  await before.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /fix the login redirect/ })).toBeUndefined()
  expect(await ui.find({ text: /nothing yet/ })).toBeDefined()
  expect(await ui.find({ text: /SERGIO'S TECH · CODE/ })).toBeDefined()
  await ui.unmount()
})
test('another way out of a session leaves the log alone', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  await $.turn.start({ text: 'keep this line', turnId: 'T1' })
  await $.session.end({ reason: 'other', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /keep this line/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- the command

test('/st-code answers usage for an unknown verb', async ($, on) => {
  engine(on)
  const r = await slash($, 'bogus')
  expect(r.text?.startsWith('Usage: /st-code')).toBe(true)
  expect(r.text).toBe('Usage: /st-code [open|close|reset|layout auto|compact|wide|mini]')
  expect((await slash($, 'layout huge')).text).toBe(r.text)
  expect((await slash($, 'layout')).text).toBe(r.text)
})
test('/st-code opens, closes, resets and sets the layout', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  const run = async (args: string) => (await slash($, args)).text
  expect(await run('')).toBe('Dashboard opened. Focus it with ctrl+x tab; 1-6 expand agents.')
  expect(await run('open')).toBe('Dashboard opened. Focus it with ctrl+x tab; 1-6 expand agents.')
  expect(await run('close')).toBe('Dashboard closed.')
  await $.turn.start({ text: 'about to be reset', turnId: 'T1' })
  expect(await run('reset')).toBe('Dashboard reset.')
  const ui = await $.ui.mount({ ...pane(120), surface: 'terminal' })
  expect(await ui.find({ text: /about to be reset/ })).toBeUndefined()
  await ui.unmount()
  expect(await run('layout mini')).toBe('Dashboard layout: mini.')
})
test('/st-code says why the dashboard is not shown', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no room' } }) as never)
  const r = await slash($, '')
  expect(r.text).toBe('The dashboard is not shown yet: no room')
})
