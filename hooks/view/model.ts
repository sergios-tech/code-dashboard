// The view model: everything one frame draws, worked out from one state snapshot by a pure function,
// so the renderers only lay it out and never read state themselves.
import type { LogLine } from '../../types'
import type { Config, Panel } from '../config'
import { logRows } from '../domain/log'
import { prettyModel } from '../format/text'
import type { Snapshot } from '../state/store'
import { clampWidth, pickLayout } from './layout'

/** The log panel: the lines to draw, oldest first, and whether they are one agent's alone. */
export type LogView = { lines: LogLine[]; isViewingAgent: boolean }

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
  const log = logView(s.log, ctx)
  // What each panel draws, null while it has nothing to show; each panel's task fills in its own.
  const content: Record<Panel, unknown> = {
    vitals: null,
    trends: null,
    turn: null,
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
    log,
  }
}

/**
 * The newest lines that fit, those of the viewed agent alone while its transcript is open. The
 * rows taken so far are the header; each panel added later counts its own rows too.
 */
function logView(lines: LogLine[], ctx: ViewContext): LogView {
  const viewed = ctx.viewedAgentId
  const shown = viewed === null ? lines : lines.filter(l => l.agentId === viewed)
  const used = 1
  return { lines: shown.slice(-logRows(ctx.bodyRows ?? 40, used)), isViewingAgent: viewed !== null }
}
