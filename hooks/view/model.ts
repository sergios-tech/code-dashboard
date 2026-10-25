// The view model: everything one frame draws, worked out from one state snapshot by a pure function,
// so the renderers only lay it out and never read state themselves.
import type { AgentCard, Architect, FileRow, Limit, LogLine, Moment, Speed, ToolNote, ToolRow } from '../../types'
import { PANELS } from '../config'
import type { Config, Panel } from '../config'
import { hotFiles, topTools, totalCalls } from '../domain/activity'
import { LIST_SHOWN, cardTitle, fitCells, isCut, isLoopActive, listOrder } from '../domain/agents'
import { consultLine, consultTimeline, hasArchitect, isAdvising } from '../domain/architect'
import { logRows } from '../domain/log'
import { effortLevel } from '../domain/vitals'
import { kTokens, plural, prettyModel, wrapText } from '../format/text'
import type { Snapshot } from '../state/store'
import { WIDE_LEFT, WIDE_RIGHT, clampWidth, pickLayout, wideColumns } from './layout'

/**
 * The log panel: the lines to draw, oldest first, whether they are one agent's alone, and the rows
 * its body takes. Docked with a known height `rows` is every row the pane has left, so the panel
 * pads the lines with blank rows down to it; otherwise it is the lines drawn, or 1 for `nothing yet`.
 */
export type LogView = { lines: LogLine[]; isViewingAgent: boolean; mainModel: string; rows: number }

/**
 * The info panel: the main model's effort, context, spend, rate limits and last request, in three
 * groups (model, usage, spend) split by dividers. `rows` counts the body rows, dividers included,
 * and is 1 when there is nothing to show but the waiting line.
 */
export type InfoView = {
  isRunning: boolean
  effort: string
  /** Steps of the effort gauge, 0 for a word off the scale. */
  effortLevel: number
  mode: string
  requests: number
  ctx: { pct: number; tokens: number | null; window: number; compactions: number } | null
  /** The first two rate-limit windows. */
  limits: Limit[]
  costUsd: number | null
  speed: Speed | null
  now: number
  /** Rows the panel body takes. */
  rows: number
}

/**
 * The block inside the AGENTS frame, after a divider, for the agent its hotkey opened: the task, the
 * facts, the last tool calls and the start of the answer.
 */
export type ExpandedView = {
  id: string
  /** The full task wrapped to at most 2 rows. */
  task: string[]
  /** `type · Model · status · N steps · ctx Nk · out N`; the model is left out when unknown. */
  facts: string
  /** The last 3 tool calls, newest last. */
  tools: ToolNote[]
  /** `» answer` fitted to one row; empty until it answers. */
  answer: string
  /** Rows the block takes, its divider not counted. */
  rows: number
}

/**
 * The agents panel: one row per agent, running ones first. `shown` are the rows drawn, each with
 * hotkey 1 to 6 in order.
 */
export type AgentsView = {
  /** `N running · N total`. */
  meta: string
  shown: AgentCard[]
  /** Agents left out above the six rows. */
  earlier: number
  /** Every card, for the desktop's time axis. */
  all: AgentCard[]
  /** The main model's readable name: a row tags its model only when it differs. */
  mainModel: string
  /** The agent whose transcript is being viewed, marked `▶`. */
  viewedId: string | null
  /** Some agent is running: the frame turns green. */
  isActive: boolean
  now: number
  /** The opened agent, only while it is among `shown`. */
  expanded: ExpandedView | null
  /** The model loops no agent claims, null until one has stepped. */
  loops: LoopsView | null
  /** Rows the panel body takes inside its frame: the list, then a divider and the opened block, then a divider and the loops row. */
  rows: number
}

/** The loops row: model loops no card claims, and one dot each for the newest that fit. */
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
  /** The files touched most, under a divider and a heads row; none until a call has read or edited one. */
  files: FileRow[]
  /** Rows the panel body takes: the heads row, the tools, and for the files a divider, a heads row and the files. */
  rows: number
}

/**
 * The summary inline above the prompt: no frames, one row per line and at most eight. Each part is
 * null, or empty, while it has nothing to show or its panel is switched off.
 */
export type MiniView = {
  /** The header's state: the model, the dot, and the architect words while that panel is on. */
  header: ViewModel['header']
  effort: string
  ctx: { pct: number; compactions: number } | null
  /** The first two rate-limit windows, the hotter first. */
  limits: Limit[]
  costUsd: number | null
  /** The first 6 of the list, running ones first, then the newest. */
  agents: AgentCard[]
  /** The main model's readable name: a row tags its model only when it differs. */
  mainModel: string
  /** Agents left out of the rows above. */
  earlier: number
  loops: LoopsView | null
  now: number
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
  info: InfoView
  /** The agents panel, null until a subagent has been spawned. */
  agents: AgentsView | null
  /** The architect panel, null until an architect has been spawned or consulted. */
  architect: ArchitectView | null
  /** The tools and files panel, null until the first tool call. */
  tools: ToolsView | null
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
  /**
   * Rows the pane body can show; the log takes what the other panels leave. Docked, that is all of
   * them, padded with blank rows; inline, at most 8. Unknown: 40, the log keeping 4 to 8.
   */
  bodyRows?: number
}

export function buildViewModel(s: Snapshot, ctx: ViewContext): ViewModel {
  const width = clampWidth(ctx.bodyColumns)
  const isRunning = s.main.isRunning
  const layout = pickLayout(ctx.cfg.layout, s.view.layout, ctx.placement, width)
  // In the wide layout a panel is laid out for its column, so its rows, dots and lines fit there.
  const cols = layout === 'wide' ? wideColumns(width) : null
  const widthOf = (p: Panel): number => (cols === null ? width : WIDE_LEFT.includes(p) ? cols.left : WIDE_RIGHT.includes(p) ? cols.right : width)
  const widths = Object.fromEntries(PANELS.map(p => [p, widthOf(p)])) as Record<Panel, number>
  const info = infoView(s, ctx.now)
  const agents = agentsView(s, ctx, widths.agents)
  const architect = architectView(s, ctx, widths.architect)
  const tools = toolsView(s, layout)
  // What each panel draws, null while it has nothing to show.
  const content: Record<Panel, unknown> = { info, agents, architect, tools, log: s.log }
  const shown = ctx.cfg.panels.filter(p => content[p] !== null)
  const columns: Columns | null = cols
    ? { left: shown.filter(p => WIDE_LEFT.includes(p)), right: shown.filter(p => WIDE_RIGHT.includes(p)), leftWidth: cols.left, rightWidth: cols.right, gap: cols.gap }
    : null
  // Each drawn panel's gap above it and its frame's two border rows around its body.
  const tall: Record<Panel, number> = {
    info: 3 + info.rows,
    agents: agents ? 3 + agents.rows : 0,
    architect: architect ? 3 + architect.rows : 0,
    tools: tools ? 3 + tools.rows : 0,
    log: 0,
  }
  const height = (ps: Panel[]) => ps.reduce((n, p) => n + tall[p], 0)
  // The header row, then the panels above the log: one stack, or the taller of the two columns.
  const used = 1 + (columns ? Math.max(height(columns.left), height(columns.right)) : height(shown))
  const log = logView(s.log, s.main.model ? prettyModel(s.main.model) : '', ctx, used)
  // A pane too short for the log draws none of it rather than a frame cut off at its bottom edge.
  const panels = log ? shown : shown.filter(p => p !== 'log')
  const header: ViewModel['header'] = {
    model: s.main.model ? prettyModel(s.main.model) : '',
    isRunning,
    isActive: isRunning || s.agents.some(a => a.status === 'running'),
    arch: hasArchitect(s.architect) ? `${ctx.cfg.architectLabel.toUpperCase()} ${isAdvising(s.architect) ? 'ADVISING' : 'ON CALL'}` : null,
    isAdvising: isAdvising(s.architect),
  }
  return {
    width,
    layout,
    panels,
    columns,
    widths,
    header,
    viewedAgentId: ctx.viewedAgentId,
    info,
    agents,
    architect,
    tools,
    log,
    mini: layout === 'mini' ? miniView(s, ctx, header, widths.agents) : null,
  }
}

/** Agent rows in the inline summary. */
const MINI_AGENTS = 6

/** The inline summary: the state and digest, then each part whose panel is switched on and has something to show. */
function miniView(s: Snapshot, ctx: ViewContext, header: ViewModel['header'], agentsWidth: number): MiniView {
  const drawn = (p: Panel) => ctx.cfg.panels.includes(p)
  const ordered = drawn('agents') ? listOrder(s.agents) : []
  const agents = ordered.slice(0, MINI_AGENTS)
  const loops = drawn('agents') ? loopsView(s, ctx.now, agentsWidth) : null
  const heat = (l: Limit): number => (Number.isFinite(l.pct) ? l.pct : 0)
  return {
    header: { ...header, arch: drawn('architect') ? header.arch : null },
    effort: s.main.effort,
    ctx: s.usage.pct === null ? null : { pct: s.usage.pct, compactions: s.usage.compactions },
    limits: s.usage.limits.slice(0, LIMITS_SHOWN).sort((x, y) => heat(y) - heat(x)),
    costUsd: s.usage.costUsd,
    agents,
    mainModel: s.main.model ? prettyModel(s.main.model) : '',
    earlier: ordered.length - agents.length,
    loops,
    now: ctx.now,
  }
}

/** Only the first two windows are drawn; the stored list may hold more. */
const LIMITS_SHOWN = 2

/** The model, usage and spend groups the panel shows, from what the session has reported. */
function infoView(s: Snapshot, now: number): InfoView {
  const { main, usage } = s
  const ctx = usage.pct === null ? null : { pct: usage.pct, tokens: usage.tokens, window: usage.window, compactions: usage.compactions }
  const limits = usage.limits.slice(0, LIMITS_SHOWN)
  const groups = [main.effort !== '' || main.mode !== '' || main.steps > 0 ? 1 : 0, ctx !== null || limits.length > 0 ? (ctx ? 1 : 0) + limits.length : 0, usage.costUsd !== null || main.speed !== null ? 1 : 0]
  const shown = groups.filter(n => n > 0)
  // The rows of each group, a divider between each pair of groups; a panel with none keeps one for its waiting line.
  const rows = Math.max(1, shown.reduce((n, g) => n + g, 0) + Math.max(0, shown.length - 1))
  return {
    isRunning: main.isRunning,
    effort: main.effort,
    effortLevel: effortLevel(main.effort),
    mode: main.mode,
    requests: main.steps,
    ctx,
    limits,
    costUsd: usage.costUsd,
    speed: main.speed,
    now,
    rows,
  }
}

/** Border and padding on each side of a row inside a frame. */
const FRAME_CHROME = 4
const TASK_ROWS = 2

/** Hidden until the first agent; then the first six of the list, running first, and a row for those left out. */
function agentsView(s: Snapshot, ctx: ViewContext, width: number): AgentsView | null {
  const cards = s.agents
  if (cards.length === 0) return null
  const ordered = listOrder(cards)
  const shown = ordered.slice(0, LIST_SHOWN)
  const running = cards.filter(c => c.status === 'running').length
  // An opened agent that is no longer among the six drawn rows is not drawn, nor is a name that no agent has.
  const open = shown.find(c => c.id === s.view.expanded)
  const expanded = open ? expandedView(open, width - FRAME_CHROME) : null
  const loops = loopsView(s, ctx.now, width)
  return {
    meta: `${running} running · ${cards.length} total`,
    shown,
    earlier: ordered.length - shown.length,
    all: cards,
    mainModel: s.main.model ? prettyModel(s.main.model) : '',
    viewedId: ctx.viewedAgentId,
    isActive: running > 0,
    now: ctx.now,
    expanded,
    loops,
    // Each of the opened block and the loops row sits after a divider row of its own.
    rows: shown.length + (ordered.length > shown.length ? 1 : 0) + (expanded ? 1 + expanded.rows : 0) + (loops ? 2 : 0),
  }
}

function expandedView(c: AgentCard, room: number): ExpandedView {
  const task = wrapText(cardTitle(c), room, TASK_ROWS)
  const status = isCut(c) && c.lastStop === 'max_tokens' ? 'max_tokens' : c.status
  const facts = [c.type, c.model ? prettyModel(c.model) : null, status, plural(c.steps, 'step'), `ctx ${kTokens(c.ctx)}`, `out ${kTokens(c.out)}`]
    .filter((p): p is string => p !== null)
    .join(' · ')
  const answer = c.answer ? fitCells(`» ${c.answer}`, room) : ''
  // With no tool call yet the block says so on a row of its own.
  const rows = task.length + 1 + Math.max(1, c.tools.length) + (answer ? 1 : 0)
  return { id: c.id, task, facts, tools: c.tools, answer, rows }
}

/** The words of the loops row before its dots. */
export const loopsWords = (seen: number, active: number): string => `loops  ${seen} seen · ${active} active  `

/** Hidden until a loop no card claims has stepped; as many dots as the row has room for, newest last. */
function loopsView(s: Snapshot, now: number, width: number): LoopsView | null {
  const list = s.loops
  if (list.length === 0) return null
  const active = list.filter(l => isLoopActive(l, now)).length
  // The frame's border and padding on each side, then the words before the dots.
  const room = width - FRAME_CHROME - Array.from(loopsWords(list.length, active)).length
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

/** Hidden until the first call; the divider, the files' heads row and the files once a call has read or edited a file. */
function toolsView(s: Snapshot, layout: ViewModel['layout']): ToolsView | null {
  const a = s.activity
  if (a.tools.length === 0) return null
  const tools = topTools(a, TOOLS_SHOWN[layout])
  const files = hotFiles(a, FILES_SHOWN)
  return { meta: plural(totalCalls(a), 'call'), tools, files, rows: 1 + tools.length + (files.length > 0 ? 2 + files.length : 0) }
}

/**
 * The newest lines that fit, those of the viewed agent alone while its transcript is open; null
 * when fewer than 2 rows are left. `used` is the rows the header and the other panels take; each
 * panel adds its own to it. Docked with a known height the body is padded to every row left; inline
 * or of unknown height it is the lines alone, at most 8.
 */
function logView(lines: LogLine[], mainModel: string, ctx: ViewContext, used: number): LogView | null {
  const isDocked = ctx.placement === 'dock' && ctx.bodyRows !== undefined && Number.isFinite(ctx.bodyRows)
  const room = logRows(ctx.bodyRows, used, ctx.placement === 'dock')
  if (room === 0) return null
  const viewed = ctx.viewedAgentId
  const shown = (viewed === null ? lines : lines.filter(l => l.agentId === viewed)).slice(-room)
  return { lines: shown, isViewingAgent: viewed !== null, mainModel, rows: isDocked ? room : Math.max(1, shown.length) }
}
