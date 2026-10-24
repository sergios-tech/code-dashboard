// Shared harness for the render tests: the engine stubs every test needs, the pane's mount spec,
// spawn payloads, and a text drawing of a mounted tree for width checks.
import type { AgentSpawnInput, On, RenderElement } from 'claude-code'
import { mock } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import { PANE_ID, PLUGIN } from '../hooks/state/atoms'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_DENIALS,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TRENDS,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
} from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/store'
import type { Draw } from '../hooks/view/draw'
import { buildViewModel } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'

/** The mocked clock, plus answers for the events the plugin passes on but the kit leaves open. */
export const engine = (on: On) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

/** The mount spec of the dashboard pane at a body width; spread it and add the `surface`. */
export const pane = (bodyColumns: number, placement: 'dock' | 'inline' = 'dock') => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: PANE_ID,
  props: {
    title: "Sergio's Tech · Code",
    isFocused: true,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawned = 0

/** An `agent.spawn` payload from the main loop, each with its own tool_use_id. */
export const spawn = (subagentType: string, description: string): AgentSpawnInput => ({
  tool_use_id: `spawn-${++spawned}`,
  prompt: description,
  description,
  subagentType,
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

// ---------------------------------------------------------------- render helpers
//
// Element constructors that build the same plain data a surface's table does, so a renderer can be
// drawn without a mount, a snapshot with nothing in it, and finders over a drawn tree.

export const el =
  (type: string) =>
  ({ children, ...props }: Record<string, unknown> & { children?: unknown[] }) =>
    ({ type, props, children: children ?? [] }) as unknown as RenderElement
export const ELS = { Box: el('Box'), Text: el('Text'), Client: el('Client'), Button: el('Button'), Svg: el('Svg') }
export const draw = (o: Partial<Draw> = {}): Draw => ({ els: ELS as never, C: COLORS, hasClient: true, motion: true, surface: 'terminal', now: 0, ...o })

export const FRESH: Snapshot = {
  main: DEFAULT_MAIN,
  usage: DEFAULT_USAGE,
  turn: DEFAULT_TURN,
  agents: [],
  loops: [],
  architect: DEFAULT_ARCHITECT,
  activity: DEFAULT_ACTIVITY,
  trends: DEFAULT_TRENDS,
  denials: DEFAULT_DENIALS,
  log: [],
  view: DEFAULT_VIEW,
  roster: DEFAULT_ROSTER,
}
export const vmOf = (s: Partial<Snapshot>, bodyColumns = 64, placement: 'dock' | 'inline' = 'dock', now = 0) =>
  buildViewModel({ ...FRESH, ...s }, { cfg: parseConfig({}), now, bodyColumns, placement, viewedAgentId: null })

/** The props of every node of a type in a tree. */
export const found = (tree: unknown, type: string): Record<string, unknown>[] => {
  if (typeof tree !== 'object' || tree === null) return []
  const n = tree as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  return [...(n.type === type ? [n.props ?? {}] : []), ...(n.children ?? []).flatMap(c => found(c, type))]
}

/** One entry per Text node: its own string children joined, with its colour and weight. */
export const texts = (tree: unknown): { text: string; color?: string; bold?: boolean }[] => {
  if (typeof tree !== 'object' || tree === null) return []
  const n = tree as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const kids = n.children ?? []
  const own: { text: string; color?: string; bold?: boolean }[] = []
  if (n.type === 'Text') {
    const { color, bold } = n.props ?? {}
    own.push({
      text: kids.filter((c): c is string => typeof c === 'string').join(''),
      ...(typeof color === 'string' ? { color } : {}),
      ...(typeof bold === 'boolean' ? { bold } : {}),
    })
  }
  return [...own, ...kids.flatMap(texts)]
}

// ---------------------------------------------------------------- text drawing
//
// An approximation of how the terminal lays a tree out, enough to see every row's width: Box rows
// and columns, gaps, padding, margins, borders, `space-between`, truncating and wrapping Text,
// and absolutely placed Boxes painted over their parent inside its border. A row is a list of
// cells; a wide character takes two, the second one empty.

type Node = RenderElement | string
type Row = string[]
type Block = { rows: Row[]; width: number }

const isZeroWidth = (cp: number) => (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0e || cp === 0xfe0f
const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f000 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

const toCells = (s: string): Row => {
  const out: Row = []
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (isZeroWidth(cp) && out.length > 0) out[out.length - 1] += ch
    else if (isWide(cp)) out.push(ch, '')
    else out.push(ch === '\t' ? ' ' : ch)
  }
  return out
}

/** Cells a string takes on the terminal: two for a wide character, none for a combining mark. */
export const cellWidth = (s: string): number => toCells(s).length

const blank = (n: number): Row => Array.from({ length: Math.max(0, n) }, () => ' ')
const padRow = (r: Row, n: number): Row => (r.length >= n ? r : [...r, ...blank(n - r.length)])
const cutRow = (r: Row, n: number): Row => {
  if (r.length <= n) return r
  if (n <= 0) return []
  const kept = r.slice(0, n - 1)
  // The cut falls inside a wide character: its first half becomes a space.
  if (n >= 2 && r[n - 1] === '') kept[n - 2] = ' '
  return [...kept, '…']
}
const block = (rows: Row[]): Block => {
  const width = Math.max(0, ...rows.map(r => r.length))
  return { rows: rows.map(r => padRow(r, width)), width }
}

const isElement = (n: unknown): n is RenderElement => typeof n === 'object' && n !== null && 'type' in n
const propsOf = (n: RenderElement): Record<string, unknown> => ((n as { props?: Record<string, unknown> }).props ?? {})
const kids = (n: RenderElement): Node[] => ((n as { children?: Node[] }).children ?? []).filter(c => c !== null && c !== undefined)

const SPACE: Record<string, number> = { xs: 1, sm: 1, md: 2, lg: 3, xl: 4 }
const space = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? (SPACE[v] ?? 0) : 0)
const firstOf = (p: Record<string, unknown>, ...keys: string[]) => space(keys.map(k => p[k]).find(v => v !== undefined))

const BORDERS: Record<string, string> = { single: '┌┐└┘─│', round: '╭╮╰╯─│', double: '╔╗╚╝═║', bold: '┏┓┗┛━┃', classic: '++++-|' }

const inlineText = (n: Node): string => (typeof n === 'string' ? n : kids(n).map(inlineText).join(''))

const textBlock = (text: string, wrap: unknown, avail: number | undefined): Block => {
  const rows: Row[] = []
  for (const line of text.split('\n')) {
    const cells = toCells(line)
    if (avail === undefined || cells.length <= avail) rows.push(cells)
    else if (typeof wrap === 'string' && wrap !== 'wrap') rows.push(cutRow(cells, avail))
    else for (let i = 0; i < cells.length; i += Math.max(1, avail)) rows.push(cells.slice(i, i + Math.max(1, avail)))
  }
  return block(rows)
}

const leafText = (n: RenderElement): string => {
  const p = propsOf(n)
  switch (n.type) {
    case 'Button': {
      const label = kids(n).length > 0 ? kids(n).map(inlineText).join('') : String(p.label ?? '')
      if (p.plain) return p.hotkey ? `${String(p.hotkey)}: ${label}` : label
      return `[ ${label} ]`
    }
    case 'Code':
      return String(p.source ?? '')
    case 'Markdown':
      return String(p.text ?? '')
    case 'Input':
      return String(p.value ?? p.placeholder ?? '')
    default:
      return inlineText(n)
  }
}

type Clients = ReadonlyMap<string, RenderElement | undefined>

/** `stretch`: a Box with no width of its own takes all of `avail`, as a flex column's child does. */
const layout = (n: Node, avail: number | undefined, clients: Clients, stretch = false): Block => {
  if (typeof n === 'string') return textBlock(n, undefined, avail)
  const p = propsOf(n)
  if (n.type === 'Box') return boxBlock(n, avail, clients, stretch)
  if (n.type === 'Client') {
    const w = typeof p.width === 'number' ? p.width : undefined
    const drawn = typeof p.key === 'string' ? clients.get(p.key) : undefined
    const inner = drawn ? layout(drawn, w ?? avail, clients) : block([blank(w ?? 0)])
    return w === undefined ? inner : block(inner.rows.map(r => padRow(cutRow(r, w), w)))
  }
  if (n.type === 'Svg' || n.type === 'Raster' || n.type === 'Image') return { rows: [], width: 0 }
  return textBlock(leafText(n), p.wrap, avail)
}

const boxBlock = (n: RenderElement, avail: number | undefined, clients: Clients, stretch: boolean): Block => {
  const p = propsOf(n)
  if (p.display === 'none') return { rows: [], width: 0 }
  const border = typeof p.borderStyle === 'string' ? 1 : 0
  const [pt, pb] = [firstOf(p, 'paddingTop', 'paddingY', 'padding'), firstOf(p, 'paddingBottom', 'paddingY', 'padding')]
  const [pl, pr] = [firstOf(p, 'paddingLeft', 'paddingX', 'padding'), firstOf(p, 'paddingRight', 'paddingX', 'padding')]
  const [mt, mb] = [firstOf(p, 'marginTop', 'marginY', 'margin'), firstOf(p, 'marginBottom', 'marginY', 'margin')]
  const [ml, mr] = [firstOf(p, 'marginLeft', 'marginX', 'margin'), firstOf(p, 'marginRight', 'marginX', 'margin')]
  const own =
    typeof p.width === 'number'
      ? p.width
      : typeof p.width === 'string' && avail !== undefined && p.width.endsWith('%')
        ? Math.floor((avail * parseFloat(p.width)) / 100)
        : undefined
  const fixed = own ?? (stretch && avail !== undefined ? Math.max(0, avail - ml - mr) : undefined)
  const outer = fixed ?? (avail === undefined ? undefined : avail - ml - mr)
  const innerAvail = outer === undefined ? undefined : Math.max(0, outer - 2 * border - pl - pr)
  const children = kids(n)
  const flow = children.filter(c => typeof c === 'string' || propsOf(c).position !== 'absolute')
  const placed = children.filter((c): c is RenderElement => typeof c !== 'string' && propsOf(c).position === 'absolute')
  const dir = typeof p.flexDirection === 'string' ? p.flexDirection : 'row'
  const isColumn = dir.startsWith('column')

  let content: Block
  if (isColumn) {
    const gap = firstOf(p, 'rowGap', 'gap')
    const stretches = p.alignItems === undefined || p.alignItems === 'stretch'
    const parts = flow.map(c => layout(c, innerAvail, clients, stretches))
    const rows: Row[] = []
    parts.forEach((b, i) => {
      if (i > 0) for (let g = 0; g < gap; g++) rows.push([])
      rows.push(...b.rows)
    })
    content = block(dir === 'column-reverse' ? rows.reverse() : rows)
  } else {
    const gap = firstOf(p, 'columnGap', 'gap')
    const parts = flow.map(c => layout(c, typeof c !== 'string' && typeof propsOf(c).width === 'number' ? undefined : innerAvail, clients))
    const total = () => parts.reduce((s, b) => s + b.width, 0) + gap * Math.max(0, parts.length - 1)
    // Too wide for the row: shrink the widest child that has no fixed width, as flex-shrink does.
    for (let pass = 0; innerAvail !== undefined && total() > innerAvail && pass < parts.length; pass++) {
      const shrinkable = parts
        .map((b, i) => ({ b, i }))
        .filter(({ i }) => {
          const c = flow[i]
          return c !== undefined && (typeof c === 'string' || (typeof propsOf(c).width !== 'number' && propsOf(c).flexShrink !== 0))
        })
        .sort((x, y) => y.b.width - x.b.width)[0]
      if (!shrinkable) break
      const c = flow[shrinkable.i]
      if (c === undefined) break
      parts[shrinkable.i] = layout(c, Math.max(1, shrinkable.b.width - (total() - innerAvail)), clients)
    }
    const height = Math.max(0, ...parts.map(b => b.rows.length))
    const extra = fixed !== undefined && innerAvail !== undefined ? Math.max(0, innerAvail - total()) : 0
    const gaps = parts.map((_, i) => (i === 0 ? 0 : gap))
    let lead = 0
    if (extra > 0) {
      const grower = flow.findIndex(c => typeof c !== 'string' && space(propsOf(c).flexGrow) > 0)
      if (grower >= 0 && parts[grower]) parts[grower] = block(parts[grower].rows.map(r => padRow(r, (parts[grower]?.width ?? 0) + extra)))
      else if (p.justifyContent === 'space-between' && parts.length > 1) for (let i = 1; i < parts.length; i++) gaps[i] = (gaps[i] ?? 0) + Math.floor(extra / (parts.length - 1)) + (i <= extra % (parts.length - 1) ? 1 : 0)
      else if (p.justifyContent === 'flex-end') lead = extra
      else if (p.justifyContent === 'center') lead = Math.floor(extra / 2)
    }
    const ordered = dir === 'row-reverse' ? [...parts].reverse() : parts
    const rows: Row[] = []
    for (let y = 0; y < height; y++) {
      const row: Row = blank(lead)
      ordered.forEach((b, i) => row.push(...blank(gaps[i] ?? 0), ...(b.rows[y] ?? blank(b.width))))
      rows.push(row)
    }
    content = block(rows)
  }

  const innerWidth = innerAvail !== undefined && fixed !== undefined ? Math.max(innerAvail, content.width) : content.width
  const width = innerWidth + pl + pr + 2 * border
  const body: Row[] = [
    ...Array.from({ length: pt }, () => blank(width - 2 * border)),
    ...content.rows.map(r => [...blank(pl), ...padRow(r, innerWidth), ...blank(pr)]),
    ...Array.from({ length: pb }, () => blank(width - 2 * border)),
  ]
  const chars = BORDERS[String(p.borderStyle)] ?? BORDERS.single ?? ''
  const [tl, tr, bl, br, h, v] = Array.from(chars)
  const rows: Row[] = border
    ? [[tl ?? '', ...Array.from({ length: width - 2 }, () => h ?? ''), tr ?? ''], ...body.map(r => [v ?? '', ...r, v ?? '']), [bl ?? '', ...Array.from({ length: width - 2 }, () => h ?? ''), br ?? '']]
    : body

  // Absolutely placed children: offsets from inside the border, paint clipped to that area.
  for (const c of placed) {
    const cp = propsOf(c)
    const b = layout(c, width - 2 * border, clients)
    const top = typeof cp.top === 'number' ? border + cp.top : typeof cp.bottom === 'number' ? rows.length - border - cp.bottom - b.rows.length : border
    const left = typeof cp.left === 'number' ? border + cp.left : typeof cp.right === 'number' ? width - border - cp.right - b.width : border
    b.rows.forEach((r, dy) => {
      const y = top + dy
      const target = rows[y]
      if (!target || y < border || y >= rows.length - border) return
      r.forEach((cell, dx) => {
        const x = left + dx
        if (x >= border && x < width - border) target[x] = cell
      })
    })
  }

  const margined = rows.map(r => [...blank(ml), ...r, ...blank(mr)])
  return block([...Array.from({ length: mt }, (): Row => []), ...margined, ...Array.from({ length: mb }, (): Row => [])])
}

const clientKeys = (n: Node): string[] => {
  if (typeof n === 'string') return []
  const own = n.type === 'Client' && typeof propsOf(n).key === 'string' ? [String(propsOf(n).key)] : []
  return [...own, ...kids(n).flatMap(clientKeys)]
}

/** The text rows of a tree, as the terminal would lay it out (see above); `clients` are what each `Client` drew, by key. */
export const drawRows = (tree: RenderElement, clients: Clients = new Map()): string[] => layout(tree, undefined, clients).rows.map(r => r.join(''))

/** A mounted drawing flattened into its text rows, each `Client` region filled with what its module drew. */
export async function rowsOf(ui: { drawn: (scope?: { in?: string }) => Promise<RenderElement> }): Promise<string[]> {
  const tree = await ui.drawn()
  const clients = new Map<string, RenderElement | undefined>()
  for (const key of clientKeys(tree)) clients.set(key, await ui.drawn({ in: key }).catch(() => undefined))
  return drawRows(tree, clients)
}
