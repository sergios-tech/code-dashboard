// The main model's vitals: how fast a request ran, the effort scale, and the usage figures a host
// reports. Pure, so every host shape (no cost, no limits, no context percent) is tested without an engine.
import type { Limit, Speed, Usage } from '../../types'
import { parseIso } from '../format/text'

/** Effort words on the four-step scale the gauge draws; `max` shares the top step with `xhigh`. */
export const EFFORT_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }

/** Steps of the effort gauge for a stored effort word; 0 for a word the scale does not know. */
export const effortLevel = (effort: string): number => (Object.hasOwn(EFFORT_LEVEL, effort) ? (EFFORT_LEVEL[effort] ?? 0) : 0)

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The shortest window a rate is read over: a quicker one times pieces arriving together, not the model's pace. */
const MIN_DECODE_MS = 200
/** Faster than any model streams: a window this quick for its tokens timed their delivery, not their making. */
const MAX_TOK_PER_S = 1000

/**
 * A request's speed from four clock readings: the time to the first piece of the answer, and the
 * output tokens per second from the response's start to the stop. The start is its first chunk of
 * any kind (the envelope), since thinking that streams no text comes before the first piece yet
 * counts among the output tokens; with no start read, the first piece is the start. Unknown without
 * a first piece; the rate is unknown without output tokens, and when the window is too short, or too
 * quick for its tokens, to be the model's pace: the response came in one burst and cannot be timed.
 */
export const stepSpeed = (sentAt: number, firstAt: number | null, stopAt: number, outTokens: number | null, startAt: number | null = firstAt): Speed | null => {
  if (firstAt === null || !finite(sentAt) || !finite(firstAt) || !finite(stopAt)) return null
  const decodeMs = stopAt - (finite(startAt) ? Math.min(startAt, firstAt) : firstAt)
  const rate = finite(outTokens) && outTokens > 0 && decodeMs >= MIN_DECODE_MS ? (outTokens * 1000) / decodeMs : null
  return { ttftMs: Math.max(0, firstAt - sentAt), tokPerS: rate !== null && rate <= MAX_TOK_PER_S ? rate : null }
}

/** A rate-limit reading as the pane keeps it, its ISO reset time turned into milliseconds since the epoch. */
export const limitOf = (r: { kind: string; percentUsed: number; resetsAt?: string }): Limit => {
  const at = typeof r.resetsAt === 'string' && r.resetsAt !== '' ? parseIso(r.resetsAt) : Number.NaN
  return { kind: typeof r.kind === 'string' ? r.kind : '', pct: finite(r.percentUsed) ? r.percentUsed : 0, resetsAt: Number.isFinite(at) ? at : null }
}

/** A host reports a handful of windows at most; the pane keeps a bounded few. */
const LIMITS_MAX = 8

type Reading = {
  context: { percent?: number | null; tokens?: number | null; window: number }
  cost?: { usd?: number } | null
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

/**
 * The stored usage after a host reading. Whatever the host leaves out (no context percent, no cost,
 * no windows) is stored as unknown, never as zero; the compaction count and time carry over.
 */
export const usageFrom = (reading: Reading, prev: Usage): Usage => {
  const limits = Array.isArray(reading.rateLimits) ? reading.rateLimits : []
  return {
    pct: finite(reading.context?.percent) ? reading.context.percent : null,
    tokens: finite(reading.context?.tokens) ? reading.context.tokens : null,
    window: finite(reading.context?.window) ? reading.context.window : prev.window,
    costUsd: finite(reading.cost?.usd) ? reading.cost.usd : null,
    limits: limits.slice(0, LIMITS_MAX).map(limitOf),
    compactions: prev.compactions,
    lastCompactAt: prev.lastCompactAt,
  }
}
