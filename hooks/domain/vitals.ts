// The main model's vitals: how fast a request ran, the effort scale, and the usage figures a host
// reports. Pure, so every host shape (no cost, no limits, no context percent) is tested without an engine.
import type { Limit, Speed, Usage } from '../../types'

/** Effort words on the four-step scale the gauge draws; `max` shares the top step with `xhigh`. */
export const EFFORT_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }

/** Steps of the effort gauge for a stored effort word; 0 for a word the scale does not know. */
export const effortLevel = (effort: string): number => (Object.hasOwn(EFFORT_LEVEL, effort) ? (EFFORT_LEVEL[effort] ?? 0) : 0)

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * A request's speed from three clock readings: the time to the first piece of the answer, and the
 * output tokens per second from that piece to the stop. Unknown without a first piece; the rate is
 * unknown without output tokens or without any time between the first piece and the stop.
 */
export const stepSpeed = (sentAt: number, firstAt: number | null, stopAt: number, outTokens: number | null): Speed | null => {
  if (firstAt === null || !finite(sentAt) || !finite(firstAt) || !finite(stopAt)) return null
  const decodeMs = stopAt - firstAt
  return {
    ttftMs: Math.max(0, firstAt - sentAt),
    tokPerS: finite(outTokens) && outTokens > 0 && decodeMs > 0 ? (outTokens * 1000) / decodeMs : null,
  }
}

/** A rate-limit reading as the pane keeps it, its ISO reset time turned into milliseconds since the epoch. */
export const limitOf = (r: { kind: string; percentUsed: number; resetsAt?: string }): Limit => {
  const at = typeof r.resetsAt === 'string' && r.resetsAt !== '' ? Date.parse(r.resetsAt) : Number.NaN
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
