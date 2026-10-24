import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { LogLine } from '../types'
import { parseConfig } from '../hooks/config'
import { LOG_MAX, appendLog, logRows, promptLine } from '../hooks/domain/log'
import { statusText } from '../hooks/domain/status'
import { DEFAULT_ARCHITECT, DEFAULT_USAGE, normalizeCard } from '../hooks/state/schema'
import type { LogView } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'
import { logPanel } from '../hooks/view/panels/log'
import { busy, NOW } from './fixture'
import { cellWidth, draw, drawRows, engine, pane, rowsOf, spawn, texts } from './kit'

// The test kit's `$` takes the engine's full command input; only the name and arguments matter here.
const slash = ($: { command: { run: (i: never) => Promise<{ text?: string }> } }, args: string) => $.command.run({ command: 'st-code', args } as never)

/** The pane's rows at a width and a body height, unmounted again. */
const rowsAt = async ($: Engine, cols: number, bodyRows: number) => {
  const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.unmount()
  return rows
}

const ok = { result: {}, text: 'ok' }
const failed = { isError: true as const, result: 'exit 1', text: 'exit 1' }

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
  for (let i = 0; i < 1000; i++) l = appendLog(l, { at: i, who: 'you', text: String(i), agentId: null, kind: 'info', mark: null })
  expect(l).toHaveLength(60); expect(l[59]?.text).toBe('999')
  expect(l[0]?.text).toBe('940'); expect(LOG_MAX).toBe(60)
})
test('the log gets what the other panels leave, at most 8 rows, and none below 2', () => {
  expect(logRows(70, 10)).toBe(8); expect(logRows(20, 10)).toBe(7); expect(logRows(15, 10)).toBe(2)
  expect(logRows(14, 10)).toBe(0); expect(logRows(3, 10)).toBe(0)
  // A pane of unknown height is taken to have 40 rows, and its log keeps between 4 and 8.
  expect(logRows(undefined, 10)).toBe(8); expect(logRows(undefined, 33)).toBe(4); expect(logRows(Number.NaN, 60)).toBe(4)
})
test('the status line says only what it has', () => {
  expect(statusText({ usage: DEFAULT_USAGE, agents: [], architect: DEFAULT_ARCHITECT, denials: { count: 0 } }, parseConfig({}))).toBeUndefined()
  expect(statusText({ usage: { ...DEFAULT_USAGE, pct: 51.2 }, agents: [], architect: DEFAULT_ARCHITECT, denials: { count: 1 } }, parseConfig({}))).toBe('ctx 51% · denied 1')
})
test('the status line counts compactions after ctx', () => {
  expect(status({ usage: { ...DEFAULT_USAGE, pct: 11, compactions: 1 }, denials: { count: 1 } })).toBe('ctx 11% ↺1 · denied 1')
  expect(status({ usage: { ...DEFAULT_USAGE, pct: 11 } })).toBe('ctx 11%')
})
test('the status line counts running agents and names the architect by its label', () => {
  const agents = [normalizeCard({ id: 'a', status: 'running' }), normalizeCard({ id: 'b', status: 'done' }), normalizeCard({ id: 'c', status: 'running' })]
  const consult = { id: 'c1', at: 1, endAt: null, moment: 'before a plan' as const, via: 'advisor' }
  const open = { ...DEFAULT_ARCHITECT, consults: [consult] }
  expect(status({ usage: { ...DEFAULT_USAGE, pct: 51.2 }, agents, architect: open, denials: { count: 1 } })).toBe('ctx 51% · agents 2/3 · architect advising · denied 1')
  expect(status({ architect: { ...open, consults: [{ ...consult, endAt: 4 }, { ...consult, id: 'c2', endAt: 9 }] } })).toBe('architect 2')
  expect(status({ architect: { ...DEFAULT_ARCHITECT, ids: ['x'] } }, { architectLabel: 'Advisor' })).toBe('advisor 0')
})

const logOf = (lines: LogLine[], mainModel = 'Opus 5.5'): LogView => ({ lines, isViewingAgent: false, mainModel })
test('LOG names the main loop by its model, colours only the marks', () => {
  const tree = logPanel(draw({ now: NOW }), logOf(busy().log), 66)
  const rows = drawRows(tree).slice(1)
  expect(rows[5]).toMatch(/^│ \d\d:\d\d:\d\d opus {7}Bash rm -rf build · denied {17}│$/)
  const by = (t: string) => texts(tree).find(x => x.text.trim() === t)
  expect(by('opus')).toMatchObject({ color: COLORS.brand, bold: true }); expect(by('Explore 1')?.color).toBe(COLORS.orange)
  expect(by('architect')?.color).toBe(COLORS.architect); expect(by('· denied')).toMatchObject({ color: COLORS.gold, bold: true })
  expect(by('✗')).toMatchObject({ color: COLORS.error, bold: true }); expect(by('hit max_tokens')?.color).toBe(COLORS.text)
  expect(by('you')?.color).toBe(COLORS.text)
})
test('an unknown main model reads main in dim; a wide or long line keeps its mark and its columns (Review Focus 4)', () => {
  const long = [{ at: NOW, who: 'main', text: '日本語'.repeat(40), agentId: null, kind: 'error' as const, mark: '✗' as const }]
  for (const w of [40, 66]) {
    const r = drawRows(logPanel(draw(), logOf(long), w)).slice(1)[1] ?? ''
    expect(cellWidth(r) <= w).toBe(true); expect(r.includes('✗')).toBe(true)
  }
  expect(texts(logPanel(draw(), logOf(long, ''), 66)).find(x => x.text.trim() === 'main')?.color).toBe(COLORS.dim)
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
    expect(rows[at + 1]).toMatch(/^│ \d\d:\d\d:\d\d you {8}first second/)
    expect(rows[at + 2]).toMatch(/^│ \d\d:\d\d:\d\d engine {5}task notif/)
    if (cols >= 64) expect(rows[at + 2]).toContain('task notification from abcdef12')
    expect(rows[at + 3]?.startsWith('└')).toBe(true)
    for (const r of rows) expect(cellWidth(r) <= Math.max(40, cols)).toBe(true)
    await ui.unmount()
  }
})
test('a short pane shrinks the LOG to the rows left and drops it below 2, never past its bottom edge', async ($, on) => {
  const clock = engine(on)
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `bg${++k}` }))
  on('tool.call', (_$, e) => (e.tool === 'Bash' ? failed : ok))
  await clock.advance(1000)
  // A busy session: a running turn, three background agents and a failed call.
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  for (const d of ['fix the parser', 'add docstrings', 'review the cli']) await $.agent.spawn(spawn('general-purpose', d))
  await $.tool.call({ tool: 'Read', file_path: '/p/src/a.ts' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  for (const cols of [64, 120]) {
    // In a tall pane the rows above the LOG's gap are what the header and the other panels take.
    const used = (await rowsAt($, cols, 70)).findIndex(r => r.startsWith('┌ LOG')) - 1
    expect(used > 10).toBe(true)
    for (const [bodyRows, lines] of [
      [used + 4, 0],
      [used + 5, 2],
      [used + 6, 3],
    ] as const) {
      const rows = await rowsAt($, cols, bodyRows)
      expect(rows.length <= bodyRows).toBe(true)
      const top = rows.findIndex(r => r.startsWith('┌ LOG'))
      if (lines === 0) {
        expect(top).toBe(-1); expect(rows.length).toBe(used)
      } else {
        expect(rows.length - top - 2).toBe(lines); expect(rows.at(-1)?.startsWith('└')).toBe(true)
      }
    }
  }
})
test('a cut log line keeps its ✗ or · denied, so a failure is never shown by colour alone', async ($, on) => {
  engine(on)
  const loop = 'for f in tally/__init__.py tally/cli.py tally/parser.py tally/utils.py; do python3 -m py_compile "$f"; done'
  const wipe = 'rm -rf build dist .cache node_modules coverage tmp/output-of-the-last-very-long-run'
  on('tool.call', (_$, e) => (e.tool !== 'Bash' ? ok : (e as { command?: string }).command === wipe ? { deny: 'policy' } : failed))
  await $.tool.call({ tool: 'Bash', command: loop } as never)
  await $.tool.call({ tool: 'Bash', command: wipe } as never)
  for (const cols of [40, 64]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    // The command is cut (at 40 columns down to `Bash…`), the marker after it is whole, and the row still closes on the frame.
    expect(rows.some(r => /main +Bash.*… ✗ *│$/.test(r))).toBe(true)
    expect(rows.some(r => /main +Bash.*… · denied *│$/.test(r))).toBe(true)
    // The cut text stays in `text`; only the mark after it is coloured.
    expect((await ui.find({ type: 'Text', text: /^Bash.*…$/ }))?.props.color).toBe(COLORS.text)
    expect(await ui.find({ type: 'Text', text: /^ ✗$/ })).toMatchObject({ props: { color: COLORS.error, bold: true } })
    expect(await ui.find({ type: 'Text', text: /^ · denied$/ })).toMatchObject({ props: { color: COLORS.gold, bold: true } })
    if (cols >= 64) expect(rows.some(r => /Bash → for f in tally\/.*… ✗ *│$/.test(r))).toBe(true)
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
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
