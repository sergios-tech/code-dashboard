// The only place that reads or bulk-writes stored state: every value leaves here normalized.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Activity, AgentCard, Architect, Layout, LogKind, LogLine, LogMark, Loop, Main, Moment, Roster, Speed, ToolNote, Turn, Usage, View } from '../../types'
import { recordCall } from '../domain/activity'
import type { Call } from '../domain/activity'
import { addCard, applyStep, finishCard, finishLoop, noteTool, stepLoop } from '../domain/agents'
import { IDS_MAX, SEEN_MAX, endConsult, momentOf, startConsult } from '../domain/architect'
import { LINE_MAX, appendLog } from '../domain/log'
import { afterCall } from '../domain/turn'
import { usageFrom } from '../domain/vitals'
import { redact } from '../format/redact'
import { shorten } from '../format/text'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  SCHEMA_VERSION,
  normalizeActivity,
  normalizeArchitect,
  normalizeAgents,
  normalizeLog,
  normalizeLoops,
  normalizeMain,
  normalizeRoster,
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
export const agents = atom({ plugin: 'st-code', key: 'agents' } as const, [])
export const loops = atom({ plugin: 'st-code', key: 'loops' } as const, [])
export const architect = atom({ plugin: 'st-code', key: 'architect' } as const, DEFAULT_ARCHITECT)
export const activity = atom({ plugin: 'st-code', key: 'activity' } as const, DEFAULT_ACTIVITY)
export const log = atom({ plugin: 'st-code', key: 'log' } as const, [])
export const view = atom({ plugin: 'st-code', key: 'view' } as const, DEFAULT_VIEW)
export const roster = atom({ plugin: 'st-code', key: 'roster' } as const, DEFAULT_ROSTER)

export type Snapshot = {
  main: Main
  usage: Usage
  turn: Turn
  agents: AgentCard[]
  loops: Loop[]
  architect: Architect
  activity: Activity
  log: LogLine[]
  view: View
  roster: Roster
}

/** Every key read once, so a frame is drawn from one consistent set of values. */
export async function loadSnapshot($: EngineInterface): Promise<Snapshot> {
  const [m, u, t, a, l, ar, ac, lg, v, ro] = await Promise.all([
    read($, main),
    read($, usage),
    read($, turn),
    read($, agents),
    read($, loops),
    read($, architect),
    read($, activity),
    read($, log),
    read($, view),
    read($, roster),
  ])
  return {
    main: normalizeMain(m),
    usage: normalizeUsage(u),
    turn: normalizeTurn(t),
    agents: normalizeAgents(a),
    loops: normalizeLoops(l),
    architect: normalizeArchitect(ar),
    activity: normalizeActivity(ac),
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
  await update($, agents, normalizeAgents)
  await update($, loops, normalizeLoops)
  await update($, architect, normalizeArchitect)
  await update($, activity, normalizeActivity)
  await update($, log, normalizeLog)
  await update($, view, normalizeView)
  await update($, roster, normalizeRoster)
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

/**
 * `/st-code reset` and `/clear`: the session is the same, so what it spent stays; the context
 * gauge waits for the next measurement instead of showing the pre-clear fill.
 * The architect types offered stay too, as the agent listing is not sent again.
 */
export async function resetAll($: EngineInterface): Promise<void> {
  const keptMain = normalizeMain(await read($, main))
  await update($, main, () => ({ ...DEFAULT_MAIN, model: keptMain.model, mode: keptMain.mode }))
  await update($, usage, u => ({ ...normalizeUsage(u), pct: null, tokens: null, window: 0, lastCompactAt: null }))
  await update($, turn, () => DEFAULT_TURN)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, activity, () => DEFAULT_ACTIVITY)
  await update($, log, () => [])
  await update($, view, () => DEFAULT_VIEW)
}

/** One line into the session log, credentials masked before its text is cut to LINE_MAX, the log kept to its newest lines; `mark` is drawn after the text, never cut. */
export async function say($: EngineInterface, who: string, text: string, kind: LogKind = 'info', agentId: string | null = null, mark: LogMark | null = null): Promise<void> {
  const line: LogLine = { at: await $.clock.now(), who, text: shorten(redact(text), LINE_MAX), kind, agentId, mark }
  await update($, log, list => appendLog(normalizeLog(list), line))
}

/** The host's own reading of the context, cost and rate limits; none where the host has no usage or throws. */
async function readUsage($: EngineInterface) {
  try {
    return (await $.session.usage()) ?? null
  } catch {
    return null
  }
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

/** The main loop starts a turn: a fresh tally, and the loop is running. */
export async function beginTurn($: EngineInterface): Promise<void> {
  await update($, turn, () => DEFAULT_TURN)
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

/** The main loop's turn ended: the tally is cleared and the loop is idle. */
export async function endTurn($: EngineInterface): Promise<void> {
  await update($, turn, () => DEFAULT_TURN)
  await update($, main, m => ({ ...normalizeMain(m), isRunning: false }))
}

/**
 * One tool call added to the turn's tally (edits and the main loop's error streak); a call
 * that changes none of them writes nothing, so it costs no redraw.
 */
export async function noteTurnCall($: EngineInterface, c: Parameters<typeof afterCall>[1]): Promise<void> {
  const t = normalizeTurn(await read($, turn))
  const after = afterCall(t, c)
  if (after.edits === t.edits && after.errorStreak === t.errorStreak) return
  await update($, turn, x => afterCall(normalizeTurn(x), c))
}

/** One finished tool call in the session's tool and file tallies. */
export async function recordTool($: EngineInterface, c: Call): Promise<void> {
  await update($, activity, a => recordCall(normalizeActivity(a), c))
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
 * A consult opened now, at the moment the main turn's tally suggests. The moment, or null when a
 * consult of that id was already opened.
 */
export async function openConsult($: EngineInterface, id: string, via: string): Promise<Moment | null> {
  const [t, a, now] = await Promise.all([read($, turn), read($, architect), $.clock.now()])
  if (normalizeArchitect(a).consults.some(c => c.id === id)) return null
  const moment = momentOf(normalizeTurn(t))
  await update($, architect, x => startConsult(normalizeArchitect(x), { id, at: now, moment, via }))
  return moment
}

/** The open consult of `id` (else the latest open one) ended now, its advice the last when it gave some. */
export async function closeConsult($: EngineInterface, advice: string | null, id?: string): Promise<void> {
  const now = await $.clock.now()
  await update($, architect, x => endConsult(normalizeArchitect(x), now, advice, id))
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
