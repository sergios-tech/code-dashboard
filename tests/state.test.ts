import { expect, test } from 'claude-code/testing'
import { read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { parseConfig } from '../hooks/config'
import { activity, agents, architect, loadSnapshot, log, loops, main, meta, migrate, resetAll, roster, turn, usage, view } from '../hooks/register'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  normalize,
  normalizeActivity,
  normalizeArchitect,
  normalizeCard,
  normalizeLog,
  normalizeMain,
  normalizeUsage,
} from '../hooks/state/schema'

test('config is read leniently: bad values fall back to defaults', () => {
  const d = parseConfig({})
  expect(d.panels).toEqual(['info', 'agents', 'architect', 'tools', 'log'])
  expect(d.architect.test('fable-ADVISOR')).toBe(true); expect(d.architectLabel).toBe('ARCHITECT')
  expect(d.layout).toBe('auto'); expect(d.motion).toBe(true)
  const bad = parseConfig({ architectPattern: '([', layout: 'huge', panels: 'gate,nope', motion: 'off', moments: 'yes' })
  expect(bad.architect.test('architect')).toBe(true); expect(bad.layout).toBe('auto')
  expect(bad.panels).toEqual(d.panels); expect(bad.motion).toBe(false); expect(bad.moments).toBe(true)
  expect(parseConfig({ panels: 'log, info ,log' }).panels).toEqual(['log', 'info'])
})
test('panels default to info, agents, architect, tools, log; old names are not aliases (Review Focus 2)', () => {
  expect(parseConfig({}).panels).toEqual(['info', 'agents', 'architect', 'tools', 'log'])
  expect(parseConfig({ panels: 'vitals,turn,log' }).panels).toEqual(['log'])
  expect(parseConfig({ panels: 'vitals,turn,loops' }).panels).toEqual(parseConfig({}).panels)
  expect(parseConfig({ panels: 'vitals,turn,loops', maxCards: 3 }).panels).toEqual(parseConfig({}).panels)
})
test('garbage in any stored key reads as its defaults (Review Focus 1)', () => {
  for (const junk of [null, 7, 'x', [], { consults: 'no' }]) {
    expect(normalizeArchitect(junk).consults).toEqual([])
    expect(normalizeActivity(junk)).toEqual(DEFAULT_ACTIVITY)
    expect(normalizeUsage(junk).limits).toEqual([])
    expect(normalizeLog(junk)).toEqual([])
  }
  expect(normalizeCard({ id: 'a', steps: 'x' }).tools).toEqual([])
  expect(normalizeLog([{ at: 'x', who: 3, kind: 'weird' }])[0]).toEqual({ at: 0, who: '3', text: '', agentId: null, kind: 'info', mark: null })
  // A refused or failed call's line from before the marker had its own field gives it up from its text.
  const [denied, failed, junkMark, notMarked] = normalizeLog([
    { at: 1, who: 'main', text: 'Bash → rm -rf build · denied', agentId: null, kind: 'error' },
    { at: 2, who: 'main', text: 'Bash → npm test ✗', agentId: null, kind: 'error' },
    { at: 3, who: 'main', text: 'Bash → npm test', agentId: null, kind: 'error', mark: 'nope' },
    { at: 4, who: 'you', text: 'is this ✗', agentId: null, kind: 'info' },
  ])
  expect([denied?.text, denied?.mark, failed?.text, failed?.mark]).toEqual(['Bash → rm -rf build', '· denied', 'Bash → npm test', '✗'])
  expect([junkMark?.text, junkMark?.mark, notMarked?.text, notMarked?.mark]).toEqual(['Bash → npm test', null, 'is this ✗', null])
})
test('wrong-typed fields and rows are repaired, and defaults are never shared', () => {
  expect(normalize(DEFAULT_MAIN, { model: 7, steps: 'x', isRunning: 1, extra: true })).toEqual(DEFAULT_MAIN)
  expect(normalizeMain({ model: 'opus', speed: 'fast' })).toEqual({ ...DEFAULT_MAIN, model: 'opus' })
  expect(normalizeMain({ speed: { ttftMs: 800, tokPerS: 'x' } }).speed).toEqual({ ttftMs: 800, tokPerS: null })
  expect(normalize(DEFAULT_MAIN, { model: 'opus', steps: 4 })).toEqual({ ...DEFAULT_MAIN, model: 'opus', steps: 4 })
  expect(normalizeLog([null, 3, { text: 'kept' }]).map(l => l.text)).toEqual(['kept'])
  expect(normalizeUsage({ pct: '51', costUsd: 1.5, limits: [{ kind: 'five_hour', pct: 20, resetsAt: 'soon' }, 4] }))
    .toEqual({ ...DEFAULT_USAGE, costUsd: 1.5, limits: [{ kind: 'five_hour', pct: 20, resetsAt: null }] })
  expect(normalizeActivity({ tools: [{ tool: 'Bash', calls: 2 }, { calls: 9 }], files: [{ path: 'a/b.ts', edits: 1 }, null] })).toEqual({
    tools: [{ tool: 'Bash', calls: 2, errors: 0, timedCalls: 0, timedMs: 0 }],
    files: [{ path: 'a/b.ts', reads: 0, edits: 1, byMain: false, lastAt: 0 }],
    calls: 2,
  })
  normalize(DEFAULT_USAGE, {}).limits.push({ kind: 'x', pct: 1, resetsAt: null })
  expect(DEFAULT_USAGE.limits).toEqual([])
})

// The kit's `$` carries no `state` noun, so the store functions get a small in-memory one with the
// host's contract: a version per value, and writes that can be made conditional on it.
const memoryState = () => {
  const held = new Map<string, { value: unknown; version: number }>()
  const keyOf = (r: { plugin: string; key: string; id?: string }) => `${r.plugin}/${r.key}/${r.id ?? ''}`
  return {
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

const junkOf = [null, 7, 'x', [], { consults: 'no' }, [null, 3, 'y']]

test('a store full of garbage loads as all defaults', async () => {
  const $ = memoryState()
  const atoms = [main, usage, turn, agents, loops, architect, activity, log, view, roster]
  for (const junk of junkOf) {
    for (const a of atoms) await update($, a as never, (() => junk) as never)
    expect(await loadSnapshot($)).toEqual({
      main: DEFAULT_MAIN, usage: DEFAULT_USAGE, turn: DEFAULT_TURN, agents: [], loops: [],
      architect: DEFAULT_ARCHITECT, activity: DEFAULT_ACTIVITY,
      log: [], view: DEFAULT_VIEW, roster: DEFAULT_ROSTER,
    })
  }
})
test('state from the 0.1.0 build migrates to schema 2 (Review Focus 2)', async () => {
  const $ = memoryState()
  await update($, meta, () => ({ schemaVersion: 1 }))
  await update($, turn, () => ({ startedAt: 9, costAtStart: 0.5, edits: 2, errors: 1, errorStreak: 0, isReviewing: true }) as never)
  await migrate($)
  expect(await read($, meta)).toEqual({ schemaVersion: 2 }); expect(await read($, turn)).toEqual({ edits: 2, errorStreak: 0 })
})
test('reset keeps cost, limits, compactions, model, mode and the offered architect types, and empties the rest', async () => {
  const $ = memoryState()
  await update($, main, () => ({ ...DEFAULT_MAIN, model: 'model-x', mode: 'plan', steps: 9, isRunning: true }))
  await update($, usage, () => ({ pct: 51, tokens: 100, window: 200, costUsd: 2.5, limits: [{ kind: 'five_hour', pct: 10, resetsAt: null }], compactions: 2, lastCompactAt: 8 }))
  await update($, log, () => [{ at: 1, who: 'you', text: 'hi', agentId: null, kind: 'info' as const, mark: null }])
  await update($, roster, () => ({ architectTypes: ['advisor'] }))
  await update($, architect, () => ({ ...DEFAULT_ARCHITECT, ids: ['a1'], lastAdvice: 'Ship it' }))
  await resetAll($)
  const s = await loadSnapshot($)
  expect(s.main).toEqual({ ...DEFAULT_MAIN, model: 'model-x', mode: 'plan' })
  expect(s.usage).toEqual({ ...DEFAULT_USAGE, costUsd: 2.5, limits: [{ kind: 'five_hour', pct: 10, resetsAt: null }], compactions: 2 })
  expect([s.log, s.architect]).toEqual([[], DEFAULT_ARCHITECT])
  // The agent listing is not sent again after a clear, so the types it offered are kept.
  expect(s.roster).toEqual({ architectTypes: ['advisor'] })
  expect(await read($, main)).toEqual(s.main)
})
