// A busy session for the panel tests: a working main loop, five subagents, an architect consult,
// tool and file activity and a log. Times count back from `now`.
import {
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_VIEW,
  normalizeActivity,
  normalizeAgents,
  normalizeArchitect,
  normalizeLog,
  normalizeLoops,
  normalizeMain,
  normalizeUsage,
} from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/schema'

/** The fixed moment the sample session is drawn at. */
export const NOW = Date.UTC(2026, 9, 23, 12, 0, 0)

/** A made-up secret built at run time (`prefix` plus a filler of one letter), so no file holds a literal in a credential's shape. */
export const fake = (prefix = '', len = 16): string => prefix + 'Q'.repeat(len)

/** A connection URL carrying a made-up password, joined from parts for the same reason. */
export const dsn = (user: string, pass: string = fake()): string => ['postgres://', user, ':', pass, '@db/x'].join('')

const S = 1000
const M = 60 * S

export const busy = (now: number = NOW): Snapshot => ({
  main: normalizeMain({ model: 'claude-opus-5-5', effort: 'xhigh', mode: 'auto', steps: 7, isRunning: true, speed: { ttftMs: 1200, tokPerS: 107 } }),
  usage: normalizeUsage({
    pct: 11,
    tokens: 112_000,
    window: 1_000_000,
    costUsd: 0.94,
    compactions: 1,
    lastCompactAt: now - 20 * M,
    limits: [
      { kind: 'five_hour', pct: 2, resetsAt: now + 231 * M },
      { kind: 'seven_day', pct: 84, resetsAt: now + 44 * 60 * M },
    ],
  }),
  turn: DEFAULT_TURN,
  agents: normalizeAgents([
    { id: 'a1', type: 'Explore', model: 'claude-haiku-4-5', description: 'Map hooks to events', status: 'done', spawnedAt: now - 140 * S, endedAt: now - 125 * S, ctx: 41_000, out: 2_100, steps: 9, lastStop: null, tools: [{ tool: 'Grep', text: "on('ui.render'", isError: false }], answer: 'Eight wire* modules.' },
    { id: 'a2', type: 'general-purpose', model: 'claude-sonnet-4-5', description: 'Review README claims', status: 'done', spawnedAt: now - 138 * S, endedAt: now - 127 * S, ctx: 28_000, out: 1_400, steps: 6, lastStop: null, tools: [], answer: '' },
    { id: 'a3', type: 'Explore', model: '', description: 'Check versions', status: 'running', spawnedAt: now - 59 * S, endedAt: null, ctx: 12_000, out: 300, steps: 3, lastStop: null, tools: [{ tool: 'Read', text: 'package.json', isError: false }], answer: '' },
    { id: 'a4', type: 'Plan', model: 'claude-fable-5-1', description: 'List pane structure', status: 'failed', spawnedAt: now - 90 * S, endedAt: now - 80 * S, ctx: 9_000, out: 200, steps: 2, lastStop: 'max_tokens', tools: [{ tool: 'Bash', text: 'ls hooks/view', isError: true }], answer: '' },
    { id: 'a5', type: 'Explore', model: 'claude-haiku-4-5', description: 'Count tests by file', status: 'running', spawnedAt: now - 37 * S, endedAt: null, ctx: 6_000, out: 120, steps: 1, lastStop: null, tools: [], answer: '' },
  ]),
  loops: normalizeLoops([
    { id: 'l1', steps: 3, firstAt: now - 10 * M, lastAt: now - 9 * M, isDone: true },
    { id: 'l2', steps: 5, firstAt: now - 2 * M, lastAt: now - 5 * S, isDone: false },
  ]),
  architect: normalizeArchitect({
    consults: [{ id: 'c1', at: now - 100 * S, endAt: now - 70 * S, moment: 'before a plan', via: 'advisor' }],
    ids: [],
    seen: [],
    lastAdvice: 'Lock the palette before the frames.',
  }),
  activity: normalizeActivity({
    calls: 23,
    tools: [
      { tool: 'Read', calls: 9, errors: 0, timedCalls: 9, timedMs: 360 },
      { tool: 'Bash', calls: 6, errors: 1, timedCalls: 6, timedMs: 9_200 },
      { tool: 'Grep', calls: 4, errors: 0, timedCalls: 4, timedMs: 220 },
      { tool: 'Edit', calls: 3, errors: 0, timedCalls: 3, timedMs: 150 },
      { tool: 'Skill', calls: 1, errors: 0, timedCalls: 1, timedMs: 25 },
    ],
    files: [
      { path: 'hooks/view/palette.ts', reads: 3, edits: 2, byMain: true, lastAt: now - 40 * S },
      { path: 'hooks/view/header.tsx', reads: 2, edits: 1, byMain: true, lastAt: now - 60 * S },
      { path: 'README.md', reads: 2, edits: 0, byMain: false, lastAt: now - 130 * S },
    ],
  }),
  log: normalizeLog([
    { at: now - 178 * S, who: 'you', text: 'Review the pane against the README', agentId: null, kind: 'info', mark: null },
    { at: now - 140 * S, who: 'Explore 1', text: 'spawned · Explore', agentId: 'a1', kind: 'info', mark: null },
    { at: now - 125 * S, who: 'Explore 1', text: 'done · 0:15', agentId: 'a1', kind: 'done', mark: null },
    { at: now - 100 * S, who: 'architect', text: 'before a plan · advisor', agentId: null, kind: 'consult', mark: null },
    { at: now - 82 * S, who: 'main', text: 'Bash rm -rf build', agentId: null, kind: 'error', mark: '· denied' },
    { at: now - 80 * S, who: 'Plan 4', text: 'hit max_tokens', agentId: 'a4', kind: 'error', mark: '✗' },
    { at: now - 40 * S, who: 'main', text: 'Edit hooks/view/palette.ts', agentId: null, kind: 'info', mark: null },
  ]),
  view: DEFAULT_VIEW,
  roster: DEFAULT_ROSTER,
})
