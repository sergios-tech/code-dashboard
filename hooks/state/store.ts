// The only place that reads or bulk-writes stored state: every value leaves here normalized.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Activity, AgentCard, Architect, Denials, Layout, LogKind, LogLine, LogMark, Loop, Main, Moment, Receipt, Roster, Speed, ToolNote, Trends, Turn, Usage, View } from '../../types'
import type { Config } from '../config'
import { recordCall } from '../domain/activity'
import type { Call } from '../domain/activity'
import { addCard, applyStep, finishCard, finishLoop, noteTool, stepLoop } from '../domain/agents'
import { IDS_MAX, SEEN_MAX, endConsult, momentOf, startConsult } from '../domain/architect'
import { appendLog } from '../domain/log'
import { statusText } from '../domain/status'
import { addSample, markCompaction } from '../domain/trends'
import { afterCall, receiptOf } from '../domain/turn'
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
 * The architect types offered stay too, as the agent listing is not sent again.
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
}

/** One line into the session log, credentials masked, the log kept to its newest lines; `mark` is drawn after the text, never cut. */
export async function say($: EngineInterface, who: string, text: string, kind: LogKind = 'info', agentId: string | null = null, mark: LogMark | null = null): Promise<void> {
  const line: LogLine = { at: await $.clock.now(), who, text: redact(text), kind, agentId, mark }
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

/**
 * The stored context and cost as one more point of the trend lines. A reading that has neither is
 * no point: the host reported nothing to draw.
 */
export async function takeSample($: EngineInterface): Promise<void> {
  const [u, now] = await Promise.all([read($, usage), $.clock.now()])
  const x = normalizeUsage(u)
  if (x.pct === null && x.costUsd === null) return
  await update($, trends, t => addSample(normalizeTrends(t), { at: now, ctxPct: x.pct, costUsd: x.costUsd }))
}

/** The next trend sample is the one after a compaction. */
export async function markTrendCompaction($: EngineInterface): Promise<void> {
  await update($, trends, t => markCompaction(normalizeTrends(t)))
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

/**
 * One tool call added to the turn's tally (edits, errors and the main loop's error streak); a call
 * that changes none of them writes nothing, so it costs no redraw.
 */
export async function noteTurnCall($: EngineInterface, c: Parameters<typeof afterCall>[1]): Promise<void> {
  const t = normalizeTurn(await read($, turn))
  const after = afterCall(t, c)
  if (after.edits === t.edits && after.errors === t.errors && after.errorStreak === t.errorStreak) return
  await update($, turn, x => afterCall(normalizeTurn(x), c))
}

/** One finished tool call in the session's tool and file tallies. */
export async function recordTool($: EngineInterface, c: Call): Promise<void> {
  await update($, activity, a => recordCall(normalizeActivity(a), c))
}

/** One refused tool call, for the status line's `denied N`. */
export async function countDenial($: EngineInterface): Promise<void> {
  await update($, denials, d => ({ count: normalizeDenials(d).count + 1 }))
}

/** `/st-code layout`: the person's layout choice, which wins over the configured one. */
export async function setLayout($: EngineInterface, layout: Layout): Promise<void> {
  await update($, view, v => ({ ...normalizeView(v), layout }))
}

/** Architect types remembered from the agent listing, the newest kept. */
const ROSTER_MAX = 20

/** An offered agent type that matches the architect pattern, remembered for when it is spawned. */
export async function noteArchitectType($: EngineInterface, type: string): Promise<void> {
  if (normalizeRoster(await read($, roster)).architectTypes.includes(type)) return
  await update($, roster, r => {
    const x = normalizeRoster(r)
    return x.architectTypes.includes(type) ? x : { architectTypes: [...x.architectTypes, type].slice(-ROSTER_MAX) }
  })
}

/** Whether a type was offered as the architect's, by its name or, with `matchDescriptions`, its description. */
export async function isOfferedArchitect($: EngineInterface, type: string): Promise<boolean> {
  return normalizeRoster(await read($, roster)).architectTypes.includes(type)
}

/** The architect as stored now. */
export async function readArchitect($: EngineInterface): Promise<Architect> {
  return normalizeArchitect(await read($, architect))
}

/** Whether a loop is a spawned architect's. */
export async function isArchitectId($: EngineInterface, id: string): Promise<boolean> {
  return normalizeArchitect(await read($, architect)).ids.includes(id)
}

/** A spawned architect: its id is kept, so its loop is neither a card nor among the other loops. */
export async function addArchitectId($: EngineInterface, id: string): Promise<void> {
  await update($, architect, a => {
    const x = normalizeArchitect(a)
    return x.ids.includes(id) ? x : { ...x, ids: [...x.ids, id].slice(-IDS_MAX) }
  })
  if (normalizeLoops(await read($, loops)).some(l => l.id === id)) {
    await update($, loops, l => normalizeLoops(l).filter(x => x.id !== id))
  }
}

/** A server tool call remembered the first time it is read; true then, false for one read before. */
export async function markSeen($: EngineInterface, id: string): Promise<boolean> {
  if (normalizeArchitect(await read($, architect)).seen.includes(id)) return false
  let isNew = false
  await update($, architect, a => {
    const x = normalizeArchitect(a)
    isNew = !x.seen.includes(id)
    return isNew ? { ...x, seen: [...x.seen, id].slice(-SEEN_MAX) } : x
  })
  return isNew
}

/**
 * A consult opened now, at the moment the main turn's tally suggests; one asked before done puts
 * the turn under review. The moment, or null when a consult of that id was already opened.
 */
export async function openConsult($: EngineInterface, id: string, via: string): Promise<Moment | null> {
  const [t, a, now] = await Promise.all([read($, turn), read($, architect), $.clock.now()])
  if (normalizeArchitect(a).consults.some(c => c.id === id)) return null
  const moment = momentOf(normalizeTurn(t))
  await update($, architect, x => startConsult(normalizeArchitect(x), { id, at: now, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalizeTurn(x), isReviewing: true }))
  return moment
}

/**
 * The open consult of `id` (else the latest open one) ended now, its advice the last when it gave
 * some. The turn stays under review only while a consult asked before done is still open.
 */
export async function closeConsult($: EngineInterface, advice: string | null, id?: string): Promise<void> {
  const now = await $.clock.now()
  const a = normalizeArchitect(await update($, architect, x => endConsult(normalizeArchitect(x), now, advice, id)))
  const isReviewing = a.consults.some(c => c.endAt === null && c.moment === 'before done')
  if (!isReviewing) await update($, turn, x => ({ ...normalizeTurn(x), isReviewing: false }))
}

/** Advice that arrived outside a consult's end; true when it differs from the last. */
export async function storeAdvice($: EngineInterface, advice: string): Promise<boolean> {
  if (advice === '' || normalizeArchitect(await read($, architect)).lastAdvice === advice) return false
  await update($, architect, a => ({ ...normalizeArchitect(a), lastAdvice: advice }))
  return true
}

/** A spawned subagent's card, newest last; its id no longer counts among the other loops. */
export async function addAgent($: EngineInterface, card: AgentCard): Promise<void> {
  await update($, agents, list => addCard(normalizeAgents(list), card))
  if (normalizeLoops(await read($, loops)).some(l => l.id === card.id)) {
    await update($, loops, l => normalizeLoops(l).filter(x => x.id !== card.id))
  }
}

/** One finished model request of a subagent, as `applyStep` takes it. */
export type AgentStep = Parameters<typeof applyStep>[1]

/**
 * A subagent's model request ended: its card counts it, or, for a loop no card claims and that is
 * not the architect's, the other loops do. The card after the step, or null when there is none.
 */
export async function noteAgentStep($: EngineInterface, id: string, step: AgentStep): Promise<AgentCard | null> {
  const card = normalizeAgents(await read($, agents)).find(c => c.id === id)
  if (card) {
    await update($, agents, list => normalizeAgents(list).map(c => (c.id === id ? applyStep(c, step) : c)))
    return applyStep(card, step)
  }
  if (normalizeArchitect(await read($, architect)).ids.includes(id)) return null
  const now = await $.clock.now()
  await update($, loops, l => stepLoop(normalizeLoops(l), id, now))
  return null
}

/**
 * A subagent's run ended: its card takes the status and the start of the answer, or its loop is
 * marked done. The finished card, or null when the id has none.
 */
export async function finishAgent($: EngineInterface, id: string, reason: string, answer: string): Promise<AgentCard | null> {
  const now = await $.clock.now()
  const card = normalizeAgents(await read($, agents)).find(c => c.id === id)
  if (card) {
    await update($, agents, list => normalizeAgents(list).map(c => (c.id === id ? finishCard(c, reason, answer, now) : c)))
    return finishCard(card, reason, answer, now)
  }
  if (normalizeLoops(await read($, loops)).some(l => l.id === id)) {
    await update($, loops, l => finishLoop(normalizeLoops(l), id, now))
  }
  return null
}

/** A subagent's tool call among its card's last three; the card it was noted on, or null when the loop has none. */
export async function noteAgentTool($: EngineInterface, id: string, note: ToolNote): Promise<AgentCard | null> {
  const card = normalizeAgents(await read($, agents)).find(c => c.id === id)
  if (!card) return null
  await update($, agents, list => normalizeAgents(list).map(c => (c.id === id ? noteTool(c, note) : c)))
  return noteTool(card, note)
}

/** A card's hotkey: its expanded block opens, or closes when it was the one open. */
export async function toggleExpanded($: EngineInterface, id: string): Promise<void> {
  await update($, view, v => {
    const x = normalizeView(v)
    return { ...x, expanded: x.expanded === id ? null : id }
  })
}
