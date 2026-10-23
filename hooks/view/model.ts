// The view model: everything one frame draws, worked out from one state snapshot by a pure function,
// so the renderers only lay it out and never read state themselves.
import type { AgentCard, Architect, Limit, LogLine, Moment, Receipt, Speed, ToolNote } from '../../types'
import type { Config, Panel } from '../config'
import { cardFit, cardTitle, isLoopActive } from '../domain/agents'
import { consultLine, consultTimeline, hasArchitect, isAdvising } from '../domain/architect'
import { logRows } from '../domain/log'
import { receiptRows } from '../domain/turn'
import { effortLevel } from '../domain/vitals'
import { plural, prettyModel, shorten, wrapText } from '../format/text'
import type { Snapshot } from '../state/store'
import { clampWidth, pickLayout } from './layout'

/** The log panel: the lines to draw, oldest first, and whether they are one agent's alone. */
export type LogView = { lines: LogLine[]; isViewingAgent: boolean }

/**
 * The vitals panel: the main model's effort, context, spend, rate limits and last request. Each
 * `has` flag is a row with something to show; with none the panel says it is waiting.
 */
export type VitalsView = {
  isRunning: boolean
  effort: string
  /** Steps of the effort gauge, 0 for a word off the scale. */
  effortLevel: number
  mode: string
  requests: number
  ctx: { pct: number; tokens: number | null; window: number; compactions: number } | null
  costUsd: number | null
  /** The first two rate-limit windows. */
  limits: Limit[]
  speed: Speed | null
  now: number
  has: { pace: boolean; ctx: boolean; spend: boolean; speed: boolean }
  /** Rows the panel body takes. */
  rows: number
}

/** The turn panel: the running turn's tally, or the receipt of the last one. */
export type TurnView = {
  isRunning: boolean
  startedAt: number
  edits: number
  errors: number
  isReviewing: boolean
  receipt: Receipt | null
  /** Rows the panel body takes. */
  rows: number
}

/** The block under the AGENTS frame for the card its hotkey opened: the task, facts, tools, answer. */
export type ExpandedView = {
  id: string
  /** The full task, wrapped to at most 3 rows. */
  description: string[]
  /** `type · Model · status · N steps`. */
  meta: string
  /** The last 3 tool calls, newest last. */
  tools: ToolNote[]
  /** `» answer`, cut to 240 characters and wrapped to at most 3 rows; empty until it answers. */
  answer: string[]
  /** Rows the block takes. */
  rows: number
}

/**
 * The agents panel: cards side by side while they fit, else one lane per agent on a shared time
 * axis. `shown` are the cards or lanes drawn, each with hotkey 1 to 6 in order.
 */
export type AgentsView = {
  /** `AGENTS R/T`: running, then total. */
  label: string
  /** `1-N expand`. */
  meta: string
  mode: 'cards' | 'lanes'
  shown: AgentCard[]
  /** Lanes left out above the last six. */
  earlier: number
  /** Every card, for the desktop's time axis. */
  all: AgentCard[]
  /** Cells each card takes in `cards` mode. */
  cardWidth: number
  /** The main model's readable name: a card names its model only when it differs. */
  mainModel: string
  /** The agent whose transcript is being viewed, marked `▶`. */
  viewedId: string | null
  now: number
  expanded: ExpandedView | null
  /** Rows the panel body takes inside its frame. */
  rows: number
}

/** The other loops row: model loops no card claims, and one dot each for the newest that fit. */
export type LoopsView = { seen: number; active: number; dots: ('active' | 'done' | 'idle')[] }

/** The architect panel: whether it is advising, its consults on one row, the last one's timing, its moments and its advice. */
export type ArchitectView = {
  /** The configured label, `ARCHITECT` by default. */
  label: string
  /** `consults N`. */
  meta: string
  isAdvising: boolean
  /** The consults on one row as wide as the frame's inside. */
  timeline: string
  /** `consulting since HH:MM:SS`, `last 2m ago · took 14s`, or `not consulted yet`. */
  since: string
  /** The moment of the last consult, lit among the three; null with the moments switched off. */
  moments: { lit: Moment | null } | null
  /** The last advice, empty until there is some. */
  advice: string
  /** The stored consults, for the desktop's timeline. */
  architect: Architect
  now: number
  /** Rows the panel body takes. */
  rows: number
}

export type ViewModel = {
  width: number
  layout: 'compact' | 'wide' | 'mini'
  /** The panels to draw, in config order: enabled and with something to show. */
  panels: Panel[]
  header: {
    /** The main model's readable name, or empty while it is unknown. */
    model: string
    /** The main loop is working on a turn. */
    isRunning: boolean
    /** A turn or any subagent is running: what the header pulse shows. */
    isActive: boolean
    /** The architect's status words (`ARCHITECT ADVISING`), or null with no architect seen. */
    arch: string | null
  }
  viewedAgentId: string | null
  /** The vitals panel; never null, since a fresh session still shows it. */
  vitals: VitalsView
  /** The turn panel, null until a turn has started. */
  turn: TurnView | null
  /** The agents panel, null until a subagent has been spawned. */
  agents: AgentsView | null
  /** The other loops row, null until a loop no card claims has stepped. */
  loops: LoopsView | null
  /** The architect panel, null until an architect has been spawned or consulted. */
  architect: ArchitectView | null
  /** The session log; never null, since an empty log still draws as `nothing yet`. */
  log: LogView
}

export type ViewContext = {
  cfg: Config
  now: number
  bodyColumns: number
  placement: 'dock' | 'inline'
  viewedAgentId: string | null
  /** Rows the pane body can show; the log takes what the other panels leave. Defaults to 40. */
  bodyRows?: number
}

export function buildViewModel(s: Snapshot, ctx: ViewContext): ViewModel {
  const width = clampWidth(ctx.bodyColumns)
  const isRunning = s.main.isRunning
  const vitals = vitalsView(s, ctx.now)
  const turn = turnView(s, width)
  const agents = agentsView(s, ctx, width)
  const loops = loopsView(s, ctx.now, width)
  const architect = architectView(s, ctx, width)
  // The header row, then each drawn panel's gap above it and its frame's two border rows around its
  // body; the expanded agent's block sits under its frame, and the loops row is one row under a gap.
  const drawn = (p: Panel) => ctx.cfg.panels.includes(p)
  const used =
    1 +
    (drawn('vitals') ? 3 + vitals.rows : 0) +
    (turn && drawn('turn') ? 3 + turn.rows : 0) +
    (agents && drawn('agents') ? 3 + agents.rows + (agents.expanded?.rows ?? 0) : 0) +
    (loops && drawn('loops') ? 2 : 0) +
    (architect && drawn('architect') ? 3 + architect.rows : 0)
  const log = logView(s.log, ctx, used)
  // What each panel draws, null while it has nothing to show; each panel's task fills in its own.
  const content: Record<Panel, unknown> = {
    vitals,
    trends: null,
    turn,
    agents,
    loops,
    architect,
    tools: null,
    log,
  }
  return {
    width,
    layout: pickLayout(ctx.cfg.layout, s.view.layout, ctx.placement, width),
    panels: ctx.cfg.panels.filter(p => content[p] !== null),
    header: {
      model: s.main.model ? prettyModel(s.main.model) : '',
      isRunning,
      isActive: isRunning || s.agents.some(a => a.status === 'running'),
      arch: hasArchitect(s.architect) ? `${ctx.cfg.architectLabel.toUpperCase()} ${isAdvising(s.architect) ? 'ADVISING' : 'ON CALL'}` : null,
    },
    viewedAgentId: ctx.viewedAgentId,
    vitals,
    turn,
    agents,
    loops,
    architect,
    log,
  }
}

/** Only the first two windows are drawn; the stored list may hold more. */
const LIMITS_SHOWN = 2

function vitalsView(s: Snapshot, now: number): VitalsView {
  const { main, usage } = s
  const ctx = usage.pct === null ? null : { pct: usage.pct, tokens: usage.tokens, window: usage.window, compactions: usage.compactions }
  const limits = usage.limits.slice(0, LIMITS_SHOWN)
  const has = {
    pace: main.effort !== '' || main.mode !== '' || main.steps > 0,
    ctx: ctx !== null,
    spend: usage.costUsd !== null || limits.length > 0,
    speed: main.speed !== null,
  }
  // The rows that exist; a panel with none keeps one for its waiting line.
  const rows = Math.max(1, Object.values(has).filter(Boolean).length)
  return {
    isRunning: main.isRunning,
    effort: main.effort,
    effortLevel: effortLevel(main.effort),
    mode: main.mode,
    requests: main.steps,
    ctx,
    costUsd: usage.costUsd,
    limits,
    speed: main.speed,
    now,
    has,
    rows,
  }
}

/** Shown while the turn runs or once it has left a receipt; a pane that has seen no turn has none. */
function turnView(s: Snapshot, width: number): TurnView | null {
  const { main, turn, receipt } = s
  if (!main.isRunning && receipt === null) return null
  const rows = main.isRunning ? 1 + (turn.isReviewing ? 1 : 0) : receipt ? receiptRows(receipt, width).length : 1
  return { isRunning: main.isRunning, startedAt: turn.startedAt, edits: turn.edits, errors: turn.errors, isReviewing: turn.isReviewing, receipt, rows }
}

/** Border and padding on each side of a row inside a frame, a card or the expanded block. */
const FRAME_CHROME = 4
/** Rows a card takes: its two border rows around title (2), type, counts and status. */
const CARD_ROWS = 7
/** The expanded block's border rows, above and below its content. */
const BLOCK_BORDER_ROWS = 2
/** Lanes drawn, the newest; hotkeys run 1 to 6. */
const LANES_SHOWN = 6
const DESCRIPTION_ROWS = 3
const ANSWER_ROWS = 3
const ANSWER_MAX = 240

/** Hidden until the first card; cards while all of them fit side by side, lanes past that. */
function agentsView(s: Snapshot, ctx: ViewContext, width: number): AgentsView | null {
  const cards = s.agents
  if (cards.length === 0) return null
  const inner = width - FRAME_CHROME
  const fit = cardFit(inner, ctx.cfg.maxCards)
  const mode = cards.length > fit ? 'lanes' : 'cards'
  const shown = mode === 'lanes' ? cards.slice(-LANES_SHOWN) : cards
  const running = cards.filter(c => c.status === 'running').length
  const open = cards.find(c => c.id === s.view.expanded)
  return {
    label: `AGENTS ${running}/${cards.length}`,
    meta: shown.length === 1 ? '1 expand' : `1-${shown.length} expand`,
    mode,
    shown,
    earlier: cards.length - shown.length,
    all: cards,
    cardWidth: Math.floor((inner - (fit - 1)) / fit),
    mainModel: s.main.model ? prettyModel(s.main.model) : '',
    viewedId: ctx.viewedAgentId,
    now: ctx.now,
    expanded: open ? expandedView(open, width - FRAME_CHROME) : null,
    rows: mode === 'cards' ? CARD_ROWS : shown.length + (cards.length > shown.length ? 1 : 0),
  }
}

function expandedView(c: AgentCard, room: number): ExpandedView {
  const description = wrapText(cardTitle(c), room, DESCRIPTION_ROWS)
  const status = c.lastStop === 'max_tokens' ? `${c.status} (max_tokens)` : c.status
  const meta = [c.type, c.model ? prettyModel(c.model) : null, status, plural(c.steps, 'step')].filter((p): p is string => p !== null).join(' · ')
  const answer = c.answer ? wrapText(`» ${shorten(c.answer, ANSWER_MAX)}`, room, ANSWER_ROWS) : []
  // With no tool call yet the block says so on a row of its own.
  const rows = BLOCK_BORDER_ROWS + description.length + 1 + Math.max(1, c.tools.length) + answer.length
  return { id: c.id, description, meta, tools: c.tools, answer, rows }
}

/** The words of the loops row between its `LOOPS` label and its dots. */
export const loopsWords = (seen: number, active: number): string => `  ${seen} seen · ${active} active  `

/** Hidden until a loop no card claims has stepped; as many dots as the row has room for, newest last. */
function loopsView(s: Snapshot, now: number, width: number): LoopsView | null {
  const list = s.loops
  if (list.length === 0) return null
  const active = list.filter(l => isLoopActive(l, now)).length
  // The row's one-cell padding on each side, then the label and the words before the dots.
  const room = width - 2 - Array.from(`LOOPS${loopsWords(list.length, active)}`).length
  const dots = room > 0 ? list.slice(-room).map((l): LoopsView['dots'][number] => (isLoopActive(l, now) ? 'active' : l.isDone ? 'done' : 'idle')) : []
  return { seen: list.length, active, dots }
}

/** Hidden until an architect has been spawned or consulted; the moments row only while they are switched on, the advice row once there is advice. */
function architectView(s: Snapshot, ctx: ViewContext, width: number): ArchitectView | null {
  const a = s.architect
  if (!hasArchitect(a)) return null
  const last = a.consults[a.consults.length - 1]
  const moments = ctx.cfg.moments ? { lit: last?.moment ?? null } : null
  return {
    label: ctx.cfg.architectLabel,
    meta: `consults ${a.consults.length}`,
    isAdvising: isAdvising(a),
    timeline: consultTimeline(a, ctx.now, width - FRAME_CHROME),
    since: consultLine(a, ctx.now),
    moments,
    advice: a.lastAdvice,
    architect: a,
    now: ctx.now,
    // The status, the timeline and the timing always; the moments and the advice when shown.
    rows: 3 + (moments ? 1 : 0) + (a.lastAdvice ? 1 : 0),
  }
}

/**
 * The newest lines that fit, those of the viewed agent alone while its transcript is open. `used`
 * is the rows the header and the other panels take; each panel adds its own to it.
 */
function logView(lines: LogLine[], ctx: ViewContext, used: number): LogView {
  const viewed = ctx.viewedAgentId
  const shown = viewed === null ? lines : lines.filter(l => l.agentId === viewed)
  return { lines: shown.slice(-logRows(ctx.bodyRows ?? 40, used)), isViewingAgent: viewed !== null }
}
