import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { LogLine } from '../types'
import { fitCells, newCard } from '../hooks/domain/agents'
import { LINE_MAX, LOG_MAX, appendLog, logRows, promptLine, sessionStart } from '../hooks/domain/log'
import { loadSnapshot } from '../hooks/register'
import type { LogView } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'
import { logPanel } from '../hooks/view/panels/log'
import { busy, fake, NOW } from './fixture'
import { cellWidth, draw, drawRows, engine, pane, rowsOf, spawn, texts } from './kit'

// The test kit's `$` takes the engine's full command input; only the name and arguments matter here.
const slash = ($: { command: { run: (i: never) => Promise<{ text?: string }> } }, args: string) => $.command.run({ command: 'st-code-display', args } as never)

/** The pane's rows at a width and a body height, unmounted again. */
const rowsAt = async ($: Engine, cols: number, bodyRows: number) => {
  const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.unmount()
  return rows
}

const ok = { result: {}, text: 'ok' }
const failed = { isError: true as const, result: 'exit 1', text: 'exit 1' }

// ---------------------------------------------------------------- pure modules

test('prompts and engine-opened turns read as one log line', () => {
  expect(promptLine('fix the login redirect')).toEqual({ who: 'you', text: 'fix the login redirect' })
  expect(promptLine('<task-notification from="abcdef123456">…').who).toBe('engine')
  expect(promptLine('<task-notification from="abcdef123456">…').text).toBe('task notification from abcdef12')
  expect(promptLine('<agent-message>').text).toBe('agent message')
  // A message from an agent with a card is logged under that agent, by its title, not by its id.
  const card = newCard({ id: 'a288e0e2ab3d5c279', type: 'Explore', model: '', description: 'Survey st-code-display view panels', at: 1 })
  const cardOf = (id: string) => (id === card.id ? card : undefined)
  expect(promptLine('<agent-message from="a288e0e2ab3d5c279">\nreport', cardOf)).toEqual({ who: 'Survey st-…', text: 'agent message', agentId: 'a288e0e2ab3d5c279' })
  expect(promptLine('<agent-message from="zz9">\nreport', cardOf)).toEqual({ who: 'engine', text: 'agent message from zz9' })
  // A paste reads as a marker with its line count, after the person's own words, and a prompt that is only a paste is still theirs.
  const paste = (id: string, body: string) => `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`
  expect(promptLine(`Now \n\n${paste('4f7d', '┌ INFO ─┐\n│ ctx │\n└──────┘')}\n`)).toEqual({ who: 'you', text: 'Now [pasted 3 lines]' })
  expect(promptLine(`compare ${paste('a1', 'one')} with ${paste('b2', 'x\ny')} please`).text).toBe('compare [pasted 1 line] with [pasted 2 lines] please')
  expect(promptLine(paste('c3', `password=${fake()}\nmore`))).toEqual({ who: 'you', text: '[pasted 2 lines]' })
  // A wrapper escaped inside a paste (`<\pasted_content`) does not end it early.
  expect(promptLine(`see ${paste('d4', 'a <\\pasted_content id="zz"> b\nc')}`).text).toBe('see [pasted 2 lines]')
  // The whole prompt is kept up to LINE_MAX characters; the pane cuts it to its own width.
  expect(promptLine('a'.repeat(300)).text).toBe('a'.repeat(300)); expect(LINE_MAX).toBe(400)
  expect([Array.from(promptLine('a'.repeat(500)).text).length, promptLine('a'.repeat(500)).text.endsWith('…')]).toEqual([400, true])
  expect(promptLine('line one\nline two\twith a tab').text).toBe('line one line two with a tab')
  expect(promptLine(`use password=${fake()} now`).text).toBe('use password=••• now')
})
test('the log keeps the last 60 lines (Review Focus 5)', () => {
  let l: LogLine[] = []
  for (let i = 0; i < 1000; i++) l = appendLog(l, { at: i, who: 'you', text: String(i), agentId: null, kind: 'info', mark: null })
  expect(l).toHaveLength(60); expect(l[59]?.text).toBe('999')
  expect(l[0]?.text).toBe('940'); expect(LOG_MAX).toBe(60)
})
test('docked, the log gets every row the other panels leave, none below 2; inline, at most 8', () => {
  expect(logRows(70, 10, true)).toBe(57); expect(logRows(20, 10, true)).toBe(7); expect(logRows(15, 10, true)).toBe(2)
  expect(logRows(14, 10, true)).toBe(0); expect(logRows(3, 10, true)).toBe(0)
  // Inline, bodyRows may be the whole terminal: the log keeps today's cap of 8.
  expect(logRows(70, 10, false)).toBe(8); expect(logRows(20, 10, false)).toBe(7); expect(logRows(15, 10, false)).toBe(2)
  expect(logRows(14, 10, false)).toBe(0); expect(logRows(3, 10, false)).toBe(0)
  // A pane of unknown height is taken to have 40 rows, and its log keeps between 4 and 8, docked or not.
  for (const isDocked of [true, false]) {
    expect(logRows(undefined, 10, isDocked)).toBe(8); expect(logRows(undefined, 33, isDocked)).toBe(4); expect(logRows(Number.NaN, 60, isDocked)).toBe(4)
  }
})

const logOf = (lines: LogLine[], mainModel = 'Opus 5.5', startedAt: number | null = NOW - 180_000): LogView => ({ lines, isViewingAgent: false, mainModel, rows: Math.max(1, lines.length), startedAt })
const lineAt = (at: number): LogLine => ({ at, who: 'you', text: 'hi', agentId: null, kind: 'info', mark: null })
test('the session starts at its stored start, else at the earliest line, else is unknown', () => {
  expect(sessionStart({ startedAt: 500 }, [lineAt(900)])).toBe(500); expect(sessionStart({ startedAt: 0 }, [lineAt(900)])).toBe(0)
  // A state stored before the start was kept: the earliest line stands in, a line at 0 having no time.
  expect(sessionStart({ startedAt: null }, [lineAt(0), lineAt(900), lineAt(700)])).toBe(700)
  expect(sessionStart({ startedAt: null }, [lineAt(0)])).toBeNull(); expect(sessionStart({ startedAt: null }, [])).toBeNull()
})
test('LOG times count from the session start, right-aligned to the widest shown, and read --:-- when unknown', () => {
  // The time column of each row: the cells between the frame's border and the actor.
  const timesOf = (lines: LogLine[], startedAt: number | null) =>
    drawRows(logPanel(draw(), logOf(lines, '', startedAt), 40))
      .slice(2, -1)
      .map(r => /^│ (.*?) you /.exec(r)?.[1])
  // Under an hour the times are `m:ss`; one past an hour widens the column, and the others line up on its right.
  expect(timesOf([lineAt(1_042_000), lineAt(1_724_000)], 1_000_000)).toEqual([' 0:42', '12:04'])
  expect(timesOf([lineAt(1_042_000), lineAt(4_724_000)], 1_000_000)).toEqual(['   0:42', '1:02:04'])
  // A line at 0, or no start at all, has no time to show.
  expect(timesOf([lineAt(0), lineAt(1_042_000)], 1_000_000)).toEqual(['--:--', ' 0:42'])
  expect(timesOf([lineAt(1_042_000)], null)).toEqual(['--:--'])
})
test('LOG names the main loop by its model, colours only the marks', () => {
  const tree = logPanel(draw({ now: NOW }), logOf(busy().log), 66)
  const rows = drawRows(tree).slice(1)
  expect(rows[5]).toMatch(/^│ 1:38 opus {7}Bash rm -rf build · denied {21}│$/)
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
test('a line runs as far as the pane is wide and is cut only there', async ($, on) => {
  const clock = engine(on)
  on('tool.call', () => failed)
  await clock.advance(45_296_000)
  const prompt = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
  const command = `npm run build -- ${Array.from({ length: 30 }, (_, i) => `--flag${i}`).join(' ')}`
  await $.turn.start({ text: prompt, turnId: 'T1' })
  await $.tool.call({ tool: 'Bash', command } as never)
  for (const cols of [64, 120, 280]) {
    const rows = await rowsAt($, cols, 40)
    // The cells the frame, the time (`0:00`, and a space) and the actor leave the text; a failed call keeps ` ✗` after it.
    const room = cols - 4 - 5 - 11
    const textOf = (re: RegExp) => (rows.find(r => re.test(r)) ?? '').slice(2 + 5 + 11, -2).trimEnd()
    expect(textOf(/^│ 0:00 you /)).toBe(fitCells(prompt, room))
    expect(textOf(/^│ 0:00 main /)).toBe(`${fitCells(`Bash → ${command}`, room - 2)} ✗`)
  }
})
test('log rows are timed from the session start, labelled by source, one row each and within the width', async ($, on) => {
  const clock = engine(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await clock.advance(1_000)
  await $.session.start({ sessionId: 's', cwd: '/p' } as never)
  await clock.advance(45_296_000)
  await $.turn.start({ text: 'first\nsecond line with 🚀 and a tab\t' + 'w'.repeat(300), turnId: 'T1' })
  await $.turn.start({ text: '<task-notification from="abcdef123456">x', turnId: 'T2' })
  for (const cols of [28, 40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    const at = rows.findIndex(r => r.includes('┌ LOG'))
    expect(at > 0).toBe(true)
    expect(rows[at - 1]?.trim()).toBe('')
    // The frame is intact and holds the two entries, one row each, then blank rows down to the bottom border.
    expect(rows[at + 1]).toMatch(/^│ 12:34:56 you {8}first second/)
    expect(rows[at + 2]).toMatch(/^│ 12:34:56 engine {5}task notif/)
    if (cols >= 64) expect(rows[at + 2]).toContain('task notification from abcdef12')
    expect(rows[at + 3]).toMatch(/^│ *│$/)
    expect(rows.at(-1)?.startsWith('└')).toBe(true)
    for (const r of rows) expect(cellWidth(r) <= Math.max(40, cols)).toBe(true)
    await ui.unmount()
  }
})
test('the first session.start stores the session\'s start; a reload keeps it', async ($, on) => {
  const clock = engine(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await clock.advance(7_000)
  await $.session.start({ sessionId: 's', cwd: '/p' } as never)
  await clock.advance(5_000)
  await $.session.start({ sessionId: 's', cwd: '/p' } as never)
  await clock.advance(8_000)
  await $.turn.start({ text: 'after the reload', turnId: 'T1' })
  // 20s on the clock, 13s after the first start; had the reload moved it, the line would read 0:08.
  expect((await rowsAt($, 64, 40)).some(r => /^│ 0:13 you +after the reload/.test(r))).toBe(true)
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
  await $.turn.start({ text: `deploy with token=${fake()}`, turnId: 'T1' })
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: new RegExp(fake()) })).toBeUndefined()
  expect(await ui.find({ text: /token=•••/ })).toBeDefined()
  await ui.unmount()
})
test('1,000 prompts leave a pane that draws the newest lines, up to the 60 the store keeps (Review Focus 5)', async ($, on) => {
  engine(on)
  for (let i = 0; i < 1000; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `L${i}` })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(rows.filter(r => /prompt \d+/.test(r))).toHaveLength(60)
  expect(await ui.find({ text: /prompt 999/ })).toBeDefined()
  expect(await ui.find({ text: /prompt 940/ })).toBeDefined()
  expect(await ui.find({ text: /prompt 939/ })).toBeUndefined()
  await ui.unmount()
})
test('docked, the LOG fills the pane: a 60-row pane puts its bottom border on the last body row, padded below 3 lines', async ($, on) => {
  engine(on)
  for (const t of ['one', 'two', 'three']) await $.turn.start({ text: `prompt ${t}`, turnId: t })
  for (const cols of [40, 64, 120]) {
    const rows = await rowsAt($, cols, 60)
    const top = rows.findIndex(r => r.startsWith('┌ LOG'))
    // The header, the panels, the gap and the LOG add up to the body rows, no more.
    expect(rows).toHaveLength(60); expect(rows.at(-1)?.startsWith('└')).toBe(true)
    expect(rows.slice(top + 1, top + 4).map(r => /prompt (one|two|three)/.exec(r)?.[1])).toEqual(['one', 'two', 'three'])
    // The blank rows keep the side borders running down.
    for (const r of rows.slice(top + 4, -1)) expect(r).toMatch(/^│ *│$/)
    expect(rows.length - top - 2).toBe(60 - top - 2)
    expect(cellWidth(rows.at(-1) ?? '') <= Math.max(40, cols)).toBe(true)
  }
  // An agent's transcript view pads the same way, its empty state too.
  const ui = await $.ui.mount({ ...pane(64), props: { ...pane(64).props, scroll: { offset: 0, bodyRows: 60 }, view: { agentId: 'nobody' } }, surface: 'terminal' })
  const viewed = await rowsOf(ui)
  await ui.unmount()
  expect(viewed.some(r => r.includes('LOG · THIS AGENT'))).toBe(true); expect(viewed.some(r => r.includes('nothing yet'))).toBe(true); expect(viewed).toHaveLength(60); expect(viewed.at(-1)?.startsWith('└')).toBe(true)
})
test('docked with more lines than room, the LOG shows the newest that fit, oldest at the top', async ($, on) => {
  engine(on)
  for (let i = 0; i < 40; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `L${i}` })
  const rows = await rowsAt($, 64, 20)
  const top = rows.findIndex(r => r.startsWith('┌ LOG'))
  const body = rows.slice(top + 1, -1)
  expect(rows).toHaveLength(20); expect(rows.at(-1)?.startsWith('└')).toBe(true)
  expect(body.length > 8).toBe(true)
  expect(body.map(r => Number(/prompt (\d+)/.exec(r)?.[1]))).toEqual(body.map((_, i) => 40 - body.length + i))
})
test('an inline pane that is not the mini summary keeps the 8-line cap and no padding, however tall its body', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await slash($, 'layout compact')
  await $.turn.start({ text: 'only line', turnId: 'T1' })
  const few = await $.ui.mount({ ...pane(64, 'inline'), surface: 'terminal' })
  const fewRows = await rowsOf(few)
  await few.unmount()
  const top = fewRows.findIndex(r => r.startsWith('┌ LOG'))
  expect(top > 0).toBe(true); expect(fewRows.length - top).toBe(3); expect(fewRows.at(-1)?.startsWith('└')).toBe(true)
  for (let i = 0; i < 30; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `L${i}` })
  const many = await $.ui.mount({ ...pane(64, 'inline'), surface: 'terminal' })
  const manyRows = await rowsOf(many)
  await many.unmount()
  expect(manyRows.filter(r => /prompt \d+/.test(r))).toHaveLength(8)
  expect(manyRows.at(-1)?.startsWith('└')).toBe(true); expect(manyRows.length < 40).toBe(true)
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
  expect(await ui.find({ text: /SERGIO'S TECH · CODE DISPLAY/ })).toBeDefined()
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

test('/st-code-display answers usage for an unknown verb', async ($, on) => {
  engine(on)
  const r = await slash($, 'bogus')
  expect(r.text?.startsWith('Usage: /st-code-display')).toBe(true)
  expect(r.text).toBe('Usage: /st-code-display [open|close|reset|layout auto|compact|wide|mini]')
  expect((await slash($, 'layout huge')).text).toBe(r.text)
  expect((await slash($, 'layout')).text).toBe(r.text)
})
test('/st-code-display opens, closes, resets and sets the layout', async ($, on) => {
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
test('/st-code-display says why the dashboard is not shown', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no room' } }) as never)
  const r = await slash($, '')
  expect(r.text).toBe('The dashboard is not shown yet: no room')
})
