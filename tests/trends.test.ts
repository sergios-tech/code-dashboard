import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Sample, Trends } from '../types'
import { SAMPLES_MAX, addSample, compactionCells, markCompaction, movesTrend, thin } from '../hooks/domain/trends'
import { sparkline } from '../hooks/format/text'
import { DEFAULT_TRENDS } from '../hooks/state/schema'
import { COLORS } from '../hooks/view/palette'
import { svgSpark } from '../hooks/view/svg'
import { cellWidth, engine, pane, rowsOf } from './kit'

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
test('the vector spark: a line over a faint baseline, gaps break it, bad numbers are safe', () => {
  const svg = svgSpark([0, 50, 100], 300, 40, COLORS.green, { min: 0, max: 100 })
  expect(svg.startsWith('<svg ')).toBe(true); expect(svg).toContain(`stroke="${COLORS.green}"`); expect(svg).toContain(COLORS.faint)
  expect(svg).toContain('<polyline'); expect(svg).not.toContain('NaN')
  // A gap splits the line; a lone reading is a dot.
  const gapped = svgSpark([1, 2, null, 5], 300, 40, COLORS.green)
  expect((gapped.match(/<polyline/g) ?? []).length).toBe(1); expect((gapped.match(/<circle/g) ?? []).length).toBe(1)
  for (const bad of [svgSpark([], Number.NaN, Number.NaN, COLORS.green), svgSpark([Number.NaN, 3, Infinity], 0, 0, COLORS.green), svgSpark([2], 300, 40, COLORS.green)]) {
    expect(bad).not.toMatch(/NaN|Infinity|undefined|null/)
  }
})

// ---------------------------------------------------------------- the TRENDS panel

test('TRENDS appears from the second reading; cost row only when cost is known (Review Focus 4)', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(reading(10))
  expect(trendsRows(await drawn($))).toEqual([])
  await $.session.measure(reading(20))
  let rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(1); expect(rows[0]).toMatch(/^│ ctx {2}\s*▂▃?.*20% +│$/); expect(rows.join('\n')).not.toContain('cost')
  // A reading with a cost brings the cost row; a sample that has a cost also keeps the ctx row.
  await $.session.measure(reading(35, 3.12, ['context', 'cost']))
  rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(2); expect(rows[0]).toMatch(/ctx .*35%/); expect(rows[1]).toMatch(/^│ cost .*\$3\.12 +│$/)
  expect(rows.join('')).not.toMatch(/NaN|null|undefined|\+\$/)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^[ ▁▂▃▄▅▆▇█]+$/ }))?.props.color).toBe(COLORS.green)
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
test('a compaction shows as ⟲ on the ctx line', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const kept = [{ role: 'user', text: 'summary', toolUses: [] }] as never
  on('session.compact', () => ({ messages: kept }))
  await $.session.measure(reading(10)); await $.session.measure(reading(85))
  expect(trendsRows(await drawn($)).join('')).not.toContain('⟲')
  await $.session.compact({ trigger: 'auto', messages: kept } as never)
  // A precompute installs nothing, so it marks nothing; the compaction marks the next reading only.
  await $.session.compact({ trigger: 'precompute', messages: kept } as never)
  await $.session.measure(reading(12))
  await $.session.measure(reading(14))
  const rows = trendsRows(await drawn($))
  expect(rows[0]).toMatch(/ctx .*▇⟲▁?.*14%/); expect(rows[0]!.split('⟲')).toHaveLength(2)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^⟲$/ }))?.props.color).toBe(COLORS.gold)
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
  expect(fresh.some(r => r.includes('┌ VITALS'))).toBe(true); expect(fresh.some(r => r.includes('┌ LOG'))).toBe(true)
  await $.session.measure({ ...(same as object), cost: { usd: 0.02 } } as never)
  const rows = trendsRows(await drawn($))
  expect(rows).toHaveLength(1); expect(rows[0]).toMatch(/^│ cost +▁█ +\$0\.02 +│$/)
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
test('the cost row shows the last turn\'s cost as a delta, and every width keeps its rows inside the pane', async ($, on) => {
  const clock = engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let usd = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, cost: { usd }, rateLimits: [] } }) as never)
  await $.session.measure(reading(10, 1, ['context', 'cost']))
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await clock.advance(1000)
  usd = 1.41
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer' })
  await $.session.measure(reading(30, 1.41, ['context', 'cost']))
  for (const cols of [40, 64, 100]) {
    const rows = await drawn($, cols)
    const body = trendsRows(rows)
    expect(body).toHaveLength(2); expect(body[1]).toMatch(/\$1\.41( \+\$0\.41)? +│$/)
    for (const r of rows) expect(cellWidth(r) <= Math.max(40, cols)).toBe(true)
  }
  expect(trendsRows(await drawn($, 64))[1]).toContain('$1.41 +$0.41')
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
test('on a surface with vectors each line also draws as an Svg', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(reading(10, 1, ['context', 'cost'])); await $.session.measure(reading(20, 2, ['context', 'cost']))
  const ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source ?? '')).toContain('<polyline'); expect(String(svg?.props.alt)).toBe('context fill over 2 readings')
  await ui.unmount()
  const term = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})
