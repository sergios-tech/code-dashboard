// The view model: everything one frame draws, worked out from one state snapshot by a pure function,
// so the renderers only lay it out and never read state themselves.
import type { Limit, LogLine, Receipt, Speed } from '../../types'
import type { Config, Panel } from '../config'
import { logRows } from '../domain/log'
import { receiptRows } from '../domain/turn'
import { effortLevel } from '../domain/vitals'
import { prettyModel } from '../format/text'
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
  const hasArchitect = s.architect.consults.length > 0 || s.architect.ids.length > 0
  const isAdvising = s.architect.consults.some(c => c.endAt === null)
  const vitals = vitalsView(s, ctx.now)
  const turn = turnView(s, width)
  // The header row, then each drawn panel's gap above it and its frame's two border rows around its body.
  const drawn = (p: Panel) => ctx.cfg.panels.includes(p)
  const used = 1 + (drawn('vitals') ? 3 + vitals.rows : 0) + (turn && drawn('turn') ? 3 + turn.rows : 0)
  const log = logView(s.log, ctx, used)
  // What each panel draws, null while it has nothing to show; each panel's task fills in its own.
  const content: Record<Panel, unknown> = {
    vitals,
    trends: null,
    turn,
    agents: null,
    loops: null,
    architect: null,
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
      arch: hasArchitect ? `${ctx.cfg.architectLabel.toUpperCase()} ${isAdvising ? 'ADVISING' : 'ON CALL'}` : null,
    },
    viewedAgentId: ctx.viewedAgentId,
    vitals,
    turn,
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

/**
 * The newest lines that fit, those of the viewed agent alone while its transcript is open. `used`
 * is the rows the header and the other panels take; each panel adds its own to it.
 */
function logView(lines: LogLine[], ctx: ViewContext, used: number): LogView {
  const viewed = ctx.viewedAgentId
  const shown = viewed === null ? lines : lines.filter(l => l.agentId === viewed)
  return { lines: shown.slice(-logRows(ctx.bodyRows ?? 40, used)), isViewingAgent: viewed !== null }
}
