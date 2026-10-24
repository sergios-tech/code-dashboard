// Stored shapes, their defaults and the lenient reads. Stored state can be older than this build,
// half written, or plain junk after an update mid-session, so nothing read back is trusted: each
// normalizer rebuilds a value of the declared shape and never throws.
import type {
  Activity,
  AgentCard,
  AgentStatus,
  Architect,
  Consult,
  Denials,
  FileRow,
  Layout,
  Limit,
  LogKind,
  LogLine,
  LogMark,
  Loop,
  Main,
  Moment,
  Receipt,
  Roster,
  Sample,
  ToolNote,
  ToolRow,
  Trends,
  Turn,
  Usage,
  View,
} from '../../types'

export const SCHEMA_VERSION = 1

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false, speed: null }
export const DEFAULT_USAGE: Usage = { pct: null, tokens: null, window: 0, costUsd: null, limits: [], compactions: 0, lastCompactAt: null }
export const DEFAULT_TURN: Turn = { startedAt: 0, costAtStart: null, edits: 0, errors: 0, errorStreak: 0, isReviewing: false }
export const DEFAULT_ARCHITECT: Architect = { consults: [], ids: [], seen: [], lastAdvice: '' }
export const DEFAULT_ACTIVITY: Activity = { tools: [], files: [], calls: 0 }
export const DEFAULT_TRENDS: Trends = { samples: [], pendingCompaction: false }
export const DEFAULT_DENIALS: Denials = { count: 0 }
export const DEFAULT_VIEW: View = { expanded: null, layout: null }
export const DEFAULT_ROSTER: Roster = { architectTypes: [] }

// ---------------------------------------------------------------- primitives

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)

/** A copy no caller can use to change a shared default. */
const fresh = <T>(v: T): T => {
  if (Array.isArray(v)) return v.map(fresh) as T
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fresh(x)])) as T
  return v
}

/**
 * The stored object over its defaults. Only the default's own keys survive, and a stored value
 * must have the default's type (a finite number for a number, and so on); a default of `null`
 * stands for "number, string or null", which the per-key normalizers narrow further.
 */
export const normalize = <T extends object>(def: T, stored: unknown): T => {
  const out: Record<string, unknown> = fresh(def) as Record<string, unknown>
  if (!isObject(stored)) return out as T
  for (const [k, d] of Object.entries(def)) {
    const s = stored[k]
    if (d === null) out[k] = typeof s === 'string' || (typeof s === 'number' && Number.isFinite(s)) ? s : null
    else if (Array.isArray(d)) out[k] = Array.isArray(s) ? s : fresh(d)
    else if (typeof d === 'number') out[k] = num(s, d)
    else if (typeof d === 'string') out[k] = str(s, d)
    else if (typeof d === 'boolean') out[k] = bool(s, d)
    else if (isObject(d)) out[k] = isObject(s) ? s : fresh(d)
  }
  return out as T
}

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

const objects = (stored: unknown): Record<string, unknown>[] => listOf<unknown>(stored).filter(isObject)
const strings = (stored: unknown): string[] => listOf<unknown>(stored).filter((s): s is string => typeof s === 'string')

// ---------------------------------------------------------------- per-key normalizers

const MOMENTS: readonly Moment[] = ['before a plan', 'error repeats', 'before done']
const LAYOUTS: readonly Layout[] = ['auto', 'compact', 'wide', 'mini']
const STATUSES: readonly AgentStatus[] = ['running', 'done', 'stopped', 'failed']
const KINDS: readonly LogKind[] = ['info', 'error', 'consult', 'done']
const MARKS: readonly LogMark[] = ['✗', '· denied']

export const normalizeMain = (stored: unknown): Main => {
  const m = normalize(DEFAULT_MAIN, stored)
  const s = isObject(stored) && isObject(stored.speed) ? stored.speed : null
  const ttftMs = s ? numOrNull(s.ttftMs) : null
  return { ...m, speed: s && ttftMs !== null ? { ttftMs, tokPerS: numOrNull(s.tokPerS) } : null }
}

export const normalizeTurn = (stored: unknown): Turn => ({
  ...normalize(DEFAULT_TURN, stored),
  costAtStart: isObject(stored) ? numOrNull(stored.costAtStart) : null,
})

// A stored object with no numeric duration is not a receipt, whatever else it holds.
export const normalizeReceipt = (stored: unknown): Receipt | null =>
  isObject(stored) && numOrNull(stored.durationMs) !== null
    ? {
        durationMs: num(stored.durationMs),
        agents: num(stored.agents),
        edits: num(stored.edits),
        errors: num(stored.errors),
        costDelta: numOrNull(stored.costDelta),
        reason: str(stored.reason),
      }
    : null

export const normalizeUsage = (stored: unknown): Usage => {
  const o = isObject(stored) ? stored : {}
  return {
    pct: numOrNull(o.pct),
    tokens: numOrNull(o.tokens),
    window: num(o.window),
    costUsd: numOrNull(o.costUsd),
    limits: objects(o.limits).map((l): Limit => ({ kind: str(l.kind), pct: num(l.pct), resetsAt: numOrNull(l.resetsAt) })),
    compactions: num(o.compactions),
    lastCompactAt: numOrNull(o.lastCompactAt),
  }
}

const normalizeNote = (stored: Record<string, unknown>): ToolNote => ({
  tool: str(stored.tool),
  text: str(stored.text),
  isError: bool(stored.isError),
})

export const normalizeCard = (stored: unknown): AgentCard => {
  const o = isObject(stored) ? stored : {}
  return {
    id: str(o.id),
    type: str(o.type, 'agent'),
    model: str(o.model),
    description: str(o.description),
    status: oneOf(o.status, STATUSES, 'running'),
    spawnedAt: num(o.spawnedAt),
    endedAt: numOrNull(o.endedAt),
    ctx: num(o.ctx),
    out: num(o.out),
    steps: num(o.steps),
    lastStop: strOrNull(o.lastStop),
    tools: objects(o.tools).map(normalizeNote),
    answer: str(o.answer),
  }
}

/** A stored card list: entries that are not objects are dropped rather than read as blank cards. */
export const normalizeAgents = (stored: unknown): AgentCard[] => objects(stored).map(normalizeCard)

export const normalizeLoops = (stored: unknown): Loop[] =>
  objects(stored).map(l => ({ id: str(l.id), steps: num(l.steps), firstAt: num(l.firstAt), lastAt: num(l.lastAt), isDone: bool(l.isDone) }))

/**
 * A stored line's text and marker. A failed or refused call's line stored before the marker had a
 * field of its own ends in it, so the marker is taken off the end of such a line's text.
 */
const markOf = (l: Record<string, unknown>): { text: string; mark: LogMark | null } => {
  const text = String(l.text ?? '')
  if (MARKS.includes(l.mark as LogMark)) return { text, mark: l.mark as LogMark }
  const old = l.mark === undefined && l.kind === 'error' ? MARKS.find(m => text.endsWith(` ${m}`)) : undefined
  return old ? { text: text.slice(0, -(old.length + 1)), mark: old } : { text, mark: null }
}

export const normalizeLog = (stored: unknown): LogLine[] =>
  objects(stored).map(l => ({
    at: num(l.at),
    who: String(l.who ?? ''),
    ...markOf(l),
    agentId: strOrNull(l.agentId),
    kind: oneOf(l.kind, KINDS, 'info'),
  }))

const normalizeConsult = (c: Record<string, unknown>): Consult => ({
  id: str(c.id),
  at: num(c.at),
  endAt: numOrNull(c.endAt),
  moment: oneOf(c.moment, MOMENTS, 'before a plan'),
  via: str(c.via),
})

export const normalizeArchitect = (stored: unknown): Architect => {
  const o = isObject(stored) ? stored : {}
  return { consults: objects(o.consults).map(normalizeConsult), ids: strings(o.ids), seen: strings(o.seen), lastAdvice: str(o.lastAdvice) }
}

export const normalizeActivity = (stored: unknown): Activity => {
  const o = isObject(stored) ? stored : {}
  const tools = objects(o.tools)
    .filter(t => typeof t.tool === 'string' && t.tool !== '')
    .map((t): ToolRow => ({ tool: str(t.tool), calls: num(t.calls), errors: num(t.errors), timedCalls: num(t.timedCalls), timedMs: num(t.timedMs) }))
  return {
    tools,
    files: objects(o.files)
      .filter(f => typeof f.path === 'string' && f.path !== '')
      .map((f): FileRow => ({ path: str(f.path), reads: num(f.reads), edits: num(f.edits), byMain: bool(f.byMain), lastAt: num(f.lastAt) })),
    // The running total outlives evicted rows, but never reads as fewer calls than the rows kept.
    calls: Math.max(num(o.calls), tools.reduce((n, t) => n + t.calls, 0)),
  }
}

export const normalizeTrends = (stored: unknown): Trends => {
  const o = isObject(stored) ? stored : {}
  return {
    samples: objects(o.samples).map((s): Sample => ({ at: num(s.at), ctxPct: numOrNull(s.ctxPct), costUsd: numOrNull(s.costUsd), isCompaction: bool(s.isCompaction) })),
    pendingCompaction: bool(o.pendingCompaction),
  }
}

export const normalizeDenials = (stored: unknown): Denials => ({ count: Math.max(0, num(isObject(stored) ? stored.count : 0)) })

export const normalizeView = (stored: unknown): View => {
  const o = isObject(stored) ? stored : {}
  return { expanded: strOrNull(o.expanded), layout: LAYOUTS.includes(o.layout as Layout) ? (o.layout as Layout) : null }
}

export const normalizeRoster = (stored: unknown): Roster => ({ architectTypes: strings(isObject(stored) ? stored.architectTypes : []) })
