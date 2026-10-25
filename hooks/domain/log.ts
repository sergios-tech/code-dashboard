// The session log: what a line says and how many fit. Pure, so it is tested without an engine.
import type { AgentCard, LogLine } from '../../types'
import { redact } from '../format/redact'
import { shorten } from '../format/text'
import { whoOf } from './agents'

/** The log keeps this many lines; older ones are dropped as new ones arrive. */
export const LOG_MAX = 60

/** A line keeps this many characters of its text; the panel cuts it again to the pane's width. */
export const LINE_MAX = 400

/** `list` with `line` last, kept to the newest LOG_MAX. */
export const appendLog = (list: LogLine[], line: LogLine): LogLine[] => [...list, line].slice(-LOG_MAX)

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 * A message from an agent `cardOf` knows is logged under that agent's title and id; any other names
 * the start of its sender's id. Credentials are masked before the text is cut, so a cut never leaves
 * half a token showing.
 */
export const promptLine = (text: string, cardOf: (id: string) => AgentCard | undefined = () => undefined): { who: string; text: string; agentId?: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(redact(text), LINE_MAX) }
  const kind = tag.replace(/[-_]/g, ' ')
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  const card = from ? cardOf(from) : undefined
  if (card) return { who: whoOf(card), text: shorten(kind, LINE_MAX), agentId: card.id }
  return { who: 'engine', text: shorten(`${kind}${from ? ` from ${from.slice(0, 8)}` : ''}`, LINE_MAX) }
}

/** The rows a pane that reports no height is taken to have. */
const ASSUMED_ROWS = 40

/**
 * The rows the log's body takes. Docked with a known height it is every row the other panels leave
 * of `bodyRows` after the `used` rows and the log's own frame and gap (3), uncapped, so the log's
 * bottom border lands on the pane's last row; with room for fewer than 2 it is 0 and the log is
 * not drawn, so its frame never runs past the pane's bottom edge. Inline, where `bodyRows` may be
 * the whole terminal, it is at most 8, so an inline pane never stretches to the terminal's height.
 * A pane of unknown height is taken to have 40 rows, and its log keeps between 4 and 8.
 */
export const logRows = (bodyRows: number | undefined, used: number, isDocked: boolean): number => {
  const isKnown = bodyRows !== undefined && Number.isFinite(bodyRows)
  const room = Number.isFinite(used) ? Math.floor((isKnown ? bodyRows : ASSUMED_ROWS) - used - 3) : 4
  if (!isKnown) return Math.max(4, Math.min(8, room))
  if (room < 2) return 0
  return isDocked ? room : Math.min(8, room)
}
