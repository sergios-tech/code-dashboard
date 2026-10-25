import { expect, test } from 'claude-code/testing'

import { normalizeCard } from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/schema'
import { miniPane } from '../hooks/view/mini'
import { COLORS } from '../hooks/view/palette'
import { draw, drawRows, found, texts, vmOf } from './kit'
import { NOW, busy } from './fixture'

const mini = (s: Snapshot, w: number) => drawRows(miniPane(draw({ now: NOW, motion: false, hasClient: false }), vmOf(s, w, 'inline', NOW).mini!, w)).map(r => r.trimEnd())
test('the mini is state and digest, the agents and a last row', () => {
  const rows = mini(busy(), 100)
  expect(rows[0]).toBe('● OPUS 5.5 WORKING · ARCHITECT ON CALL   ◆ xhigh   ◐ ▰▱▱▱▱▱▱▱ 11% ↺1   7d ▰▰▰▰▰▱ 84%   $ 0.94')
  expect(rows[1]).toBe(`● ${'Count tests by file'.padEnd(69)}${'Haiku'.padEnd(8)} ▰▰▰▱▱▱▱▱▱▱▱▱▱▱  0:37`)
  expect(rows.slice(1, 6).map(r => r.slice(0, 2))).toEqual(['● ', '● ', '✗ ', '✓ ', '✓ '])
  expect(rows[6]).toBe('loops 2 seen · 1 active  ✓●'); expect(rows).toHaveLength(7)
})
test('row one gives way: the cooler limit, the architect words, the gauges, effort, the hotter limit, then spend', () => {
  expect(mini(busy(), 60)[0]).toBe('● OPUS 5.5 WORKING   ◆ xhigh  ◐ 11% ↺1  7d 84%  $ 0.94')
  expect(mini(busy(), 44)[0]).toBe('● OPUS 5.5 WORKING   ◐ 11% ↺1  $ 0.94')
  const s = busy(); const long = { ...s, main: { ...s.main, model: 'claude-sonnet-4-5[1m]' }, usage: { ...s.usage, costUsd: 1234.56 } }
  expect(mini(long, 40)[0]).toBe('● SONNET 4.5 1M WORKING   ◐ 11% ↺1')
})
test('agent rows carry no digits or Buttons; tags go under 50 columns; bars are 14, 10 and 6', () => {
  const tree = miniPane(draw({ now: NOW }), vmOf(busy(), 100, 'inline', NOW).mini!, 100)
  expect(found(tree, 'Button')).toEqual([])
  expect(mini(busy(), 50)[1]).toContain('Haiku'); expect(mini(busy(), 49)[1]).not.toContain('Haiku')
  expect(mini(busy(), 70)[4]).toContain(' ' + '▰'.repeat(14)); expect(mini(busy(), 69)[4]).toContain(' ' + '▰'.repeat(10) + ' '); expect(mini(busy(), 49)[4]).toContain(' ' + '▰'.repeat(6) + ' ')
})
test('twelve agents still fit eight rows, with the rest counted', () => {
  const s = busy(); const many = Array.from({ length: 12 }, (_, i) => normalizeCard({ id: `m${i}`, description: `Agent ${i}`, status: 'done', spawnedAt: NOW - 9000, endedAt: NOW - 1000 }))
  const rows = mini({ ...s, agents: many }, 100)
  expect(rows).toHaveLength(8); expect(rows[7]).toMatch(/^\+6 earlier · loops 2 seen/)
})

test('the inline summary colours ctx orange from 30 and red from 50, a limit orange from 80 and red from 90, in gauges and figures', () => {
  const s = busy()
  const { green, orange, error } = COLORS
  const colours = (pct: number | null, limit: number | null, w: number) => {
    const snap = { ...s, agents: [], usage: { ...s.usage, pct, limits: limit === null ? [] : [{ kind: 'five_hour', pct: limit, resetsAt: null }] } }
    const tree = miniPane(draw({ now: NOW, motion: false, hasClient: false }), vmOf(snap, w, 'inline', NOW).mini!, w)
    const t = texts(tree)
    return { gauges: t.filter(x => /^▰+$/.test(x.text)).map(x => x.color), figures: t.filter(x => /^ ?\d+%$/.test(x.text)).map(x => x.color) }
  }
  const ctxCases: [number, string][] = [[29, green], [29.5, orange], [30, orange], [49, orange], [49.5, error], [50, error]]
  const limitCases: [number, string][] = [[79, green], [79.5, orange], [80, orange], [89, orange], [89.5, error], [90, error]]
  for (const w of [100, 44]) {
    for (const [pct, color] of ctxCases) expect(colours(pct, null, w), `ctx ${pct} at ${w}`).toMatchObject({ [w === 100 ? 'gauges' : 'figures']: [color] })
  }
  for (const w of [100, 60]) {
    for (const [pct, color] of limitCases) {
      const got = colours(10, pct, w)
      expect(w === 100 ? got.gauges : got.figures, `limit ${pct} at ${w}`).toEqual([green, color])
    }
  }
  expect(colours(30, 50, 100).gauges).toEqual([orange, green])
})
test('at rest the inline ○ and IDLE are the idle dark red, as in the header', () => {
  const at = (s: Partial<Snapshot>) => texts(miniPane(draw({ now: NOW, motion: false, hasClient: false }), vmOf(s, 100, 'inline', NOW).mini!, 100))
  const rest = at({ ...busy(), main: { ...busy().main, isRunning: false }, agents: [], loops: busy().loops.map(l => ({ ...l, isDone: true })) })
  expect([rest.find(t => t.text === '○')?.color, rest.find(t => t.text === ' IDLE')?.color]).toEqual([COLORS.idle, COLORS.idle])
  // A loop still running, with no agent: the dot is green and IDLE stays dim, as for an agent.
  const looping = at({ ...busy(), main: { ...busy().main, isRunning: false }, agents: [] })
  expect([looping.find(t => t.text === '●')?.color, looping.find(t => t.text === ' IDLE')?.color]).toEqual([COLORS.green, COLORS.dim])
  // An agent still running after the turn: the dot is green and IDLE stays dim.
  const background = at({ ...busy(), main: { ...busy().main, isRunning: false } })
  expect([background.find(t => t.text === '●')?.color, background.find(t => t.text === ' IDLE')?.color]).toEqual([COLORS.green, COLORS.dim])
})
