// The on-call architect: the consults it is asked for, the moment each one is inferred at, the
// one-row timeline they share, the reply blocks a server-side advisor shows in, and the advice a
// report leaves. Pure.
import type { ApiContentBlock } from 'claude-code'

import type { Architect, Moment, Turn } from '../../types'
import type { Config } from '../config'
import { redact } from '../format/redact'
import { fmtDuration, shorten } from '../format/text'

/** Consults kept; the oldest goes first. */
export const CONSULTS_MAX = 40
/** Architect agent ids kept. */
export const IDS_MAX = 40
/** Server tool calls remembered, so a row read twice opens no second consult. */
export const SEEN_MAX = 60
const ADVICE_MAX = 160

/** The moments a consult is inferred at, in the order the panel lists them. */
export const MOMENTS: readonly Moment[] = ['before a plan', 'error repeats', 'before done']

/** The log's name for the architect: its label, as a source column reads. */
export const whoOf = (cfg: Config): string => cfg.architectLabel.toLowerCase()

/** An agent type as a consult names it: `fable-advisor:fable-advisor` is `fable-advisor`. */
export const viaOf = (type: string): string => type.split(':').pop() || 'agent'

/** When in the turn a consult was asked: errors repeating, nothing edited yet, or after edits. */
export const momentOf = (t: Pick<Turn, 'edits' | 'errorStreak'>): Moment =>
  t.errorStreak >= 2 ? 'error repeats' : t.edits === 0 ? 'before a plan' : 'before done'

/** A consult opened; one per id however often it is reported, the newest CONSULTS_MAX kept. */
export const startConsult = (a: Architect, c: { id: string; at: number; moment: Moment; via: string }): Architect =>
  a.consults.some(x => x.id === c.id) ? a : { ...a, consults: [...a.consults, { ...c, endAt: null }].slice(-CONSULTS_MAX) }

/** The open consult of `id` (any id when none is given, the latest first) ended at `at`; advice, when there is some, is the last. */
export const endConsult = (a: Architect, at: number, advice: string | null, id?: string): Architect => {
  const open = [...a.consults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  return {
    ...a,
    consults: open ? a.consults.map(c => (c === open ? { ...c, endAt: at } : c)) : a.consults,
    lastAdvice: advice ? advice : a.lastAdvice,
  }
}

export const isAdvising = (a: Architect): boolean => a.consults.some(c => c.endAt === null)

/** Whether an architect has been seen at all; the panel, the header words and the status field show from then. */
export const hasArchitect = (a: Architect): boolean => a.consults.length > 0 || a.ids.length > 0

/**
 * Every consult on one row of `width` cells, from the first consult to now: `◆` where one started,
 * `━` while it ran, `─` for the rest. Starts are drawn last, so a later run never hides one.
 */
export const consultTimeline = (a: Architect, now: number, width: number): string => {
  const w = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0))
  if (a.consults.length === 0 || w < 4) return '─'.repeat(w)
  const first = Math.min(...a.consults.map(c => c.at))
  const span = Math.max(1, now - first)
  const cell = (t: number) => Math.max(0, Math.min(w - 1, Math.floor(((t - first) / span) * (w - 1))))
  const cells = Array.from({ length: w }, () => '─')
  for (const c of a.consults) for (let i = cell(c.at) + 1; i <= cell(c.endAt ?? now); i++) cells[i] = '━'
  for (const c of a.consults) cells[cell(c.at)] = '◆'
  return cells.join('')
}

/** Elapsed time as the panel says how long ago: `42s`, `2m`, `1h05m`. */
const agoOf = (ms: number): string => (ms >= 60_000 && ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : fmtDuration(ms))

/** `consulting for 42s` while one is open, `last 2m ago · took 14s` after, or `not consulted yet`. */
export const consultLine = (a: Architect, now: number): string => {
  const open = [...a.consults].reverse().find(c => c.endAt === null)
  if (open) return `consulting for ${agoOf(now - open.at)}`
  const last = a.consults[a.consults.length - 1]
  if (!last) return 'not consulted yet'
  const end = last.endAt ?? last.at
  return `last ${agoOf(now - end)} ago · took ${fmtDuration(end - last.at)}`
}

/** A server-side advisor's call in a reply: a server tool use with an id, named as the architect pattern matches. */
export const isAdvisorUse = (cfg: Config, b: ApiContentBlock): b is ApiContentBlock & { id: string; name: string } =>
  b.type === 'server_tool_use' && typeof b.id === 'string' && b.id !== '' && typeof b.name === 'string' && cfg.architect.test(b.name)

/** A server tool's result in a reply, naming the call it answers. */
export const isServerResult = (b: ApiContentBlock): b is ApiContentBlock & { tool_use_id: string } =>
  typeof b.type === 'string' && b.type.endsWith('_tool_result') && typeof b.tool_use_id === 'string'

/** The first line with words in it, past the engine's bracketed notes and tags. */
const firstLine = (s: string): string =>
  s
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !l.startsWith('[') && !l.startsWith('<')) ?? ''

/**
 * A background agent's report as it opens a main-loop turn, `<agent-message from="id">` then the
 * engine's preamble and the report: whose it is and the report's first line, or null for any other text.
 */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  if (typeof text !== 'string') return null
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  // The preamble ends at `The report follows:`; without one the report starts after the tag.
  const rest = text.split(/The report follows:\s*\n/)[1] ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body = firstLine(rest)
  return body ? { from, body } : null
}

/**
 * The advice a report leaves: its first real line without markdown emphasis or a leading heading,
 * quote or bullet, credentials masked before it is cut to 160.
 */
export const adviceLine = (report: string): string =>
  typeof report === 'string' ? shorten(redact(firstLine(report).replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, '')), ADVICE_MAX) : ''
