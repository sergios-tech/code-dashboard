import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Activity } from '../types'
import { FILES_MAX, TOOLS_MAX, avgLabel, avgMs, fileOf, hotFiles, recordCall, timedMs, topTools, totalCalls } from '../hooks/domain/activity'
import { DEFAULT_ACTIVITY, normalizeActivity } from '../hooks/state/schema'
import { COLORS } from '../hooks/view/palette'
import { cellWidth, engine, pane, rowsOf, spawn } from './kit'

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

/** The pane's rows at a width, unmounted again. */
const drawn = async ($: Engine, cols = 64) => {
  const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.unmount()
  return rows
}

/** The rows inside the TOOLS & FILES frame, between its top and bottom borders. */
const toolsRows = (rows: string[]): string[] => {
  const top = rows.findIndex(r => r.includes('┌ TOOLS & FILES'))
  const bottom = rows.findIndex((r, i) => i > top && r.startsWith('└'))
  return top < 0 || bottom < 0 ? [] : rows.slice(top + 1, bottom)
}

const ok = { result: {}, text: 'ok' }
const failed = { isError: true as const, result: 'exit 1', text: 'exit 1' }

// ---------------------------------------------------------------- pure modules

test('file activity: reads and edits per trimmed, redacted path', () => {
  expect(fileOf('Read', { file_path: '/home/me/proj/src/main.ts' })).toEqual({ path: 'src/main.ts', kind: 'read' })
  expect(fileOf('NotebookEdit', { notebook_path: 'C:\\w\\nb\\a.ipynb' })).toEqual({ path: 'nb/a.ipynb', kind: 'edit' })
  expect(fileOf('Glob', { pattern: '**/*.ts' })).toBeNull(); expect(fileOf('Bash', { command: 'ls' })).toBeNull()
  expect(fileOf('Grep', { pattern: 'x', path: '/repo/lib/' })).toEqual({ path: 'repo/lib', kind: 'read' })
  expect(fileOf('Write', { file_path: 'notes.md' })).toEqual({ path: 'notes.md', kind: 'edit' })
  expect(fileOf('Edit', { file_path: '/srv/sk-abcdefghijklmnop/config.ts' })).toEqual({ path: '•••/config.ts', kind: 'edit' })
  expect(fileOf('Read', { file_path: 42 })).toBeNull(); expect(fileOf('Read', null)).toBeNull(); expect(fileOf('Edit', { file_path: '///' })).toBeNull()
})
test('untimed calls count but do not move the average', () => {
  let a = recordCall(DEFAULT_ACTIVITY, { tool: 'Bash', input: {}, hasFailed: false, inSubagent: false, ms: 400, at: 1 })
  a = recordCall(a, { tool: 'Bash', input: {}, hasFailed: true, inSubagent: false, ms: null, at: 2 })
  expect(topTools(a, 3)[0]).toEqual({ tool: 'Bash', calls: 2, errors: 1, timedCalls: 1, timedMs: 400 }); expect(avgMs(topTools(a, 1)[0]!)).toBe(400)
  // Timed only when the call ran, waited on no prompt and is not Agent's whole subagent run.
  expect(timedMs(true, false, 'Read', 250)).toBe(250); expect(timedMs(true, true, 'Bash', 250)).toBeNull()
  expect(timedMs(false, false, 'Bash', 250)).toBeNull(); expect(timedMs(true, false, 'Agent', 250)).toBeNull()
  expect([avgLabel(400), avgLabel(45), avgLabel(65_000), avgLabel(null)]).toEqual(['avg* 0.4s', 'avg* 45ms', 'avg* 1m05s', 'avg* —'])
  expect(avgMs({ tool: 'X', calls: 3, errors: 0, timedCalls: 0, timedMs: 0 })).toBeNull()
  // A refused or failed call counts, but touches no file.
  a = recordCall(a, { tool: 'Edit', input: { file_path: '/p/a.ts' }, hasFailed: false, inSubagent: false, ms: null, at: 3, didRun: false })
  a = recordCall(a, { tool: 'Read', input: { file_path: '/p/a.ts' }, hasFailed: true, inSubagent: false, ms: 5, at: 4 })
  expect([a.tools.length, a.files.length]).toEqual([3, 0])
})
test('activity stays bounded over a long session (Review Focus 5)', () => {
  let a = DEFAULT_ACTIVITY
  for (let i = 0; i < 5; i++) a = recordCall(a, { tool: 'Edit', input: { file_path: '/p/hot/main.ts' }, hasFailed: false, inSubagent: false, ms: 1, at: i })
  for (let i = 0; i < 500; i++) a = recordCall(a, { tool: `T${i % 60}`, input: { file_path: `/p/d${i % 300}/f.ts` }, hasFailed: false, inSubagent: i % 2 === 0, ms: 1, at: i })
  for (let i = 0; i < 500; i++) a = recordCall(a, { tool: 'Read', input: { file_path: `/p/d${i % 300}/f.ts` }, hasFailed: false, inSubagent: i % 2 === 0, ms: 1, at: 1000 + i })
  expect(a.tools.length <= 40).toBe(true); expect(a.files.length <= 200).toBe(true)
  expect([a.tools.length, a.files.length]).toEqual([TOOLS_MAX, FILES_MAX])
  // The busiest tool and the file touched most outlast the many touched once or twice.
  expect(topTools(a, 1)[0]).toEqual({ tool: 'Read', calls: 500, errors: 0, timedCalls: 500, timedMs: 500 })
  expect(hotFiles(a, 1)[0]).toEqual({ path: 'hot/main.ts', reads: 0, edits: 5, byMain: true, lastAt: 4 })

  // Full lists: the fewest calls go, the first of a tie; the least touched file, the oldest of a tie.
  const full: Activity = {
    tools: Array.from({ length: TOOLS_MAX }, (_, i) => ({ tool: `T${i}`, calls: i === 5 || i === 9 ? 1 : 2, errors: 0, timedCalls: 0, timedMs: 0 })),
    files: Array.from({ length: FILES_MAX }, (_, i) => ({ path: `d/f${i}.ts`, reads: i < 3 ? 1 : 2, edits: 0, byMain: true, lastAt: 100 - i })),
    calls: 78,
  }
  const next = recordCall(full, { tool: 'Read', input: { file_path: '/x/new.ts' }, hasFailed: false, inSubagent: true, ms: 1, at: 9999 })
  expect(next.tools.map(t => t.tool).filter(t => t === 'T5' || t === 'T9' || t === 'Read')).toEqual(['T9', 'Read'])
  expect(next.files.map(f => f.path).filter(p => /^d\/f[0-2]\.ts$|new/.test(p))).toEqual(['d/f0.ts', 'd/f1.ts', 'x/new.ts'])
  expect(next.files.at(-1)).toEqual({ path: 'x/new.ts', reads: 1, edits: 0, byMain: false, lastAt: 9999 })
  // Ranked: touches first, then the one touched last.
  expect(hotFiles(next, 3).map(f => f.path)).toEqual(['d/f3.ts', 'd/f4.ts', 'd/f5.ts'])
})

test('the call count is a running total that outlives evicted tool rows', async ($, on) => {
  let a = DEFAULT_ACTIVITY
  for (let i = 0; i < 60; i++) a = recordCall(a, { tool: `T${i}`, input: {}, hasFailed: false, inSubagent: false, ms: 1, at: i })
  expect([a.tools.length, a.tools.reduce((n, t) => n + t.calls, 0), totalCalls(a)]).toEqual([TOOLS_MAX, TOOLS_MAX, 60])
  // Read leniently: junk counts as nothing, and the total never reads below what the kept rows add up to.
  expect([normalizeActivity(a).calls, normalizeActivity({ ...a, calls: 'x' }).calls, normalizeActivity(null).calls]).toEqual([60, TOOLS_MAX, 0])
  expect(normalizeActivity({ tools: [{ tool: 'Bash', calls: 3 }], calls: 1 }).calls).toBe(3)

  engine(on)
  on('tool.call', () => ok)
  for (let i = 0; i < 45; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}` } as never)
  for (let i = 0; i < 45; i++) await $.tool.call({ tool: `mcp__srv__t${i}` } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ 90 calls $/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- the pane

test('hot files rank by touches; subagent-only files are dimmed', async ($, on) => {
  const clock = engine(on)
  on('tool.call', async () => {
    await clock.advance(400)
    return ok
  })
  await clock.advance(1000)
  // Hidden until the first call.
  expect((await drawn($)).some(r => r.includes('TOOLS & FILES'))).toBe(false)

  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: '/home/me/proj/src/auth/login.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/home/me/proj/src/auth/login.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'token', path: '/home/me/proj/lib/util', agentId: 'sub1' } as never)
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Read', file_path: '/home/me/proj/lib/util/a.ts', agentId: 'sub1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ TOOLS & FILES $/ })).toBeDefined(); expect(await ui.find({ type: 'Text', text: /^ 8 calls $/ })).toBeDefined()
  const body = toolsRows(await rowsOf(ui))
  // The top four tools, most calls first, a tie in the order first seen; every call ran in 0.4s.
  expect(body.slice(0, 4).map(r => r.replace(/ +/g, ' '))).toEqual([
    '│ Read 5 avg* 0.4s │',
    '│ Edit 1 avg* 0.4s │',
    '│ Grep 1 avg* 0.4s │',
    '│ Bash 1 avg* 0.4s │',
  ])
  expect(body[4]).toMatch(/^│ hot files +│$/)
  expect(body.slice(5).map(r => r.replace(/ +/g, ' '))).toEqual(['│ auth/login.ts 3 ✎1 │', '│ util/a.ts 2 │', '│ lib/util 1 │'])
  expect((await ui.find({ type: 'Text', text: /^auth\/login\.ts / }))?.props.dimColor).toBe(false)
  const subOnly = await ui.find({ type: 'Text', text: /^util\/a\.ts / })
  expect([subOnly?.props.dimColor, subOnly?.props.color]).toEqual([true, COLORS.dim])
  // Only the edit is logged; reads and the passing command stay on the panel.
  const logged = (await rowsOf(ui)).filter(r => /\d\d:\d\d:\d\d main/.test(r))
  expect(logged).toHaveLength(1); expect(logged[0]).toMatch(/main +Edit → auth\/login\.ts/)
  await ui.unmount()

  for (const cols of [40, 64, 100]) {
    const rows = await drawn($, cols)
    const inside = toolsRows(rows)
    expect(inside).toHaveLength(8)
    for (const r of inside) expect(/^│.*│$/.test(r)).toBe(true)
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
  }
})
test('a denied call writes one red log line and a status field', async ($, on) => {
  const { clock, statuses } = watched(on)
  // A rule refuses Bash at the check: the call then comes back as an error result, not a deny.
  on('tool.check', { tool: 'Bash' }, () => ({ decision: 'deny', reason: 'rule' }))
  // A hook beneath the plugin refuses Write outright.
  on('tool.call', (_$, e) => (e.tool === 'Write' ? { deny: 'policy' } : ok))
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(rows.filter(r => r.includes('denied'))).toHaveLength(1)
  expect(rows.some(r => /\d\d:\d\d:\d\d main +Bash → rm -rf build · denied/.test(r))).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Bash → rm -rf build · denied$/ }))?.props.color).toBe(COLORS.error)
  expect(rows.some(r => r.includes('✗'))).toBe(false) // a refusal is not a failure
  expect(statuses.at(-1)).toBe('denied 1')
  await ui.unmount()

  await $.tool.call({ tool: 'Write', file_path: '/p/src/new.ts', content: 'x' } as never)
  const after = await drawn($)
  expect(after.filter(r => / · denied/.test(r))).toHaveLength(2)
  expect(after.some(r => /main +Write → src\/new\.ts · denied/.test(r))).toBe(true)
  expect(statuses.at(-1)).toBe('denied 2')
  // Refused calls still count, are not timed, and touch no file.
  expect(toolsRows(after).map(r => r.replace(/ +/g, ' '))).toEqual(['│ Bash 1 avg* — │', '│ Write 1 avg* — │'])
})
test('a call that waited on an approval prompt is not timed', async ($, on) => {
  const clock = engine(on)
  on('tool.check', { tool: 'Bash' }, () => ({ decision: 'ask' }))
  // The prompt is answered yes, as a person would.
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' as const } }))
  on('tool.call', async () => {
    await clock.advance(300)
    return ok
  })
  await $.tool.call({ tool: 'Bash', command: 'npm publish' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/README.md' } as never)
  await $.tool.call({ tool: 'Agent', description: 'look around', prompt: 'look around', subagent_type: 'Explore' } as never)
  const rows = toolsRows(await drawn($)).map(r => r.replace(/ +/g, ' '))
  expect(rows.slice(0, 3)).toEqual(['│ Bash 1 avg* — │', '│ Read 1 avg* 0.3s │', '│ Agent 1 avg* — │'])
})
test("a subagent's calls fill its card's last three tools; a hand-back is no tool work", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }))
  on('tool.call', (_$, e) => (e.tool === 'Bash' ? failed : ok))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.tool.call({ tool: 'Read', file_path: '/p/src/parser.ts', agentId: 'ag1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'ag1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/p/tests/parser.test.ts', content: 'x', agentId: 'ag1' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'parse(', agentId: 'ag1' } as never)
  await $.tool.call({ tool: 'SubagentHandback', message: 'Tests written.', agentId: 'ag1' } as never)

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ type: 'Text', text: /^· Read → src\/parser\.ts$/ })).toBeUndefined() // the oldest of four has gone
  expect((await ui.find({ type: 'Text', text: /^✗ Bash → npm test$/ }))?.props.color).toBe(COLORS.error)
  expect(await ui.find({ type: 'Text', text: /^· Write → tests\/parser\.test\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^· Grep → parse\($/ })).toBeDefined()
  const rows = await rowsOf(ui)
  // The hand-back is not counted, and a subagent's failure is its own.
  expect(await ui.find({ type: 'Text', text: /^ 4 calls $/ })).toBeDefined(); expect(rows.some(r => r.includes('SubagentHandback'))).toBe(false)
  expect(rows.some(r => /Write the… +Bash → npm test ✗/.test(r))).toBe(true); expect(rows.some(r => /Write the… +Write → tests\/parser\.test\.ts/.test(r))).toBe(true)
  await ui.unmount()
})
