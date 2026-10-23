// Subagent cards and the other model loops: what a spawn, a step, a tool call and an end do to
// them, the shared time axis of the lanes, and how a title fits a card. Pure.
import type { AgentCard, AgentStatus, Loop, ToolNote } from '../../types'
import { redact } from '../format/redact'
import { shorten } from '../format/text'

/** Cards kept; the oldest goes first. */
export const AGENTS_MAX = 24
/** Other loops kept; the one heard from longest ago goes first. */
export const LOOPS_MAX = 60
/** A loop that stepped this recently, and has not ended, counts as active. */
export const LOOP_ACTIVE_MS = 15_000

/** Tool calls a card remembers, newest last. */
const TOOLS_KEPT = 3
const DESCRIPTION_MAX = 400
const ANSWER_MAX = 400
const NOTE_MAX = 120
/** Cells one card needs, and the gap between two cards. */
const CARD_MIN = 20
const CARD_GAP = 1

/** The state glyph beside every status, so a status is never told by colour alone. */
export const AGENT_GLYPH: Record<AgentStatus, string> = { running: '●', done: '✓', failed: '✗', stopped: '■' }

// ---------------------------------------------------------------- terminal cells

/** Code points a terminal draws two cells wide: CJK, Hangul, full-width forms and emoji. */
const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x1faff],
  [0x20000, 0x3fffd],
]

const cellsOf = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0e || cp === 0xfe0f) return 0
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1
}

/** One line: newlines, tabs and other control characters become single spaces. */
const flat = (s: unknown): string => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim() : '')

/** Cells `s` takes on a terminal. */
export const cellCount = (s: string): number => Array.from(s).reduce((n, ch) => n + cellsOf(ch), 0)

/** `s` on one row of at most `n` terminal cells, ending in `…` when it had to be cut. */
export const fitCells = (s: string, n: number): string => {
  const one = flat(s)
  if (n <= 0) return ''
  if (cellCount(one) <= n) return one
  let out = ''
  let used = 0
  for (const ch of one) {
    const w = cellsOf(ch)
    if (used + w > n - 1) break
    out += ch
    used += w
  }
  return `${out.trimEnd()}…`
}

// ---------------------------------------------------------------- cards

/** A card for a subagent that has just started. Its task is masked for credentials before it is kept. */
export const newCard = (p: { id: string; type: string; model: string; description: string; at: number }): AgentCard => ({
  id: p.id,
  type: flat(p.type) || 'agent',
  model: typeof p.model === 'string' ? p.model : '',
  description: shorten(redact(typeof p.description === 'string' ? p.description : ''), DESCRIPTION_MAX),
  status: 'running',
  spawnedAt: p.at,
  endedAt: null,
  ctx: 0,
  out: 0,
  steps: 0,
  lastStop: null,
  tools: [],
  answer: '',
})

const count = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * The card after one model request: `ctx` is that request's whole input (uncached, cache read and
 * cache written), `out` adds up across requests. A request with no usage still counts as a step.
 */
export const applyStep = (
  c: AgentCard,
  s: {
    model: string
    usage: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | null
    stopReason: string | null
  },
): AgentCard => {
  const u = s.usage
  return {
    ...c,
    model: typeof s.model === 'string' && s.model !== '' ? s.model : c.model,
    steps: c.steps + 1,
    ctx: u ? count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens) : c.ctx,
    out: c.out + (u ? count(u.output_tokens) : 0),
    lastStop: s.stopReason ?? c.lastStop,
  }
}

/** The card with one more tool call remembered, the last three kept, its text masked and cut. */
export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({
  ...c,
  tools: [...c.tools, { ...n, text: shorten(redact(n.text), NOTE_MAX) }].slice(-TOOLS_KEPT),
})

/** The card once its run ended: `answer` is done, `aborted` is stopped, any other reason failed. */
export const finishCard = (c: AgentCard, reason: string, answer: string, at: number): AgentCard => ({
  ...c,
  status: reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed',
  endedAt: at,
  answer: shorten(redact(typeof answer === 'string' ? answer : ''), ANSWER_MAX),
})

/** `list` with `c` last, replacing any card of its id, kept to the newest AGENTS_MAX. */
export const addCard = (list: AgentCard[], c: AgentCard): AgentCard[] => [...list.filter(x => x.id !== c.id), c].slice(-AGENTS_MAX)

/** What a card is called: its task on one line, or its type when it was given none. */
export const cardTitle = (c: AgentCard): string => flat(c.description) || c.type || 'agent'

/** A card as the log names it, within the log's source column. */
export const whoOf = (c: AgentCard): string => fitCells(cardTitle(c), 11)

/**
 * A title on a card's two title rows: the words that fit `first` cells, then the rest cut to
 * `rest` cells. A first word wider than the first row is split across the two.
 */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const words = flat(title).split(' ').filter(Boolean)
  let head = ''
  let i = 0
  for (; i < words.length; i++) {
    const next = head ? `${head} ${words[i]}` : (words[i] ?? '')
    if (cellCount(next) > first) break
    head = next
  }
  let tail = words.slice(i).join(' ')
  if (head === '' && tail !== '' && first > 0) {
    const chars = Array.from(tail)
    let used = 0
    let k = 0
    while (k < chars.length && used + cellsOf(chars[k] ?? '') <= first) used += cellsOf(chars[k++] ?? '')
    head = chars.slice(0, k).join('')
    tail = chars.slice(k).join('')
  }
  return [head, fitCells(tail, rest)]
}

/** How many cards fit side by side in `width` cells, each at least 20 wide with a gap between. */
export const cardFit = (width: number, maxCards: number): number => Math.max(1, Math.min(maxCards, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP))))

/**
 * Each card's lane on one shared axis, `width` cells from the earliest known spawn to now: the
 * cells before it started, its bar (at least one cell) and the cells after it ended.
 */
export const lanes = (cards: AgentCard[], now: number, width: number): { id: string; before: number; bar: number; after: number }[] => {
  const w = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1))
  const known = cards.map(c => c.spawnedAt).filter(t => t > 0)
  const start = known.length > 0 ? Math.min(...known) : now
  const end = Math.max(now, start, ...cards.map(c => c.endedAt ?? 0))
  const span = Math.max(1, end - start)
  const cell = (t: number) => Math.round(((Math.min(Math.max(t, start), end) - start) / span) * w)
  return cards.map(c => {
    const before = Math.min(w - 1, cell(c.spawnedAt > 0 ? c.spawnedAt : start))
    const bar = Math.max(1, Math.min(w - before, cell(c.endedAt ?? now) - before))
    return { id: c.id, before, bar, after: w - before - bar }
  })
}

// ---------------------------------------------------------------- other loops

/** One more model request in a loop no card claims; a loop first heard from is added. */
export const stepLoop = (loops: Loop[], id: string, at: number): Loop[] => {
  if (loops.some(l => l.id === id)) return loops.map(l => (l.id === id ? { ...l, steps: l.steps + 1, lastAt: at, isDone: false } : l))
  const list = [...loops, { id, steps: 1, firstAt: at, lastAt: at, isDone: false }]
  while (list.length > LOOPS_MAX) {
    // Full: the loop heard from longest ago makes room, the first of a tie.
    const oldest = list.reduce((o, l, i) => (l.lastAt < (list[o]?.lastAt ?? Number.POSITIVE_INFINITY) ? i : o), 0)
    list.splice(oldest, 1)
  }
  return list
}

/** A loop's run ended. */
export const finishLoop = (loops: Loop[], id: string, at: number): Loop[] => loops.map(l => (l.id === id ? { ...l, isDone: true, lastAt: at } : l))

export const isLoopActive = (l: Loop, now: number): boolean => !l.isDone && now - l.lastAt < LOOP_ACTIVE_MS
