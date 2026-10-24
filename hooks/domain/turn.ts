// The turn: what one tool call adds to its tally. Pure.
import type { Turn } from '../../types'

/** The tools that change files. */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/**
 * The turn after one tool call. The error streak counts from the main loop only, as a subagent's
 * failure is its own; edits count from every loop, so delegated work still counts.
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  edits: t.edits + (c.isEdit ? 1 : 0),
})
