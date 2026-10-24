import { expect, test } from 'claude-code/testing'

import { normalizeCard } from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/store'
import { miniPane } from '../hooks/view/mini'
import { draw, drawRows, found, vmOf } from './kit'
import { NOW, busy } from './fixture'

const mini = (s: Snapshot, w: number) => drawRows(miniPane(draw({ now: NOW, motion: false, hasClient: false }), vmOf(s, w, 'inline', NOW).mini!, w)).map(r => r.trimEnd())
test('the mini is state and digest, the ctx trend, the agents and a last row, in eight rows', () => {
  const rows = mini(busy(), 100)
  expect(rows[0]).toBe('● OPUS 5.5 WORKING · ARCHITECT ON CALL   ◆ xhigh   ◐ ▰▱▱▱▱▱▱▱ 11% ↺1   7d ▰▰▰▰▰▱ 84%   $ 0.94')
  expect(rows[1]).toMatch(/^◐ ctx {4}[▁-█↺ ]{85} {3}11%$/)
  expect(rows[2]).toBe(`● ${'Count tests by file'.padEnd(69)}${'Haiku'.padEnd(8)} ▰▰▰▱▱▱▱▱▱▱▱▱▱▱  0:37`)
  expect(rows.slice(2, 7).map(r => r.slice(0, 2))).toEqual(['● ', '● ', '✗ ', '✓ ', '✓ '])
  expect(rows[7]).toBe('loops 2 seen · 1 active  ✓●'); expect(rows).toHaveLength(8)
})
test('row one gives way: the cooler limit, the architect words, the gauges, effort, the hotter limit, then ctx', () => {
  expect(mini(busy(), 60)[0]).toBe('● OPUS 5.5 WORKING   ◆ xhigh  ◐ 11% ↺1  7d 84%  $ 0.94')
  expect(mini(busy(), 44)[0]).toBe('● OPUS 5.5 WORKING   ◐ 11% ↺1  $ 0.94')
})
test('agent rows carry no digits or Buttons; tags go under 50 columns; bars are 14, 10 and 6', () => {
  const tree = miniPane(draw({ now: NOW }), vmOf(busy(), 100, 'inline', NOW).mini!, 100)
  expect(found(tree, 'Button')).toEqual([])
  expect(mini(busy(), 50)[2]).toContain('Haiku'); expect(mini(busy(), 49)[2]).not.toContain('Haiku')
  expect(mini(busy(), 70)[5]).toContain(' ' + '▰'.repeat(14)); expect(mini(busy(), 69)[5]).toContain(' ' + '▰'.repeat(10) + ' '); expect(mini(busy(), 49)[5]).toContain(' ' + '▰'.repeat(6) + ' ')
})
test('twelve agents still fit eight rows, with the rest counted', () => {
  const s = busy(); const many = Array.from({ length: 12 }, (_, i) => normalizeCard({ id: `m${i}`, description: `Agent ${i}`, status: 'done', spawnedAt: NOW - 9000, endedAt: NOW - 1000 }))
  const rows = mini({ ...s, agents: many }, 100)
  expect(rows).toHaveLength(8); expect(rows[7]).toMatch(/^\+7 earlier · loops 2 seen/)
})
