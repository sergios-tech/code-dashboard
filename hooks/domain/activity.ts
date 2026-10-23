// Tools and files: what one tool call adds to the session's tallies, which tools and files lead,
// and when a call's time may join its tool's average. Pure.
import type { Activity, FileRow, ToolRow } from '../../types'
import { redact } from '../format/redact'
import { fmtDuration, shorten } from '../format/text'
import { EDIT_TOOLS } from './turn'

/** Distinct tools kept; when full, the one with the fewest calls makes room. */
export const TOOLS_MAX = 40
/** Distinct files kept; when full, the one touched least makes room. */
export const FILES_MAX = 200

/** The tools that read a file or a folder, named by `file_path` or `path`. */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
/** A stored path is cut to this many characters, so a pathological name cannot bloat the list. */
const PATH_MAX = 120

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A path's last two segments, `/` and `\` alike, masked first so a cut never leaves half a token. */
const trimPath = (p: string): string => shorten(redact(p).split(/[\\/]+/).filter(Boolean).slice(-2).join('/'), PATH_MAX)

/** The file a call reads or edits, its path trimmed and masked; null for a call on no file. */
export const fileOf = (tool: string, input: unknown): { path: string; kind: 'read' | 'edit' } | null => {
  const i = isRecord(input) ? input : {}
  const isRead = READ_TOOLS.has(tool)
  const raw = isRead
    ? str(i.file_path) || str(i.path)
    : tool === 'NotebookEdit'
      ? str(i.notebook_path) || str(i.file_path)
      : EDIT_TOOLS.has(tool)
        ? str(i.file_path)
        : ''
  const path = raw ? trimPath(raw) : ''
  return path ? { path, kind: isRead ? 'read' : 'edit' } : null
}

/**
 * One finished tool call. `ms` is null when the call is not timed; `didRun` is false for a refused
 * call, which still counts as a call but touches no file.
 */
export type Call = { tool: string; input: unknown; hasFailed: boolean; inSubagent: boolean; ms: number | null; at: number; didRun?: boolean }

/** The entry to drop: the lowest `weight`, a tie going to the oldest `age`, then to the first in the list. */
const victim = <T>(list: T[], weight: (x: T) => number, age: (x: T) => number): number =>
  list.reduce((best, x, i) => {
    const b = list[best]
    if (b === undefined) return i
    return weight(x) < weight(b) || (weight(x) === weight(b) && age(x) < age(b)) ? i : best
  }, 0)

/** `list` with room for one more entry, dropping `victim`'s pick while it is full. */
const makeRoom = <T>(list: T[], max: number, weight: (x: T) => number, age: (x: T) => number): T[] => {
  const out = [...list]
  while (out.length >= max && out.length > 0) out.splice(victim(out, weight, age), 1)
  return out
}

const touches = (f: FileRow): number => f.reads + f.edits

/** The tallies after one call: its tool's row, and the row of the file it read or edited. */
export const recordCall = (a: Activity, c: Call): Activity => {
  const timed = c.ms !== null && Number.isFinite(c.ms) ? Math.max(0, c.ms) : null
  const toolRow = (r: ToolRow | undefined): ToolRow => ({
    tool: c.tool,
    calls: (r?.calls ?? 0) + 1,
    errors: (r?.errors ?? 0) + (c.hasFailed ? 1 : 0),
    timedCalls: (r?.timedCalls ?? 0) + (timed === null ? 0 : 1),
    timedMs: (r?.timedMs ?? 0) + (timed ?? 0),
  })
  const t = a.tools.findIndex(r => r.tool === c.tool)
  // Tool rows keep no time of their own, so a tie in calls goes to the first in the list.
  const tools = t >= 0 ? a.tools.map((r, i) => (i === t ? toolRow(r) : r)) : [...makeRoom(a.tools, TOOLS_MAX, r => r.calls, () => 0), toolRow(undefined)]

  // A refused or failed call did not get to the file.
  const touched = c.didRun === false || c.hasFailed ? null : fileOf(c.tool, c.input)
  if (!touched) return { tools, files: a.files }
  const fileRow = (r: FileRow | undefined): FileRow => ({
    path: touched.path,
    reads: (r?.reads ?? 0) + (touched.kind === 'read' ? 1 : 0),
    edits: (r?.edits ?? 0) + (touched.kind === 'edit' ? 1 : 0),
    byMain: (r?.byMain ?? false) || !c.inSubagent,
    lastAt: c.at,
  })
  const f = a.files.findIndex(r => r.path === touched.path)
  const files = f >= 0 ? a.files.map((r, i) => (i === f ? fileRow(r) : r)) : [...makeRoom(a.files, FILES_MAX, touches, r => r.lastAt), fileRow(undefined)]
  return { tools, files }
}

/** The `n` tools with the most calls, most first; a tie keeps the list's order. */
export const topTools = (a: Activity, n: number): ToolRow[] => [...a.tools].sort((x, y) => y.calls - x.calls).slice(0, Math.max(0, n))

/** The `n` files touched most, most first; a tie goes to the one touched last. */
export const hotFiles = (a: Activity, n: number): FileRow[] =>
  [...a.files].sort((x, y) => touches(y) - touches(x) || y.lastAt - x.lastAt).slice(0, Math.max(0, n))

/** All calls the tallies hold. */
export const totalCalls = (a: Activity): number => a.tools.reduce((n, r) => n + r.calls, 0)

/** A tool's average time over its timed calls; null while none was timed. */
export const avgMs = (r: ToolRow): number | null => (r.timedCalls > 0 ? r.timedMs / r.timedCalls : null)

/**
 * A call's time for its tool's average, or null when it is not timed. The clock is read around the
 * whole call, so a call that waited on an approval prompt, one refused, and `Agent` (which runs a
 * foreground subagent to its end) would measure something other than the tool.
 */
export const timedMs = (didRun: boolean, wasAsked: boolean, tool: string, elapsed: number): number | null =>
  didRun && !wasAsked && tool !== 'Agent' && Number.isFinite(elapsed) ? Math.max(0, elapsed) : null

/** `avg* 0.4s`, `avg* 45ms`, `avg* 1m05s`, or `avg* —` with nothing timed; the `*` says it is inferred. */
export const avgLabel = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms)) return 'avg* —'
  if (ms < 100) return `avg* ${Math.round(ms)}ms`
  return ms < 60_000 ? `avg* ${(ms / 1000).toFixed(1)}s` : `avg* ${fmtDuration(ms)}`
}
