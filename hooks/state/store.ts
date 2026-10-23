// The only place that reads or bulk-writes stored state: every value leaves here normalized.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Activity, AgentCard, Architect, Denials, Layout, LogKind, LogLine, Loop, Main, Receipt, Roster, Speed, Trends, Turn, Usage, View } from '../../types'
import type { Config } from '../config'
import { appendLog } from '../domain/log'
import { statusText } from '../domain/status'
import { receiptOf } from '../domain/turn'
import { usageFrom } from '../domain/vitals'
import { redact } from '../format/redact'
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

/** One line into the session log, credentials masked, the log kept to its newest lines. */
export async function say($: EngineInterface, who: string, text: string, kind: LogKind = 'info', agentId: string | null = null): Promise<void> {
  const line: LogLine = { at: await $.clock.now(), who, text: redact(text), kind, agentId }
  await update($, log, list => appendLog(normalizeLog(list), line))
}

/** The status line under the prompt, from what is stored now; none when it is switched off or has nothing to say. */
export async function refreshStatus($: EngineInterface, cfg: Config): Promise<void> {
  if (!cfg.statusLine) {
    $.ui.status(undefined)
    return
  }
  const [u, a, ar, d] = await Promise.all([read($, usage), read($, agents), read($, architect), read($, denials)])
  $.ui.status(statusText({ usage: normalizeUsage(u), agents: normalizeAgents(a), architect: normalizeArchitect(ar), denials: normalizeDenials(d) }, cfg))
}

/** The host's own reading of the context, cost and rate limits; none where the host has no usage or throws. */
async function readUsage($: EngineInterface) {
  try {
    return (await $.session.usage()) ?? null
  } catch {
    return null
  }
}

/** The session's cost read fresh, not from the last measurement: a receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const c = (await readUsage($))?.cost?.usd
  return typeof c === 'number' && Number.isFinite(c) ? c : null
}

/**
 * The host's own reading of the context, cost and rate limits, stored as the first measurement.
 * A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
 */
export async function takeUsageReading($: EngineInterface): Promise<void> {
  const u = await readUsage($)
  if (u) await update($, usage, x => usageFrom(u, normalizeUsage(x)))
}

/** A `session.measure` reading, stored over the last one. */
export async function applyMeasure($: EngineInterface, reading: Parameters<typeof usageFrom>[0]): Promise<void> {
  await update($, usage, x => usageFrom(reading, normalizeUsage(x)))
}

/** One compaction of the main conversation, counted and timed. */
export async function noteCompaction($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, usage, x => {
    const u = normalizeUsage(x)
    return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
  })
}

/** The permission mode the main loop runs in, when the event names one. */
export async function noteMode($: EngineInterface, mode: string | undefined): Promise<void> {
  if (typeof mode !== 'string' || mode === '') return
  await update($, main, m => ({ ...normalizeMain(m), mode }))
}

/** The main loop starts a turn: a fresh tally from now, with the session cost to subtract at the end. */
export async function beginTurn($: EngineInterface): Promise<void> {
  const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
  await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
  await update($, main, m => ({ ...normalizeMain(m), isRunning: true }))
}

/** The main loop starts a model request: its model and effort are known now, and it counts. */
export async function beginRequest($: EngineInterface, model: string, effort: string | number | undefined): Promise<void> {
  await update($, main, m => {
    const x = normalizeMain(m)
    return {
      ...x,
      model: typeof model === 'string' && model !== '' ? model : x.model,
      effort: effort === undefined ? x.effort : String(effort),
      steps: x.steps + 1,
    }
  })
}

/** The speed of the main loop's last request. */
export async function storeSpeed($: EngineInterface, speed: Speed): Promise<void> {
  await update($, main, m => ({ ...normalizeMain(m), speed }))
}

/** The main loop's turn ended: its receipt is stored, the loop is idle and no review is under way. */
export async function endTurn($: EngineInterface, o: { durationMs: number; reason: string }): Promise<void> {
  const [t, cards, cost] = await Promise.all([read($, turn), read($, agents), costNow($)])
  const tally = normalizeTurn(t)
  const agentsSince = normalizeAgents(cards).filter(c => c.spawnedAt >= tally.startedAt).length
  await update($, receipt, () => receiptOf(tally, { durationMs: o.durationMs, agentsSince, costNow: cost, reason: o.reason }))
  await update($, turn, x => ({ ...normalizeTurn(x), isReviewing: false }))
  await update($, main, m => ({ ...normalizeMain(m), isRunning: false }))
}

/** `/st-code layout`: the person's layout choice, which wins over the configured one. */
export async function setLayout($: EngineInterface, layout: Layout): Promise<void> {
  await update($, view, v => ({ ...normalizeView(v), layout }))
}
