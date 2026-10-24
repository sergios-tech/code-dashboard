// The view model: everything one frame draws, worked out from one state snapshot by a pure function,
// so the renderers only lay it out and never read state themselves.
import type { AgentCard, Architect, FileRow, Limit, LogLine, Moment, Sample, Speed, ToolNote, ToolRow } from '../../types'
import { PANELS } from '../config'
import type { Config, Panel } from '../config'
import { hotFiles, topTools, totalCalls } from '../domain/activity'
import { cardFit, cardTitle, isLoopActive } from '../domain/agents'
import { consultLine, consultTimeline, hasArchitect, isAdvising } from '../domain/architect'
import { logRows } from '../domain/log'
import { effortLevel } from '../domain/vitals'
import { plural, prettyModel, shorten, wrapText } from '../format/text'
import type { Snapshot } from '../state/store'
import { WIDE_LEFT, WIDE_RIGHT, clampWidth, pickLayout, wideColumns } from './layout'

/** The log panel: the lines to draw, oldest first, and whether they are one agent's alone. */
export type LogView = { lines: LogLine[]; isViewingAgent: boolean }

/**
 * The info panel: the main model's effort, context, spend, rate limits and last request. Each
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

/** The tools and files panel: the busiest tools, then the files touched most. */
export type ToolsView = {
  /** `N calls`. */
  meta: string
  /** The tools with the most calls, most first. */
  tools: ToolRow[]
  /** The files touched most, under a `hot files` label; none until a call has read or edited one. */
  files: FileRow[]
  /** Rows the panel body takes. */
  rows: number
}

/**
 * The trends panel: the samples both lines are drawn from, and each line's current figure. A line is
 * null when no sample has its figure, so a host without cost shows the context line alone.
 */
export type TrendsView = {
  samples: Sample[]
  /** The latest context fill, in percent. */
  ctx: number | null
  /** The latest cumulative cost. */
  cost: { usd: number; min: number; max: number } | null
  /** Rows the panel body takes. */
  rows: number
}

/**
 * The summary inline above the prompt: no frames, one row per line and at most eight. Each part is
 * null, or empty, while it has nothing to show or its panel is switched off.
 */
export type MiniView = {
  /** The main model's readable name, or empty while it is unknown. */
  model: string
  isRunning: boolean
  ctx: { pct: number; compactions: number } | null
  costUsd: number | null
  /** `architect advising`, or `architect N` for the consults so far. */
  arch: string | null
  /** The context fill of each trend sample that has one, for the one-row sparkline, and the latest; null under two. */
  spark: { values: number[]; pct: number } | null
  /** Up to three agents, running ones first, then the newest. */
  agents: AgentCard[]
  /** Agents left out of the rows above. */
  more: number
  loops: { seen: number; active: number } | null
}

/** The wide layout's two columns, each holding its panels in config order. */
export type Columns = { left: Panel[]; right: Panel[]; leftWidth: number; rightWidth: number; gap: number }

export type ViewModel = {
  width: number
  layout: 'compact' | 'wide' | 'mini'
  /** The panels to draw, in config order: enabled and with something to show, the log only with room for it. */
  panels: Panel[]
  /** The wide layout's columns, the log running under both; null in one column. */
  columns: Columns | null
  /** The cells each panel is drawn in: its column's in the wide layout, else the pane's. */
  widths: Record<Panel, number>
  header: {
    /** The main model's readable name, or empty while it is unknown. */
    model: string
    /** The main loop is working on a turn. */
    isRunning: boolean
    /** A turn or any subagent is running: what the header pulse shows. */
    isActive: boolean
    /** The architect's status words (`ARCHITECT ADVISING`), or null with no architect seen. */
    arch: string | null
    /** The architect has an open consult: its words read `architect` rather than `dim`. */
    isAdvising: boolean
  }
  viewedAgentId: string | null
  /** The info panel; never null, since a fresh session still shows it. */
  info: VitalsView
  /** The agents panel, null until a subagent has been spawned. */
  agents: AgentsView | null
  /** The other loops row, null until a loop no card claims has stepped. */
  loops: LoopsView | null
  /** The architect panel, null until an architect has been spawned or consulted. */
  architect: ArchitectView | null
  /** The tools and files panel, null until the first tool call. */
  tools: ToolsView | null
  /** The trends panel, null until there are two samples with a figure to draw. */
  trends: TrendsView | null
  /** The session log, an empty one drawn as `nothing yet`; null when the pane leaves it under 2 rows. */
  log: LogView | null
  /** The inline summary, drawn instead of the panels; null outside the mini layout. */
  mini: MiniView | null
}

export type ViewContext = {
  cfg: Config
  now: number
  bodyColumns: number
  placement: 'dock' | 'inline'
  viewedAgentId: string | null
  /** Rows the pane body can show; the log takes what the other panels leave. Unknown: 40, the log keeping 4 to 8. */
  bodyRows?: number
}

export function buildViewModel(s: Snapshot, ctx: ViewContext): ViewModel {
  const width = clampWidth(ctx.bodyColumns)
  const isRunning = s.main.isRunning
  const layout = pickLayout(ctx.cfg.layout, s.view.layout, ctx.placement, width)
  // In the wide layout a panel is laid out for its column, so its cards, dots and lines fit there.
  const cols = layout === 'wide' ? wideColumns(width) : null
  const widthOf = (p: Panel): number => (cols === null ? width : WIDE_LEFT.includes(p) ? cols.left : WIDE_RIGHT.includes(p) ? cols.right : width)
  const widths = Object.fromEntries(PANELS.map(p => [p, widthOf(p)])) as Record<Panel, number>
  const info = vitalsView(s, ctx.now)
  const agents = agentsView(s, ctx, widths.agents)
  const loops = loopsView(s, ctx.now, widths.loops)
  const architect = architectView(s, ctx, widths.architect)
  const tools = toolsView(s, layout)
  const trends = trendsView(s)
  // What each panel draws, null while it has nothing to show.
  const content: Record<Panel, unknown> = { info, trends, agents, loops, architect, tools, log: s.log }
  const shown = ctx.cfg.panels.filter(p => content[p] !== null)
  const columns: Columns | null = cols
    ? { left: shown.filter(p => WIDE_LEFT.includes(p)), right: shown.filter(p => WIDE_RIGHT.includes(p)), leftWidth: cols.left, rightWidth: cols.right, gap: cols.gap }
    : null
  // Each drawn panel's gap above it and its frame's two border rows around its body; the expanded
  // agent's block sits under its frame, and the loops row is one row under a gap.
  const tall: Record<Panel, number> = {
    info: 3 + info.rows,
    trends: trends ? 3 + trends.rows : 0,
    agents: agents ? 3 + agents.rows + (agents.expanded?.rows ?? 0) : 0,
    loops: loops ? 2 : 0,
    architect: architect ? 3 + architect.rows : 0,
    tools: tools ? 3 + tools.rows : 0,
    log: 0,
  }
  const height = (ps: Panel[]) => ps.reduce((n, p) => n + tall[p], 0)
  // The header row, then the panels above the log: one stack, or the taller of the two columns.
  const used = 1 + (columns ? Math.max(height(columns.left), height(columns.right)) : height(shown))
  const log = logView(s.log, ctx, used)
  // A pane too short for the log draws none of it rather than a frame cut off at its bottom edge.
  const panels = log ? shown : shown.filter(p => p !== 'log')
  return {
    width,
    layout,
    panels,
    columns,
    widths,
    header: {
      model: s.main.model ? prettyModel(s.main.model) : '',
      isRunning,
      isActive: isRunning || s.agents.some(a => a.status === 'running'),
      arch: hasArchitect(s.architect) ? `${ctx.cfg.architectLabel.toUpperCase()} ${isAdvising(s.architect) ? 'ADVISING' : 'ON CALL'}` : null,
      isAdvising: isAdvising(s.architect),
    },
    viewedAgentId: ctx.viewedAgentId,
    info,
    agents,
    loops,
    architect,
    tools,
    trends,
    log,
    mini: layout === 'mini' ? miniView(s, ctx, trends, loops) : null,
  }
}

/** Agent rows in the inline summary; the rest are counted on the row under them. */
const MINI_AGENTS = 3

/** The inline summary: the main model's line, then each part whose panel is switched on and has something to show. */
function miniView(s: Snapshot, ctx: ViewContext, trends: TrendsView | null, loops: LoopsView | null): MiniView {
  const drawn = (p: Panel) => ctx.cfg.panels.includes(p)
  const a = s.architect
  const label = ctx.cfg.architectLabel.toLowerCase()
  const running = s.agents.filter(c => c.status === 'running')
  const rest = s.agents.filter(c => c.status !== 'running').reverse()
  const agents = drawn('agents') ? [...running, ...rest].slice(0, MINI_AGENTS) : []
  // Readings that carried no context fill (cost alone) would only leave gaps in a line this short.
  const ctxs = (trends?.samples ?? []).map(x => x.ctxPct).filter((v): v is number => v !== null)
  const last = ctxs[ctxs.length - 1]
  return {
    model: s.main.model ? prettyModel(s.main.model) : '',
    isRunning: s.main.isRunning,
    ctx: s.usage.pct === null ? null : { pct: s.usage.pct, compactions: s.usage.compactions },
    costUsd: s.usage.costUsd,
    arch: drawn('architect') && hasArchitect(a) ? `${label} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    spark: drawn('trends') && ctxs.length >= 2 && last !== undefined ? { values: ctxs, pct: last } : null,
    agents,
    more: drawn('agents') ? s.agents.length - agents.length : 0,
    loops: drawn('loops') && loops ? { seen: loops.seen, active: loops.active } : null,
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

/** Tool rows drawn: more where the wide layout gives the panel a column of its own. */
const TOOLS_SHOWN = { compact: 4, wide: 6, mini: 4 } as const
const FILES_SHOWN = 5

/** Hidden until the first call; the `hot files` label and rows once a call has read or edited a file. */
function toolsView(s: Snapshot, layout: ViewModel['layout']): ToolsView | null {
  const a = s.activity
  if (a.tools.length === 0) return null
  const tools = topTools(a, TOOLS_SHOWN[layout])
  const files = hotFiles(a, FILES_SHOWN)
  return { meta: plural(totalCalls(a), 'call'), tools, files, rows: tools.length + (files.length > 0 ? 1 + files.length : 0) }
}

/** Hidden below two samples; each line only while some sample has its figure. */
function trendsView(s: Snapshot): TrendsView | null {
  const { samples } = s.trends
  if (samples.length < 2) return null
  const ctxs = samples.map(x => x.ctxPct).filter((v): v is number => v !== null)
  const costs = samples.map(x => x.costUsd).filter((v): v is number => v !== null)
  const lastCost = costs[costs.length - 1]
  const ctx = ctxs[ctxs.length - 1] ?? null
  const cost = lastCost === undefined ? null : { usd: lastCost, min: Math.min(...costs), max: Math.max(...costs) }
  const rows = (ctx !== null ? 1 : 0) + (cost ? 1 : 0)
  return rows === 0 ? null : { samples, ctx, cost, rows }
}

/**
 * The newest lines that fit, those of the viewed agent alone while its transcript is open; null
 * when fewer than 2 fit. `used` is the rows the header and the other panels take; each panel adds
 * its own to it.
 */
function logView(lines: LogLine[], ctx: ViewContext, used: number): LogView | null {
  const rows = logRows(ctx.bodyRows, used)
  if (rows === 0) return null
  const viewed = ctx.viewedAgentId
  const shown = viewed === null ? lines : lines.filter(l => l.agentId === viewed)
  return { lines: shown.slice(-rows), isViewingAgent: viewed !== null }
}
