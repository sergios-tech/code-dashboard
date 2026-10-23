// The only place that reads or bulk-writes stored state: every value leaves here normalized.
import { read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Activity, AgentCard, Architect, Denials, LogLine, Loop, Main, Receipt, Roster, Trends, Turn, Usage, View } from '../../types'
import { activity, agents, architect, denials, log, loops, main, meta, receipt, roster, trends, turn, usage, view } from './atoms'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_DENIALS,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
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
