import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Sample, Trends } from '../types'
import { SAMPLES_MAX, addSample, compactionCells, markCompaction, movesTrend, thin } from '../hooks/domain/trends'
import { placeCells, sparkline } from '../hooks/format/text'
import { DEFAULT_TRENDS } from '../hooks/state/schema'
import { COLORS } from '../hooks/view/palette'
import { trendsPanel } from '../hooks/view/panels/trends'
import { FRESH, cellWidth, draw, drawRows, engine, pane, rowsOf, texts, vmOf } from './kit'
import { NOW } from './fixture'

const sample = (at: number, isCompaction = false, ctxPct: number | null = at, costUsd: number | null = at): Sample => ({ at, ctxPct, costUsd, isCompaction })

/** The pane's rows at a width, unmounted again. */
const drawn = async ($: Engine, cols = 64) => {
  const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
  const rows = await rowsOf(ui)
  await ui.unmount()
  return rows
}

/** The rows inside the TRENDS frame, between its top and bottom borders. */
const trendsRows = (rows: string[]): string[] => {
  const top = rows.findIndex(r => r.includes('┌ TRENDS'))
  const bottom = rows.findIndex((r, i) => i > top && r.startsWith('└'))
  return top < 0 || bottom < 0 ? [] : rows.slice(top + 1, bottom)
}

/** A reading as the host sends it; the cost is left out when `usd` is null. */
const reading = (percent: number, usd: number | null = null, changed: ('context' | 'cost')[] = ['context']) => ({
  context: { window: 200_000, tokens: percent * 2000, percent },
  ...(usd === null ? {} : { cost: { usd } }),
  rateLimits: [],
  changed,
})

// ---------------------------------------------------------------- pure modules

test('trends thin by pairing, keep compaction marks and span the session (Review Focus 5)', () => {
  let t: Trends = DEFAULT_TRENDS
  for (let i = 0; i < 1000; i++) { if (i === 501) t = markCompaction(t); t = addSample(t, { at: i, ctxPct: i % 100, costUsd: i / 100 }) }
  expect(t.samples.length <= 60).toBe(true); expect(t.samples[t.samples.length - 1]?.at).toBe(999)
  expect(t.samples.some(s => s.isCompaction)).toBe(true); expect(t.samples[0]!.at < 100).toBe(true)
  expect(t.samples.filter(s => s.isCompaction)).toHaveLength(1); expect(t.pendingCompaction).toBe(false)
})
test('thinning pairs neighbours: the later reading, either mark, an odd last one kept', () => {
  const out = thin([sample(0), sample(1, true), sample(2), sample(3), sample(4)])
  expect(out).toEqual([sample(1, true), sample(3), sample(4)])
  expect(thin([])).toEqual([]); expect(thin([sample(7)])).toEqual([sample(7)])
  // Exactly SAMPLES_MAX samples are kept whole; one more thins all but the first to half.
  let t: Trends = DEFAULT_TRENDS
  for (let i = 0; i < SAMPLES_MAX; i++) t = addSample(t, { at: i, ctxPct: 1, costUsd: null })
  expect(t.samples).toHaveLength(SAMPLES_MAX)
  t = addSample(t, { at: SAMPLES_MAX, ctxPct: 1, costUsd: null })
  expect(t.samples).toHaveLength(31); expect(t.samples.slice(0, 2).map(x => x.at)).toEqual([0, 2])
})
test('a compaction marks the next sample once, and only that one', () => {
  let t = markCompaction(addSample(DEFAULT_TRENDS, { at: 1, ctxPct: 80, costUsd: 1 }))
  expect(t.pendingCompaction).toBe(true)
  t = addSample(addSample(t, { at: 2, ctxPct: 10, costUsd: 1 }), { at: 3, ctxPct: 12, costUsd: 1 })
  expect(t.samples.map(s => s.isCompaction)).toEqual([false, true, false]); expect(t.pendingCompaction).toBe(false)
})
test('a reading moves the lines only as the first, after a compaction, or with a new figure', () => {
  const one = addSample(DEFAULT_TRENDS, { at: 1, ctxPct: null, costUsd: 0 })
  expect(movesTrend(DEFAULT_TRENDS, { ctxPct: null, costUsd: 0 })).toBe(true); expect(movesTrend(one, { ctxPct: null, costUsd: 0 })).toBe(false)
  expect(movesTrend(one, { ctxPct: 5, costUsd: 0 })).toBe(true); expect(movesTrend(one, { ctxPct: null, costUsd: 0.01 })).toBe(true)
  expect(movesTrend(markCompaction(one), { ctxPct: null, costUsd: 0 })).toBe(true)
})
test('compaction cells follow where the sparkline puts each sample', () => {
  // Fewer samples than cells: right-aligned. More samples than cells: each cell takes the samples that fall in it.
  expect(compactionCells([sample(0), sample(1, true), sample(2)], 6)).toEqual([4])
  const many = Array.from({ length: 12 }, (_, i) => sample(i, i === 5 || i === 11))
  expect(compactionCells(many, 4)).toEqual([1, 3])
  expect(compactionCells(many, 0)).toEqual([]); expect(compactionCells([], 5)).toEqual([])
  // The marked cell holds the marked sample's own level.
  const values = many.map(s => s.ctxPct)
  expect(sparkline(values, 4, { min: 0, max: 11 })).toHaveLength(4)
})
// ---------------------------------------------------------------- the TRENDS table

const point = (i: number, ctxPct: number | null, costUsd: number | null, isCompaction = false) => ({ at: NOW - (10 - i) * 60_000, ctxPct, costUsd, isCompaction })
const fourReadings = { ...FRESH, usage: { ...FRESH.usage, pct: 95, costUsd: 0.32 }, trends: { pendingCompaction: false, samples: [point(0, 10, 0.1), point(1, 20, 0.2), point(2, 85, 0.3, true), point(3, 95, 0.32)] } }
test('TRENDS draws a row per line: icon, label, cells by level, figure and change', () => {
  const tree = trendsPanel(draw(), vmOf(fourReadings, 66).trends!, 66)
  const rows = drawRows(tree).slice(1)
  expect(rows[1]).toBe(`│ ◐ ctx    ${' '.repeat(35)}▂▂↺█    95%    +10 │`)
  expect(rows[2]).toBe(`│ $ cost   ${' '.repeat(35)}▁▄↺█  $0.32 +$0.02 │`)
  const cell = (ch: string) => texts(tree).filter(t => t.text === ch).map(t => t.color)
  expect(cell('↺')).toEqual([COLORS.gold, COLORS.gold]); expect(cell('█')).toEqual([COLORS.error, COLORS.muted])
  expect(cell('▂▂')).toEqual([COLORS.green]); expect(cell('▁▄')).toEqual([COLORS.muted])
})
test('the head icons are orange, the label dim, the figure bold text and the change dim', () => {
  const tree = trendsPanel(draw(), vmOf(fourReadings, 66).trends!, 66)
  const run = (t: string) => texts(tree).filter(x => x.text === t)
  expect(run('◐ ').map(t => t.color)).toEqual([COLORS.orange]); expect(run('$ ').map(t => t.color)).toEqual([COLORS.orange])
  expect(run('ctx    ')[0]?.color).toBe(COLORS.dim); expect(run('cost   ')[0]?.color).toBe(COLORS.dim)
  expect(run('    95%')[0]).toMatchObject({ color: COLORS.text, bold: true }); expect(run('    +10')[0]?.color).toBe(COLORS.dim)
  expect(run(' +$0.02').map(t => t.color)).toEqual([COLORS.dim])
})
test('ctx cells take the level colour of their own reading, gold from 80% and coral from 90%', () => {
  const s = { ...fourReadings, trends: { pendingCompaction: false, samples: [point(0, 50, null), point(1, 79.5, null), point(2, 89.4, null), point(3, 90, null)] } }
  const tree = trendsPanel(draw(), vmOf(s, 66).trends!, 66)
  expect(texts(tree).filter(t => /^[▁-█]+$/.test(t.text)).map(t => [t.text, t.color])).toEqual([['▅', COLORS.green], ['▇▇', COLORS.gold], ['▇', COLORS.error]])
})
test('the change column goes under 50 inside cells, and a zero change is hidden', () => {
  expect(drawRows(trendsPanel(draw(), vmOf(fourReadings, 53).trends!, 53)).slice(1)[1]?.endsWith('  95% │')).toBe(true)
  const flat = { ...fourReadings, trends: { pendingCompaction: false, samples: [point(0, 95, 0.32), point(1, 95, 0.32)] } }
  expect(vmOf(flat, 66).trends?.ctx?.change).toBeNull(); expect(vmOf(flat, 66).trends?.cost?.change).toBeNull()
  expect(drawRows(trendsPanel(draw(), vmOf(flat, 66).trends!, 66)).slice(1)[1]).toMatch(/95% {8}│$/)
})
test('the change is the latest figure minus the one before: signed for ctx, positive only for cost', () => {
  const falling = { ...fourReadings, trends: { pendingCompaction: false, samples: [point(0, 85, 0.5), point(1, 82, 0.5)] } }
  const v = vmOf(falling, 66).trends!
  expect(v.ctx?.change).toBe(-3); expect(v.cost?.change).toBeNull()
  expect(drawRows(trendsPanel(draw(), v, 66)).slice(1)[1]).toMatch(/82% {5}−3 │$/)
  const cents = { ...fourReadings, trends: { pendingCompaction: false, samples: [point(0, null, 1), point(1, null, 1.004), point(2, null, 1.5)] } }
  expect(vmOf(cents, 66).trends?.ctx).toBeNull(); expect(vmOf(cents, 66).trends?.cost?.change).toBe(0.5)
  const tiny = { ...fourReadings, trends: { pendingCompaction: false, samples: [point(0, null, 1), point(1, null, 1.004)] } }
  expect(vmOf(tiny, 66).trends?.cost?.change).toBeNull()
})
test('placeCells resamples onto the cells or right-aligns', () => {
  expect(placeCells([1, 2], 4)).toEqual([null, null, 1, 2]); expect(placeCells([1, 2, 3, 4], 2)).toEqual([2, 4])
  expect(placeCells([1, Number.NaN, null], 3)).toEqual([1, null, null]); expect(placeCells([1], 0)).toEqual([])
})
test('the sparkline and the cells share one placement, so a mark sits on its reading', () => {
  const many = Array.from({ length: 12 }, (_, i) => sample(i, i === 5))
  const cells = placeCells(many.map(s => s.ctxPct), 4)
  expect(cells).toEqual([2, 5, 8, 11]); expect(compactionCells(many, 4)).toEqual([1])
  expect(sparkline(cells, 4, { min: 0, max: 11 })).toBe(sparkline(many.map(s => s.ctxPct), 4, { min: 0, max: 11 }))
})

// ---------------------------------------------------------------- the TRENDS panel in a session

test('TRENDS appears from the second reading; cost row only when cost is known (Review Focus 4)', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(reading(10))
  expect(trendsRows(await drawn($))).toEqual([])
  await $.session.measure(reading(20))
  let rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(1); expect(rows[0]).toMatch(/^│ ◐ ctx +▂▂ +20% +\+10 │$/); expect(rows.join('\n')).not.toContain('cost')
  // A reading with a cost brings the cost row; a sample that has a cost also keeps the ctx row.
  await $.session.measure(reading(35, 3.12, ['context', 'cost']))
  rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(2); expect(rows[0]).toMatch(/ctx .*35%/); expect(rows[1]).toMatch(/^│ \$ cost .*\$3\.12 +│$/)
  expect(rows.join('')).not.toMatch(/NaN|null|undefined|\+\$/)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^[▁▂▃▄▅▆▇█]+$/ }))?.props.color).toBe(COLORS.green)
  await ui.unmount()
})
test('a reading that changed neither context nor cost adds no sample', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(reading(10))
  await $.session.measure({ ...reading(20), changed: ['rateLimits' as never] })
  await $.session.measure({ ...reading(30), changed: [] })
  expect(trendsRows(await drawn($))).toEqual([])
  await $.session.measure(reading(40))
  expect(trendsRows(await drawn($))[0]).toMatch(/40%/)
})
test('a compaction shows as ↺ on both lines', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const kept = [{ role: 'user', text: 'summary', toolUses: [] }] as never
  on('session.compact', () => ({ messages: kept }))
  const both = ['context', 'cost'] as ('context' | 'cost')[]
  await $.session.measure(reading(10, 1, both)); await $.session.measure(reading(85, 2, both))
  expect(trendsRows(await drawn($)).join('')).not.toContain('↺')
  await $.session.compact({ trigger: 'auto', messages: kept } as never)
  // A precompute installs nothing, so it marks nothing; the compaction marks the next reading only.
  await $.session.compact({ trigger: 'precompute', messages: kept } as never)
  await $.session.measure(reading(12, 3, both))
  await $.session.measure(reading(14, 4, both))
  const rows = trendsRows(await drawn($))
  expect(rows[0]).toMatch(/ctx .*▂▇↺▂ .*14%/); expect(rows[1]).toMatch(/cost .*▁▃↺█/)
  expect(rows.join('').split('↺')).toHaveLength(3); expect(rows.join('')).not.toContain('⟲')
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /^↺$/ })).map(t => t.props.color)).toEqual([COLORS.gold, COLORS.gold])
  await ui.unmount()
})
test('the start of the session takes the first sample; hosts without usage take none (Review Focus 4)', async ($, on) => {
  engine(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 5 }, cost: { usd: 0.5 }, rateLimits: [] } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  // One sample is not a line yet; the next reading makes it one, with the start as its first point.
  expect(trendsRows(await drawn($))).toEqual([])
  await $.session.measure(reading(25, 0.9, ['context', 'cost']))
  const rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(2); expect(rows[1]).toMatch(/\$0\.90/)
})
test('a fresh session whose readings repeat the start draws no TRENDS until a figure moves', async ($, on) => {
  engine(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, cost: { usd: 0 }, rateLimits: [] } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  // The host flags its first readings as changing context and cost, yet they repeat the start's figures.
  const same = { context: { window: 200_000, tokens: 9_000 }, cost: { usd: 0 }, rateLimits: [], changed: ['context', 'rateLimits', 'cost'] } as never
  await $.session.measure(same); await $.session.measure(same)
  const fresh = await drawn($)
  expect(fresh.some(r => r.includes('TRENDS'))).toBe(false)
  expect(fresh.some(r => r.includes('┌ INFO'))).toBe(true); expect(fresh.some(r => r.includes('┌ LOG'))).toBe(true)
  await $.session.measure({ ...(same as object), cost: { usd: 0.02 } } as never)
  const rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(1); expect(rows[0]).toMatch(/^│ \$ cost +▁█ +\$0\.02 +\+\$0\.02 │$/)
})
test('a host whose usage throws or has no context still draws, with no cost row and no junk (Review Focus 4)', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => {
    throw new Error('no usage on this host')
  })
  await $.session.measure({ context: { window: 200_000, percent: null as never }, rateLimits: [], changed: ['context'] })
  await $.session.measure({ context: { window: 200_000, percent: null as never }, rateLimits: [], changed: ['context'] })
  await $.turn.start({ text: 'go', turnId: 'T1' })
  expect(trendsRows(await drawn($))).toEqual([])
  await $.session.measure(reading(30)); await $.session.measure(reading(40))
  const rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(1); expect(rows[0]).toMatch(/ctx /); expect(rows.join('')).not.toMatch(/NaN|null|undefined|cost/)
})
test('every width keeps the TRENDS rows inside the pane', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(reading(10, 1, ['context', 'cost']))
  await $.session.measure(reading(30, 1.41, ['context', 'cost']))
  for (const cols of [40, 64, 100]) {
    const rows = await drawn($, cols)
    const body = trendsRows(rows)
    // The change column is there from 54 columns; under it the figure ends the row.
    expect(body).toHaveLength(2); expect(body[1]).toMatch(cols >= 54 ? /\$1\.41 +\+\$0\.41 │$/ : / \$1\.41 │$/)
    for (const r of rows) expect(cellWidth(r) <= Math.max(40, cols)).toBe(true)
  }
})
test('a long session draws a bounded TRENDS panel (Review Focus 5)', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  for (let i = 0; i < 200; i++) await $.session.measure(reading(i % 100, i / 10, ['context', 'cost']))
  for (const cols of [40, 120]) {
    const rows = await drawn($, cols)
    expect(trendsRows(rows)).toHaveLength(2)
    for (const r of rows) expect(cellWidth(r) <= Math.max(40, cols)).toBe(true)
  }
})
