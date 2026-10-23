// The session log: what a line says and how many fit. Pure, so it is tested without an engine.
import type { LogLine } from '../../types'
import { redact } from '../format/redact'
import { shorten } from '../format/text'

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
 * How many log lines fit: what the other panels leave of `bodyRows` after the `used` rows and the
 * log's own frame and gap (3), never fewer than 4 nor more than 8.
 */
export const logRows = (bodyRows: number, used: number): number => {
  const room = Number.isFinite(bodyRows) && Number.isFinite(used) ? Math.floor(bodyRows - used - 3) : 4
  return Math.max(4, Math.min(8, room))
}
