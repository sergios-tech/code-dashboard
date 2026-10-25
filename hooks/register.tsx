// The one hooks module: the plugin's atoms, every helper that reads or writes them or calls `$`,
// and each hook, written in the `on(...)` call that registers it, so the host's scan reads all of
// them off this file. What the hooks work out is pure and lives in domain/, format/ and view/.
import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, ApiContentBlock, EngineInterface, EventResult, Register, RenderElement, SessionUsage, Timer } from 'claude-code'

import type { AgentCard, Architect, Layout, LogKind, LogLine, LogMark, Moment, Speed, ToolNote } from '../types'
import { parseConfig } from './config'
import type { Config } from './config'
import { recordCall, timedMs } from './domain/activity'
import type { Call } from './domain/activity'
import { LOOP_ACTIVE_MS, addCard, applyStep, finishCard, finishLoop, newCard, noteTool, stepLoop, whoOf } from './domain/agents'
import {
  IDS_MAX,
  SEEN_MAX,
  adviceLine,
  endConsult,
  handbackOf,
  isAdvisorUse,
  isServerResult,
  momentOf,
  startConsult,
  viaOf,
  whoOf as architectWho,
} from './domain/architect'
import { LINE_MAX, appendLog, promptLine } from './domain/log'
import { EDIT_TOOLS, afterCall } from './domain/turn'
import { stepSpeed, usageFrom } from './domain/vitals'
import { describeInput, redact } from './format/redact'
import { fmtDuration, shorten } from './format/text'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_SESSION,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  LAYOUTS,
  SCHEMA_VERSION,
  normalizeActivity,
  normalizeArchitect,
  normalizeAgents,
  normalizeLog,
  normalizeLoops,
  normalizeMain,
  normalizeRoster,
  normalizeSession,
  normalizeTurn,
  normalizeUsage,
  normalizeView,
} from './state/schema'
import type { Snapshot } from './state/schema'
import type { Draw } from './view/draw'
import { header } from './view/header'
import { miniPane } from './view/mini'
import { buildViewModel } from './view/model'
import { COLORS } from './view/palette'
import type { Expand } from './view/panels/agents'
import { body } from './view/pane'
import { pictures } from './view/picture'

// ---------------------------------------------------------------- atoms
//
// One atom per key of PluginState['st-code-display'], each starting at its default. They are declared here,
// beside every read and write, because the host's scan only lists calls on atoms declared in the
// calling file; the plugin and key are literals for the same scan.

export const meta = atom({ plugin: 'st-code-display', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
export const main = atom({ plugin: 'st-code-display', key: 'main' } as const, DEFAULT_MAIN)
export const usage = atom({ plugin: 'st-code-display', key: 'usage' } as const, DEFAULT_USAGE)
export const turn = atom({ plugin: 'st-code-display', key: 'turn' } as const, DEFAULT_TURN)
export const agents = atom({ plugin: 'st-code-display', key: 'agents' } as const, [])
export const loops = atom({ plugin: 'st-code-display', key: 'loops' } as const, [])
export const architect = atom({ plugin: 'st-code-display', key: 'architect' } as const, DEFAULT_ARCHITECT)
export const activity = atom({ plugin: 'st-code-display', key: 'activity' } as const, DEFAULT_ACTIVITY)
export const log = atom({ plugin: 'st-code-display', key: 'log' } as const, [])
export const view = atom({ plugin: 'st-code-display', key: 'view' } as const, DEFAULT_VIEW)
export const roster = atom({ plugin: 'st-code-display', key: 'roster' } as const, DEFAULT_ROSTER)
export const session = atom({ plugin: 'st-code-display', key: 'session' } as const, DEFAULT_SESSION)

// ---------------------------------------------------------------- state
//
// The only place that reads or bulk-writes stored state: every value leaves here normalized. The
// tests drive the atoms and some of these helpers directly, so those are exported.

/** Every key read once, so a frame is drawn from one consistent set of values. */
export async function loadSnapshot($: EngineInterface): Promise<Snapshot> {
  const [m, u, t, a, l, ar, ac, lg, v, ro, se] = await Promise.all([
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
    read($, session),
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
    session: normalizeSession(se),
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
  await update($, session, normalizeSession)
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

/**
 * `/st-code-display reset` and `/clear`: the session is the same, so what it spent stays; the context
 * gauge waits for the next measurement instead of showing the pre-clear fill.
 * The architect types offered stay too, as the agent listing is not sent again, and so does
 * the session's start time, which the log's times count from.
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

/** The session's start, noted once: a reload runs `session.start` again, and `/clear` and `/st-code-display reset` keep the same session. */
async function noteSessionStart($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, session, x => {
    const s = normalizeSession(x)
    return s.startedAt === null ? { startedAt: now } : s
  })
}

/** One line into the session log, credentials masked before its text is cut to LINE_MAX, the log kept to its newest lines; `mark` is drawn after the text, never cut. */
async function say($: EngineInterface, who: string, text: string, kind: LogKind = 'info', agentId: string | null = null, mark: LogMark | null = null): Promise<void> {
  const line: LogLine = { at: await $.clock.now(), who, text: shorten(redact(text), LINE_MAX), kind, agentId, mark }
  await update($, log, list => appendLog(normalizeLog(list), line))
}

/** A `session.measure` reading, or the host's own first reading at the session's start, stored over the last one. */
async function applyMeasure($: EngineInterface, reading: Parameters<typeof usageFrom>[0]): Promise<void> {
  await update($, usage, x => usageFrom(reading, normalizeUsage(x)))
}

/** One compaction of the main conversation, counted and timed. */
async function noteCompaction($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, usage, x => {
    const u = normalizeUsage(x)
    return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
  })
}

/** The permission mode the main loop runs in, when the event names one. */
async function noteMode($: EngineInterface, mode: string | undefined): Promise<void> {
  if (typeof mode !== 'string' || mode === '') return
  await update($, main, m => ({ ...normalizeMain(m), mode }))
}

/** The main loop starts a turn: a fresh tally, and the loop is running. */
async function beginTurn($: EngineInterface): Promise<void> {
  await update($, turn, () => DEFAULT_TURN)
  await update($, main, m => ({ ...normalizeMain(m), isRunning: true }))
}

/** The main loop starts a model request: its model and effort are known now, and it counts. */
async function beginRequest($: EngineInterface, model: string, effort: string | number | undefined): Promise<void> {
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
async function storeSpeed($: EngineInterface, speed: Speed): Promise<void> {
  await update($, main, m => ({ ...normalizeMain(m), speed }))
}

/** The main loop's turn ended: the tally is cleared and the loop is idle. */
async function endTurn($: EngineInterface): Promise<void> {
  await update($, turn, () => DEFAULT_TURN)
  await update($, main, m => ({ ...normalizeMain(m), isRunning: false }))
}

/**
 * One tool call added to the turn's tally (edits and the main loop's error streak); a call
 * that changes none of them writes nothing, so it costs no redraw.
 */
async function noteTurnCall($: EngineInterface, c: Parameters<typeof afterCall>[1]): Promise<void> {
  const t = normalizeTurn(await read($, turn))
  const after = afterCall(t, c)
  if (after.edits === t.edits && after.errorStreak === t.errorStreak) return
  await update($, turn, x => afterCall(normalizeTurn(x), c))
}

/** One finished tool call in the session's tool and file tallies. */
async function recordTool($: EngineInterface, c: Call): Promise<void> {
  await update($, activity, a => recordCall(normalizeActivity(a), c))
}

/** `/st-code-display layout`: the person's layout choice, which wins over the configured one. */
async function setLayout($: EngineInterface, layout: Layout): Promise<void> {
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
async function isOfferedArchitect($: EngineInterface, type: string): Promise<boolean> {
  return normalizeRoster(await read($, roster)).architectTypes.includes(type)
}

/** The agent cards as stored now. */
async function readAgents($: EngineInterface): Promise<AgentCard[]> {
  return normalizeAgents(await read($, agents))
}

/** The architect as stored now. */
async function readArchitect($: EngineInterface): Promise<Architect> {
  return normalizeArchitect(await read($, architect))
}

/** Whether a loop is a spawned architect's. */
async function isArchitectId($: EngineInterface, id: string): Promise<boolean> {
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
async function openConsult($: EngineInterface, id: string, via: string): Promise<Moment | null> {
  const [t, a, now] = await Promise.all([read($, turn), read($, architect), $.clock.now()])
  if (normalizeArchitect(a).consults.some(c => c.id === id)) return null
  const moment = momentOf(normalizeTurn(t))
  await update($, architect, x => startConsult(normalizeArchitect(x), { id, at: now, moment, via }))
  return moment
}

/** The open consult of `id` (else the latest open one) ended now, its advice the last when it gave some. */
async function closeConsult($: EngineInterface, advice: string | null, id?: string): Promise<void> {
  const now = await $.clock.now()
  await update($, architect, x => endConsult(normalizeArchitect(x), now, advice, id))
}

/** Advice that arrived outside a consult's end; true when it differs from the last. */
async function storeAdvice($: EngineInterface, advice: string): Promise<boolean> {
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
type AgentStep = Parameters<typeof applyStep>[1]

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
async function noteAgentTool($: EngineInterface, id: string, note: ToolNote): Promise<AgentCard | null> {
  const card = normalizeAgents(await read($, agents)).find(c => c.id === id)
  if (!card) return null
  await update($, agents, list => normalizeAgents(list).map(c => (c.id === id ? noteTool(c, note) : c)))
  return noteTool(card, note)
}

/** A card's hotkey: its expanded block opens, or closes when it was the one open. */
async function toggleExpanded($: EngineInterface, id: string): Promise<void> {
  await update($, view, v => {
    const x = normalizeView(v)
    return { ...x, expanded: x.expanded === id ? null : id }
  })
}

// ---------------------------------------------------------------- architect
//
// The on-call architect. A consult opens when an architect agent is spawned or a server-side
// advisor tool shows in the main loop's replies, and closes when that agent's run ends or the
// tool's result arrives. Its advice comes from the run's answer, from the agent's hand-back tool
// call, or from the hand-back turn it opens in the main loop.

/** A consult opened: logged at the moment it is inferred at, or plainly with the moments switched off. */
async function beginConsult($: EngineInterface, cfg: Config, id: string, via: string): Promise<void> {
  const moment = await openConsult($, id, via)
  if (moment === null) return
  await say($, architectWho(cfg), cfg.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
}

/**
 * The consult `id` (else the latest open one) ended with `report`, its advice its first line. One
 * already closed is left as it is, and so is advice the log already has.
 */
async function finishConsult($: EngineInterface, cfg: Config, report: string | null, id?: string): Promise<void> {
  const a = await readArchitect($)
  const isOpen = a.consults.some(c => c.endAt === null && (id === undefined || c.id === id))
  const advice = report ? adviceLine(report) : ''
  const isNew = advice !== '' && advice !== a.lastAdvice
  if (!isOpen && !isNew) return
  await closeConsult($, advice || null, id)
  await say($, architectWho(cfg), isNew ? `advice: ${advice}` : 'advice returned', 'consult')
}

/** A spawned architect agent: followed as a consult under its id, never as a card or a loop. */
async function architectSpawned($: EngineInterface, cfg: Config, id: string, type: string): Promise<void> {
  await addArchitectId($, id)
  await beginConsult($, cfg, id, viaOf(type))
}

/**
 * A report handed back by agent `from`: when it is an architect's, its first line is the advice
 * (logged once however many ways it arrives). False when `from` is no architect.
 */
async function handedBack($: EngineInterface, cfg: Config, from: string, report: string): Promise<boolean> {
  if (!(await isArchitectId($, from))) return false
  const advice = adviceLine(report)
  if (await storeAdvice($, advice)) await say($, architectWho(cfg), `advice: ${advice}`, 'consult')
  return true
}

/** One row of the model's reply, in order: an advisor call opens a consult, and its result, here or in a later row, closes it. */
async function readServerTools($: EngineInterface, cfg: Config, content: readonly ApiContentBlock[]): Promise<void> {
  for (const b of content) {
    if (isAdvisorUse(cfg, b)) {
      if (await markSeen($, b.id)) await beginConsult($, cfg, b.id, `${b.name} tool`)
    } else if (isServerResult(b)) {
      await finishConsult($, cfg, null, b.tool_use_id)
    }
  }
}

/**
 * Whether a spawn is the on-call architect, which is followed as a consult instead of as a card:
 * its type matches the architect pattern, or was remembered from the agent listing as matching.
 */
async function isArchitectSpawn($: EngineInterface, cfg: Config, e: AgentSpawnInput): Promise<boolean> {
  return cfg.architect.test(e.subagentType) || (await isOfferedArchitect($, e.subagentType))
}

// ---------------------------------------------------------------- hooks

/** The pane's title, as the host frames it. */
const TITLE = "Sergio's Tech · Code Display"
/** `/st-code-display`'s answer to arguments it does not take. */
const USAGE = 'Usage: /st-code-display [open|close|reset|layout auto|compact|wide|mini]'

/** The keys a `tool.call` input carries for the engine beside the tool's own arguments. */
const CALL_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])

/** A call's own arguments, as its permission check reads them: its input without the engine's keys. */
const toolArgs = (input: object): Record<string, unknown> => Object.fromEntries(Object.entries(input).filter(([k]) => !CALL_KEYS.has(k)))

/** The redraw due when the loops last heard from stop counting as running. */
let quiet: Timer | null = null

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)

  // The session's start and end: bring stored state up to date, take a first reading, open the
  // pane, and start over on `/clear`.
  on('session.start', async ($, e, next) => {
    // `/st-code-display` is declared here, as a plugin may hook `session.start` only once.
    await $.command.register({
      name: 'st-code-display',
      description: "Sergio's Tech Code Display: open, close, reset, or set the layout",
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
    await noteSessionStart($)
    // The host's own reading of the context, cost and rate limits, stored as the first measurement.
    // A host without usage (headless, an SDK host, a session not yet bound), or one that throws,
    // just starts without it.
    let reading: SessionUsage | null = null
    try {
      reading = (await $.session.usage()) ?? null
    } catch {
      reading = null
    }
    if (reading) await applyMeasure($, reading)
    // Opening can wait on the host's layout; the session does not wait for it. Columns apply when
    // docked beside the transcript, rows when seated inline above the prompt.
    if (cfg.openOnStart) void $.ui.open({ id: 'st-code-display', title: TITLE, columns: 66, rows: 8 }).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A `/clear` keeps the process and the pane but not the conversation they described.
    if (e.reason === 'clear') await resetAll($)
    return next(e)
  })

  // The `/st-code-display` command: open, close, reset, or choose the layout.
  on('command.run', { command: 'st-code-display' }, async ($, e, next) => {
    const [first = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const verb = first === '' ? 'open' : first

    if (verb === 'close') {
      await $.ui.close({ id: 'st-code-display' })
      return { text: 'Dashboard closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      return { text: 'Dashboard reset.' }
    }
    if (verb === 'layout') {
      const layout = LAYOUTS.find(l => l === arg)
      if (!layout) return { text: USAGE }
      await setLayout($, layout)
      const opened = await $.ui.open({ id: 'st-code-display', title: TITLE, columns: 66, rows: 8 })
      return { text: opened.isPlaced ? `Dashboard layout: ${layout}.` : `Layout set to ${layout}; the dashboard is not shown yet: ${opened.reason}` }
    }
    if (verb === 'open') {
      const opened = await $.ui.open({ id: 'st-code-display', title: TITLE, columns: 66, rows: 8 })
      if (!opened.isPlaced) return { text: `The dashboard is not shown yet: ${opened.reason}` }
      return { text: 'Dashboard opened. Focus it with ctrl+x tab; 1-6 expand agents.' }
    }
    return { text: USAGE }
  })

  // Turns in every loop. The main loop's opening text goes into the log (or, for an architect's
  // hand-back, its advice), its requests are timed as they stream, and its end clears the turn's
  // tally. A subagent's requests fill its card (or count among the other loops when no card claims
  // it and it is not the architect's), and its end settles the card, or the architect's consult,
  // and is logged.

  // The permission mode rides on the person's prompt; read it and pass the event on.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's first prompt is the spawn's, which the agent log lines will cover.
    if (!e.agentId) {
      await beginTurn($)
      if (typeof e.text === 'string' && e.text.trim() !== '') {
        // A background architect's report reaches the main loop as the text opening this turn. Its
        // hand-back tool call normally carries the advice first; this is the fallback.
        const back = handbackOf(e.text)
        if (!back || !(await handedBack($, cfg, back.from, back.body))) {
          const cards = await readAgents($)
          const p = promptLine(e.text, id => cards.find(c => c.id === id))
          await say($, p.who, p.text, 'info', p.agentId ?? null)
        }
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const id = e.agentId
      const result = yield* next(e)
      // The model that answered, as the API reports it, else the one the request named. An
      // architect's requests belong to its consult: they make neither a card nor a loop.
      const card = await noteAgentStep($, id, { model: result.usage?.model || e.model, usage: result.usage, stopReason: result.stopReason })
      if (card && result.stopReason === 'max_tokens') await say($, whoOf(card), 'hit max_tokens', 'error', id, '✗')
      // A loop no card claims counts as running until LOOP_ACTIVE_MS after its last step, and no event
      // need come when it falls quiet, so the pane is drawn again then; a later step moves the redraw on.
      if (!card) {
        quiet?.cancel()
        quiet = $.clock.after(LOOP_ACTIVE_MS, () => $.ui.invalidate('ui.render'))
      }
      return result
    }
    // The main loop's model and effort are known when its request starts, so a long first request does not read `—`.
    await beginRequest($, e.model, e.effort)
    // Time the response as it passes: its first chunk (the engine's envelope as a rule), the first
    // piece that is not the envelope, then the stop chunk. The rate runs from the first chunk, since
    // thinking that streams no text comes before the first piece and its tokens count. At most three
    // clock reads in the stream, and nothing stored until it has ended.
    const sentAt = await $.clock.now()
    let startAt: number | null = null
    let firstAt: number | null = null
    let stopAt: number | null = null
    const s = next(e)
    for await (const c of s) {
      const isFirstPiece = firstAt === null && c.kind !== 'engine' && c.kind !== 'stop'
      if (startAt === null || isFirstPiece || c.kind === 'stop') {
        const now = await $.clock.now()
        startAt ??= now
        if (isFirstPiece) firstAt = now
        if (c.kind === 'stop') stopAt = now
      }
      yield c
    }
    const result = await s.result
    const speed = result.usage && stopAt !== null ? stepSpeed(sentAt, firstAt, stopAt, result.usage.output_tokens, startAt) : null
    if (speed) await storeSpeed($, speed)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      await endTurn($)
      return done
    }
    const id = e.agentId
    // The architect's run ending closes its consult, and its answer is the advice.
    if (await isArchitectId($, id)) {
      await finishConsult($, cfg, e.answer, id)
      return done
    }
    const card = await finishAgent($, id, e.reason, e.answer)
    if (card) {
      const took = card.spawnedAt > 0 && card.endedAt !== null ? ` · ${fmtDuration(card.endedAt - card.spawnedAt)}` : ''
      if (card.status === 'done') await say($, whoOf(card), `done${took}`, 'done', id)
      else if (card.status === 'failed') await say($, whoOf(card), card.status, 'error', id, '✗')
      else await say($, whoOf(card), card.status, 'info', id)
    }
    return done
  })

  // Subagents as they start: which offered agent types are the architect's, a consult for an
  // architect's spawn and a card for every other. Their steps and ends are followed by turn.step
  // and turn.complete, beside the main loop's.

  // The agent listing names each type the model may call; architect types are remembered by name.
  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) await noteArchitectType($, e.agent)
    return offered
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    // A refused spawn started nothing, and one without an id has no loop to follow.
    if (started.deny !== undefined || !started.agentId) return started
    // A workflow script's agents belong to its run: they show among the other loops as they step.
    if (e.workflow !== undefined) return started
    if (await isArchitectSpawn($, cfg, e)) {
      await architectSpawned($, cfg, started.agentId, e.subagentType)
      return started
    }
    const card = newCard({ id: started.agentId, type: e.name ?? e.subagentType, model: started.model, description: e.description, at: await $.clock.now() })
    await addAgent($, card)
    await say($, whoOf(card), `spawned · ${card.type}`, 'info', card.id)
    return started
  })

  // A server-side advisor never reaches tool.call: it shows only as blocks of the main loop's replies.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant' && Array.isArray(e.message.content)) await readServerTools($, cfg, e.message.content)
    return next(e)
  })

  // A background agent hands its report back through this tool. No built-in list names it, so it is
  // matched by pattern, and every other call passes this hook by.
  on('tool.call', { tool: /^SubagentHandback$/ }, async ($, e, next) => {
    const ran = await next(e)
    const message = (e as { message?: unknown }).message
    if (ran.deny === undefined && e.agentId && typeof message === 'string') await handedBack($, cfg, e.agentId, message)
    return ran
  })

  // Tool calls in every loop: counted per tool and per file for TOOLS & FILES, timed when nothing
  // but the tool ran inside them, added to the turn's tally and to the calling subagent's card, and
  // logged when they edit, fail or are refused.
  on('tool.call', async ($, e, next) => {
    // A hand-back is the SubagentHandback hook's to read, and is no tool work.
    if (String(e.tool) === 'SubagentHandback') return next(e)
    // The engine's verdict on the call, asked before the clock is read, so the query is not timed. A
    // refusal at the call's own check reaches the call as an error result rather than a deny, so the
    // verdict is the only way to tell it from a tool that failed. A query that fails leaves the
    // verdict unknown, and the call runs all the same.
    let verdict: EventResult<'tool.check'>['decision'] | null = null
    try {
      verdict = (await $.tool.check({ tool: e.tool, input: toolArgs(e) })).decision
    } catch {
      verdict = null
    }
    const sentAt = await $.clock.now()
    const ran = await next(e)
    const at = await $.clock.now()
    const isAsked = verdict === 'ask'
    const isDenied = verdict === 'deny' || ran.deny !== undefined
    const didRun = !isDenied
    const hasFailed = didRun && ran.isError === true
    const inSubagent = Boolean(e.agentId)
    await recordTool($, { tool: e.tool, input: e, hasFailed, inSubagent, didRun, ms: timedMs(didRun, isAsked, e.tool, at - sentAt), at })
    // An answered Agent call is its subagent's to report: the card, its turns and its end.
    if (e.tool === 'Agent' && !isDenied) return ran

    const isEdit = didRun && !hasFailed && EDIT_TOOLS.has(e.tool)
    await noteTurnCall($, { inSubagent, hasFailed, isEdit })
    // A call as the log and the cards name it, `Edit → src/main.ts`; each keeps as much as it holds.
    const text = describeInput(e.tool, e)
    const card = e.agentId ? await noteAgentTool($, e.agentId, { tool: e.tool, text, isError: hasFailed || isDenied }) : null
    const who = card ? whoOf(card) : e.agentId ? 'agent' : 'main'
    const agentId = e.agentId ?? null
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    // The marker is stored apart from the text, so a narrow pane cuts the command and keeps it.
    if (isDenied) {
      await say($, who, text, 'error', agentId, '· denied')
    } else if (hasFailed) {
      await say($, who, text, 'error', agentId, '✗')
    } else if (isEdit) {
      await say($, who, text, 'info', agentId)
    }
    return ran
  })

  // The host's measurements of the session: context, cost and rate limits, and compactions.
  on('session.measure', async ($, e, next) => {
    await applyMeasure($, e)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // A vetoed compaction changed nothing, a precompute installs nothing, and a subagent's is its own.
    if (!('skip' in done && done.skip !== undefined) && !e.agentId && e.trigger !== 'precompute') {
      await noteCompaction($)
      await say($, 'main', `context compacted (${e.trigger})`)
    }
    return done
  })

  // The pane's drawing: one state snapshot, one view model, then the header and the panels in one
  // column, in two with the log under both, or the inline summary instead of all of them. Off the
  // terminal each of those blocks is drawn as a picture of its cells.
  on('ui.render', { component: 'Pane', requestId: 'st-code-display' }, async ($, e, next) => {
    const els = $.ui.resolve(e)
    const [s, now] = await Promise.all([loadSnapshot($), $.clock.now()])
    const isPicture = e.surface !== 'terminal'
    const vm = buildViewModel(s, {
      cfg,
      now,
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      viewedAgentId: e.props.view?.agentId ?? null,
      bodyRows: e.props.scroll?.bodyRows ?? e.viewport?.rows,
      isPicture,
    })
    // VS Code's webview takes no client modules, whatever its element table holds.
    const hasClient = 'Client' in els && e.surface !== 'vscode'
    const d: Draw = { els, C: COLORS, hasClient, motion: cfg.motion, surface: e.surface, isPicture, now, isIdle: !vm.header.isActive }
    // An agent's hotkey opens its details inside the AGENTS frame, or closes them.
    const expand: Expand = id => () => toggleExpanded($, id)
    const { Box } = els
    // The OLED black is filled in rather than left to the host's pane colour. Docked, it fills every
    // body row, not only the rows the panels take: the dark-ansi theme paints the dock bright black.
    if (!d.isPicture) {
      const fillRows = e.props.placement === 'dock' ? e.props.scroll?.bodyRows : undefined
      if (vm.mini) return miniPane(d, vm.mini, vm.width, fillRows)
      return (
        <Box flexDirection="column" width={vm.width} minHeight={fillRows} backgroundColor={COLORS.fill}>
          {header(d, vm.header, vm.width)}
          {body(d, vm, expand)}
        </Box>
      )
    }
    // Off the terminal each block is one picture of its cells, beside the hidden hotkey Buttons.
    const blocks = vm.mini ? [miniPane(d, vm.mini, vm.width)] : [header(d, vm.header, vm.width), ...body(d, vm, expand)]
    return (
      <Box flexDirection="column" width={vm.width} backgroundColor={COLORS.fill}>
        {pictures(d, blocks.filter((b): b is RenderElement => b !== null), vm.width)}
      </Box>
    )
  })
}
