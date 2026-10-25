import { expect, test } from 'claude-code/testing'

import type { Snapshot } from '../hooks/state/schema'
import { COLORS } from '../hooks/view/palette'
import { infoPanel } from '../hooks/view/panels/info'
import { FRESH, cellWidth, draw, drawRows, engine, pane, rowsOf, texts, vmOf } from './kit'
import { NOW, busy } from './fixture'

const info = (s: Snapshot, w: number) => drawRows(infoPanel(draw({ now: NOW }), vmOf(s, w, 'dock', NOW).info, w)).slice(1)

test('INFO is a labelled table in three groups split by dividers', () => {
  expect(info(busy(), 66)).toEqual([
    '┌ INFO ─────────────────────────────────────────────── ● working ┐',
    '│ ◆ effort ▮▮▮▮ xhigh   mode auto   req 7                        │',
    '├────────────────────────────────────────────────────────────────┤',
    '│ ◐ ctx    ▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱  11%  112k/1.0M  ↺ 1                 │',
    '│   5h     ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   2%  ↻ 3h51m                        │',
    '│   7d     ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱  84%  ↻ 1d20h                        │',
    '├────────────────────────────────────────────────────────────────┤',
    '│ $ spend  $0.94   ttft 1.2s · 107 tok/s                         │',
    '└────────────────────────────────────────────────────────────────┘',
  ])
})
test('at 40 columns each row drops its least telling part first', () => {
  const content = info(busy(), 40).filter(r => r.startsWith('│')).map(r => r.slice(2, -2).trimEnd())
  expect(content).toEqual([
    '◆ effort ▮▮▮▮ xhigh   mode auto',
    '◐ ctx    ▰▱▱▱▱▱▱▱▱▱  11%  ↺ 1',
    '  5h     ▱▱▱▱▱▱▱▱▱▱   2%  ↻ 3h51m',
    '  7d     ▰▰▰▰▰▰▰▰▱▱  84%  ↻ 1d20h',
    '$ spend  $0.94   1.2s · 107 tok/s',
  ])
})
test('INFO colours: icons orange, gauges by their own levels, bypass coral, compactions gold (Review Focus 3)', () => {
  const s = busy()
  const hot = { ...s, main: { ...s.main, mode: 'bypassPermissions', speed: null }, usage: { ...s.usage, pct: 96, compactions: 3, limits: [{ kind: 'five_hour', pct: 79.5, resetsAt: null }, { kind: 'seven_day', pct: 104, resetsAt: null }] } }
  const tree = infoPanel(draw({ now: NOW }), vmOf(hot, 66, 'dock', NOW).info, 66)
  const run = (t: string) => texts(tree).find(x => x.text === t)
  expect(run('◐ ')?.color).toBe(COLORS.orange); expect(run('bypass')).toMatchObject({ color: COLORS.error, bold: true }); expect(run('↺ 3')?.color).toBe(COLORS.gold)
  expect(info(hot, 66)[4]).toContain('  80%'); expect(info(hot, 66)[5]).toContain('▰'.repeat(16) + ' 104%')
  expect(texts(tree).filter(x => /^▰+$/.test(x.text)).map(x => x.color)).toEqual([COLORS.error, COLORS.orange, COLORS.error])
  expect(texts(tree).find(x => x.text === ' ● working ')?.color).toBe(COLORS.orange)
  const idle = infoPanel(draw({ now: NOW }), vmOf(FRESH, 66, 'dock', NOW).info, 66)
  expect(texts(idle).find(x => x.text === ' ○ idle ')?.color).toBe(COLORS.dim)
})
test('the effort gauge lights red on the top step (xhigh and max), green below it; the empty steps stay faint', () => {
  const s = busy()
  const lit = (effort: string) => {
    const tree = infoPanel(draw({ now: NOW }), vmOf({ ...s, main: { ...s.main, effort } }, 66, 'dock', NOW).info, 66)
    const effortWord = texts(tree).find(x => x.text === effort)
    return { cells: texts(tree).filter(x => /^▮+$/.test(x.text)).map(x => x.color), empty: texts(tree).find(x => /^▯+$/.test(x.text))?.color, word: effortWord }
  }
  expect(lit('xhigh')).toMatchObject({ cells: [COLORS.error], empty: undefined, word: { color: COLORS.green, bold: true } })
  expect(lit('max')).toMatchObject({ cells: [COLORS.error], empty: undefined, word: { color: COLORS.green, bold: true } })
  expect(lit('high')).toMatchObject({ cells: [COLORS.green], empty: COLORS.faint, word: { color: COLORS.green, bold: true } })
})
test('a gauge clamps to its track, prints the rounded figure and takes its colour from it (Review Focus 3)', () => {
  const s = busy()
  const at = (pct: number) => {
    const snap = { ...s, usage: { ...s.usage, pct, limits: [] } }
    const tree = infoPanel(draw({ now: NOW }), vmOf(snap, 66, 'dock', NOW).info, 66)
    const row = info(snap, 66)[3] ?? ''
    return { row, filled: row.split('▰').length - 1, empty: row.split('▱').length - 1, color: texts(tree).find(x => /^▰+$/.test(x.text))?.color }
  }
  const { green, orange, error } = COLORS
  const cases: [number, string, number, string | undefined][] = [
    [Number.NaN, '  0%', 0, undefined],
    [-5, ' -5%', 0, undefined],
    [29, ' 29%', 5, green],
    [29.5, ' 30%', 5, orange],
    [30, ' 30%', 5, orange],
    [49, ' 49%', 8, orange],
    [49.5, ' 50%', 8, error],
    [50, ' 50%', 8, error],
    [100, '100%', 16, error],
    [104, '104%', 16, error],
    [42, ' 42%', 7, orange],
    [11, ' 11%', 2, green],
  ]
  for (const [pct, figure, filled, color] of cases) {
    const got = at(pct)
    expect(got.row, `pct ${pct}`).toContain(`${figure}`)
    expect(got.row).not.toContain('NaN')
    expect([got.filled, got.filled + got.empty, got.color], `pct ${pct}`).toEqual([filled, 16, color])
  }
})
test('limit gauges turn orange from 80 and red from 90 on the rounded figure, in every window', () => {
  const s = busy()
  const at = (pct: number, kind: string) => {
    const snap = { ...s, usage: { ...s.usage, pct: null, limits: [{ kind, pct, resetsAt: null }] } }
    const tree = infoPanel(draw({ now: NOW }), vmOf(snap, 66, 'dock', NOW).info, 66)
    return { row: info(snap, 66)[3] ?? '', color: texts(tree).find(x => /^▰+$/.test(x.text))?.color }
  }
  const { green, orange, error } = COLORS
  const cases: [number, string, string][] = [[79, ' 79%', green], [79.5, ' 80%', orange], [80, ' 80%', orange], [89, ' 89%', orange], [89.5, ' 90%', error], [90, ' 90%', error], [30, ' 30%', green], [50, ' 50%', green]]
  for (const kind of ['five_hour', 'seven_day', 'seven_day_opus']) {
    for (const [pct, figure, color] of cases) {
      const got = at(pct, kind)
      expect(got.row, `${kind} ${pct}`).toContain(figure)
      expect(got.color, `${kind} ${pct}`).toBe(color)
    }
  }
})
test('a group with nothing to show goes with its divider; nothing at all reads waiting', () => {
  const only = { ...FRESH, main: { ...FRESH.main, effort: 'high' }, usage: { ...FRESH.usage, costUsd: 0.5 } }
  expect(info(only, 66).filter(r => r.startsWith('├'))).toHaveLength(1)
  expect(info(FRESH, 66)[1]).toContain('waiting for the first request')
})
test('the first window takes the ctx icon when there is no context figure; the frame is green while the main loop works', () => {
  const s = busy()
  const noCtx = { ...s, usage: { ...s.usage, pct: null } }
  expect(info(noCtx, 66)[3]).toContain('◐ 5h')
  expect(info(noCtx, 66)[3]).not.toContain('ctx')
  const tree = infoPanel(draw({ now: NOW }), vmOf(s, 66, 'dock', NOW).info, 66)
  expect(JSON.stringify(tree)).toContain(COLORS.green)
  expect(vmOf(s, 66, 'dock', NOW).info.rows).toBe(7)
  expect(vmOf(FRESH, 66, 'dock', NOW).info.rows).toBe(1)
})

// ---------------------------------------------------------------- moved from the 0.1.0 vitals tests

test("the permission mode is read from the person's prompt and shown beside the effort", async ($, on) => {
  engine(on)
  on('classic.UserPromptSubmit', () => ({}))
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'auto' } as never)
  await $.classic.UserPromptSubmit({ prompt: 'again' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const rows = await rowsOf(ui)
  expect(rows.some(r => r.includes('◆ effort mode auto'))).toBe(true); expect(rows.some(r => r.includes('waiting for the first request'))).toBe(false)
  await ui.unmount()
})
test('a compaction counts, is logged, and shows beside the context gauge', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const kept = [{ role: 'user', text: 'summary', toolUses: [] }] as never
  on('session.compact', () => ({ messages: kept }))
  await $.session.measure({ context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  await $.session.compact({ trigger: 'manual', messages: kept } as never)
  await $.session.compact({ trigger: 'precompute', messages: kept } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /↺ 1/ })).toBeDefined(); expect(await ui.find({ text: /↺ 2/ })).toBeUndefined()
  expect((await rowsOf(ui)).some(r => /◐ ctx .* 10% {2}20k\/200k {2}↺ 1/.test(r))).toBe(true)
  expect(await ui.find({ text: /context compacted \(manual\)/ })).toBeDefined()
  await ui.unmount()
})
test('hosts without cost, limits or context hide those fields (Review Focus 4)', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => {
    throw new Error('no usage on this host')
  })
  await $.session.measure({ context: { window: 200_000, percent: null as never }, rateLimits: [], changed: ['context'] })
  // A turn on a host whose usage throws still starts and ends.
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /INFO/ })).toBeDefined()
  expect(await ui.find({ text: /NaN|null|undefined/ })).toBeUndefined()
  expect(await ui.find({ text: /^ctx/ })).toBeUndefined(); expect(await ui.find({ text: /\$/ })).toBeUndefined()
  expect((await rowsOf(ui)).some(r => r.startsWith('├'))).toBe(false)
  await ui.unmount()
})
test('each rate-limit window shows its reset countdown where the frame has room', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: '1970-01-01T03:10:00.000Z' },
      { kind: 'seven_day', percentUsed: 3, resetsAt: '1970-01-05T02:00:00.000Z' },
      { kind: 'seven_day_opus', percentUsed: 9 },
    ],
    changed: ['rateLimits'],
  })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const rows = await rowsOf(ui)
    expect(rows.some(r => /◐ 5h {5}.* 19% {2}↻ 3h10m/.test(r)), `${cols} columns`).toBe(true)
    expect(rows.some(r => /^│ {3}7d {5}.* {2}3% {2}↻ 4d2h/.test(r)), `${cols} columns`).toBe(true)
    expect(await ui.find({ text: /opus/ })).toBeUndefined() // only the first two windows
    for (const r of rows) expect(cellWidth(r) <= cols).toBe(true)
    await ui.unmount()
  }
})
