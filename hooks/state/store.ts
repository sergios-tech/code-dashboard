// The only place that reads or bulk-writes stored state: every value leaves here normalized.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Activity, AgentCard, Architect, Denials, LogLine, Loop, Main, Receipt, Roster, Trends, Turn, Usage, View } from '../../types'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_DENIALS,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TRENDS,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  SCHEMA_VERSION,
  normalizeActivity,
  normalizeArchitect,
  normalizeAgents,
  normalizeDenials,
  normalizeLog,
  normalizeLoops,
  normalizeMain,
  normalizeReceipt,
  normalizeRoster,
  normalizeTrends,
  normalizeTurn,
  normalizeUsage,
  normalizeView,
} from './schema'

// One atom per key of PluginState['st-code'], each starting at its default. They are declared here,
// beside every read and write, because the host's scan only lists calls on atoms declared in the
// calling file; the plugin and key are literals for the same scan.
export const meta = atom({ plugin: 'st-code', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
export const main = atom({ plugin: 'st-code', key: 'main' } as const, DEFAULT_MAIN)
export const usage = atom({ plugin: 'st-code', key: 'usage' } as const, DEFAULT_USAGE)
export const turn = atom({ plugin: 'st-code', key: 'turn' } as const, DEFAULT_TURN)
export const receipt = atom({ plugin: 'st-code', key: 'receipt' } as const, null)
export const agents = atom({ plugin: 'st-code', key: 'agents' } as const, [])
export const loops = atom({ plugin: 'st-code', key: 'loops' } as const, [])
export const architect = atom({ plugin: 'st-code', key: 'architect' } as const, DEFAULT_ARCHITECT)
export const activity = atom({ plugin: 'st-code', key: 'activity' } as const, DEFAULT_ACTIVITY)
export const trends = atom({ plugin: 'st-code', key: 'trends' } as const, DEFAULT_TRENDS)
export const denials = atom({ plugin: 'st-code', key: 'denials' } as const, DEFAULT_DENIALS)
export const log = atom({ plugin: 'st-code', key: 'log' } as const, [])
export const view = atom({ plugin: 'st-code', key: 'view' } as const, DEFAULT_VIEW)
export const roster = atom({ plugin: 'st-code', key: 'roster' } as const, DEFAULT_ROSTER)

export type Snapshot = {
  main: Main
  usage: Usage
  turn: Turn
  receipt: Receipt | null
  agents: AgentCard[]
  loops: Loop[]
  architect: Architect
  activity: Activity
  trends: Trends
  denials: Denials
  log: LogLine[]
  view: View
  roster: Roster
}

/** Every key read once, so a frame is drawn from one consistent set of values. */
export async function loadSnapshot($: EngineInterface): Promise<Snapshot> {
  const [m, u, t, r, a, l, ar, ac, tr, d, lg, v, ro] = await Promise.all([
    read($, main),
    read($, usage),
    read($, turn),
    read($, receipt),
    read($, agents),
    read($, loops),
    read($, architect),
    read($, activity),
    read($, trends),
    read($, denials),
    read($, log),
    read($, view),
    read($, roster),
  ])
  return {
    main: normalizeMain(m),
    usage: normalizeUsage(u),
    turn: normalizeTurn(t),
    receipt: normalizeReceipt(r),
    agents: normalizeAgents(a),
    loops: normalizeLoops(l),
    architect: normalizeArchitect(ar),
    activity: normalizeActivity(ac),
    trends: normalizeTrends(tr),
    denials: normalizeDenials(d),
    log: normalizeLog(lg),
    view: normalizeView(v),
    roster: normalizeRoster(ro),
  }
}

/** A stored shape older than this build's: rewrite every key in the current shape. */
export async function migrate($: EngineInterface): Promise<void> {
  const stored = await read($, meta)
  const version = typeof stored?.schemaVersion === 'number' ? stored.schemaVersion : 0
  if (version >= SCHEMA_VERSION) return
  await update($, main, normalizeMain)
  await update($, usage, normalizeUsage)
  await update($, turn, normalizeTurn)
  await update($, receipt, normalizeReceipt)
  await update($, agents, normalizeAgents)
  await update($, loops, normalizeLoops)
  await update($, architect, normalizeArchitect)
  await update($, activity, normalizeActivity)
  await update($, trends, normalizeTrends)
  await update($, denials, normalizeDenials)
  await update($, log, normalizeLog)
  await update($, view, normalizeView)
  await update($, roster, normalizeRoster)
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

/**
 * `/st-code reset` and `/clear`: the session is the same, so what it spent and the trend line
 * stay; the context gauge waits for the next measurement instead of showing the pre-clear fill.
 */
export async function resetAll($: EngineInterface): Promise<void> {
  const keptMain = normalizeMain(await read($, main))
  await update($, main, () => ({ ...DEFAULT_MAIN, model: keptMain.model, mode: keptMain.mode }))
  await update($, usage, u => ({ ...normalizeUsage(u), pct: null, tokens: null, window: 0, lastCompactAt: null }))
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, activity, () => DEFAULT_ACTIVITY)
  await update($, denials, () => DEFAULT_DENIALS)
  await update($, log, () => [])
  await update($, view, () => DEFAULT_VIEW)
  await update($, roster, () => DEFAULT_ROSTER)
}
