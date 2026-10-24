// The session log: what a line says and how many fit. Pure, so it is tested without an engine.
import type { LogLine } from '../../types'
import { redact } from '../format/redact'
import { shorten } from '../format/text'
import { cellCount, fitCells } from './agents'

/** The log keeps this many lines; older ones are dropped as new ones arrive. */
export const LOG_MAX = 60

/** `list` with `line` last, kept to the newest LOG_MAX. */
export const appendLog = (list: LogLine[], line: LogLine): LogLine[] => [...list, line].slice(-LOG_MAX)

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 * Credentials are masked before the text is cut, so a cut never leaves half a token showing.
 */
export const promptLine = (text: string): { who: string; text: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(redact(text), 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  return { who: 'engine', text: shorten(`${tag.replace(/[-_]/g, ' ')}${from ? ` from ${from.slice(0, 8)}` : ''}`, 70) }
}

/**
 * A line's text in `cells` terminal cells with its marker after it. Only the text is cut, so a
 * failed or refused call still ends in `✗` or `· denied`, its state never shown by colour alone.
 */
export const logText = (l: Pick<LogLine, 'text' | 'mark'>, cells: number): string => {
  if (l.mark === null) return fitCells(l.text, cells)
  const room = cells - cellCount(l.mark) - 1
  return room > 0 ? [fitCells(l.text, room), l.mark].filter(Boolean).join(' ') : fitCells(l.mark, cells)
}

/** The rows a pane that reports no height is taken to have. */
const ASSUMED_ROWS = 40

/**
 * How many log lines fit: what the other panels leave of `bodyRows` after the `used` rows and the
 * log's own frame and gap (3), at most 8. With room for fewer than 2 it is 0 and the log is not
 * drawn, so its frame never runs past the pane's bottom edge. A pane of unknown height is taken to
 * have 40 rows, and its log keeps at least 4.
 */
export const logRows = (bodyRows: number | undefined, used: number): number => {
  const isKnown = bodyRows !== undefined && Number.isFinite(bodyRows)
  const room = Number.isFinite(used) ? Math.floor((isKnown ? bodyRows : ASSUMED_ROWS) - used - 3) : 4
  if (!isKnown) return Math.max(4, Math.min(8, room))
  return room < 2 ? 0 : Math.min(8, room)
}
