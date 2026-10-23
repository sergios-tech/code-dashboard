// The turn: what one tool call adds to it, and the receipt it leaves. Pure.
import type { Receipt, Turn } from '../../types'
import { fmtDuration, fmtUsd, plural, wrapText } from '../format/text'

/** The tools that change files. */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** A cost added by a turn is shown from this much; below it the figure is noise. */
const COST_FLOOR = 0.005

/**
 * The turn after one tool call. Errors count from the main loop only, as a subagent's failure is its
 * own; edits count from every loop, so delegated work still counts.
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

/** What a turn left behind once it ended; `costDelta` is null below $0.005 or when either cost reading is unknown. */
export const receiptOf = (t: Turn, o: { durationMs: number; agentsSince: number; costNow: number | null; reason: string }): Receipt => {
  const delta = o.costNow !== null && t.costAtStart !== null ? o.costNow - t.costAtStart : null
  return {
    durationMs: Number.isFinite(o.durationMs) ? Math.max(0, o.durationMs) : 0,
    agents: o.agentsSince,
    edits: t.edits,
    errors: t.errors,
    costDelta: delta !== null && delta >= COST_FLOOR ? delta : null,
    reason: o.reason,
  }
}

/** `last turn 1m12s · 2 agents · 4 edits · 0 errors · +$0.41`, with the ending named when it was not an answer. */
export const receiptLine = (r: Receipt): string =>
  [
    `last turn ${fmtDuration(r.durationMs)}`,
    plural(r.agents, 'agent'),
    plural(r.edits, 'edit'),
    plural(r.errors, 'error'),
    r.costDelta !== null ? `+${fmtUsd(r.costDelta)}` : null,
    r.reason !== '' && r.reason !== 'answer' ? r.reason : null,
  ]
    .filter((p): p is string => p !== null)
    .join(' · ')

/** Cells a panel row keeps for a frame's border and padding, and for the receipt's glyph and space. */
const FRAME_CHROME = 4
const GLYPH_CELLS = 2

/** The receipt as at most two rows beside its glyph, in a frame of `width` cells. */
export const receiptRows = (r: Receipt, width: number): string[] => wrapText(receiptLine(r), Math.max(1, width - FRAME_CHROME - GLYPH_CELLS), 2)
