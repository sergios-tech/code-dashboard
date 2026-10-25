// A tree laid out as the terminal would lay it out, cell by cell, each cell with its colour and
// weight. It is an approximation, enough to see every row's width and to draw the same rows as a
// picture: Box rows and columns, gaps, padding, margins, borders, `space-between`, truncating and
// wrapping Text, and absolutely placed Boxes painted over their parent. The test kit reads the
// rows as text, and `picture.ts` reads them as shapes. A wide character takes two cells, the second
// one empty.
import type { RenderElement } from 'claude-code'

import { fmtTimer } from '../format/text'

/** One terminal cell: its character, and the colour, weight and animation tag of the Text it came from. */
export type Cell = { ch: string; fg?: string; bold?: boolean; tag?: string }

type Style = Omit<Cell, 'ch'>
type Row = Cell[]
type Block = { rows: Row[]; width: number }
type Node = RenderElement | string
/** What a `Client` region draws, for the layout: a stand-in element, or null for an empty region. */
type Resolve = (client: RenderElement) => RenderElement | null

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

/** A string as cells in one style: two for a wide character, none of their own for a combining mark. */
export const cellsOf = (s: string, st: Style = {}): Row => {
  const out: Row = []
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    const last = out[out.length - 1]
    if (isZeroWidth(cp) && last) last.ch += ch
    else if (isWide(cp)) out.push({ ...st, ch }, { ...st, ch: '' })
    else out.push({ ...st, ch: ch === '\t' ? ' ' : ch })
  }
  return out
}

const blank = (n: number): Row => Array.from({ length: Math.max(0, n) }, () => ({ ch: ' ' }))
const padRow = (r: Row, n: number): Row => (r.length >= n ? r : [...r, ...blank(n - r.length)])
const cutRow = (r: Row, n: number): Row => {
  if (r.length <= n) return r
  if (n <= 0) return []
  const kept = r.slice(0, n - 1)
  // The cut falls inside a wide character: its first half becomes a space.
  if (n >= 2 && r[n - 1]?.ch === '') kept[n - 2] = { ...kept[n - 2], ch: ' ' }
  return [...kept, { ...r[n - 1], ch: '…' }]
}
const block = (rows: Row[]): Block => {
  const width = Math.max(0, ...rows.map(r => r.length))
  return { rows: rows.map(r => padRow(r, width)), width }
}

const propsOf = (n: RenderElement): Record<string, unknown> => (n as { props?: Record<string, unknown> }).props ?? {}
const kids = (n: RenderElement): Node[] =>
  ((n as { children?: unknown[] }).children ?? []).flat(Infinity).flatMap((c): Node[] => (typeof c === 'number' ? [String(c)] : typeof c === 'string' || (typeof c === 'object' && c !== null) ? [c as Node] : []))

const SPACE: Record<string, number> = { xs: 1, sm: 1, md: 2, lg: 3, xl: 4 }
const space = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? (SPACE[v] ?? 0) : 0)
const firstOf = (p: Record<string, unknown>, ...keys: string[]) => space(keys.map(k => p[k]).find(v => v !== undefined))

const BORDERS: Record<string, string> = { single: '┌┐└┘─│', round: '╭╮╰╯─│', double: '╔╗╚╝═║', bold: '┏┓┗┛━┃', classic: '++++-|' }

/** A node's own style on top of the one it inherits: nested Texts add to their parent's. */
const styleOf = (p: Record<string, unknown>, inherited: Style): Style => {
  const fg = typeof p.color === 'string' ? p.color : inherited.fg
  const bold = p.bold === true || inherited.bold === true
  const tag = typeof p.tag === 'string' ? p.tag : inherited.tag
  return { ...(fg !== undefined ? { fg } : {}), ...(bold ? { bold } : {}), ...(tag !== undefined ? { tag } : {}) }
}

/** The runs of a Text as styled lines; a `\n` starts a new one. */
const styledLines = (n: Node, st: Style): Row[] => {
  const lines: Row[] = [[]]
  const add = (node: Node, s: Style) => {
    if (typeof node === 'string') {
      node.split('\n').forEach((part, i) => {
        if (i > 0) lines.push([])
        lines[lines.length - 1]?.push(...cellsOf(part, s))
      })
      return
    }
    const next = styleOf(propsOf(node), s)
    for (const c of kids(node)) add(c, next)
  }
  add(n, st)
  return lines
}

/** `pre` before the first line and `post` after the last. */
const affix = (lines: Row[], pre: string, post: string): Row[] =>
  lines.map((l, i) => [...(i === 0 ? cellsOf(pre) : []), ...l, ...(i === lines.length - 1 ? cellsOf(post) : [])])

const leafLines = (n: RenderElement): Row[] => {
  const p = propsOf(n)
  switch (n.type) {
    case 'Button': {
      const lines = kids(n).length > 0 ? styledLines(n, {}) : styledLines(String(p.label ?? ''), styleOf(p, {}))
      return p.plain ? affix(lines, p.hotkey ? `${String(p.hotkey)}: ` : '', '') : affix(lines, '[ ', ' ]')
    }
    case 'Code':
      return styledLines(String(p.source ?? ''), {})
    case 'Markdown':
      return styledLines(String(p.text ?? ''), {})
    case 'Input':
      return styledLines(String(p.value ?? p.placeholder ?? ''), {})
    default:
      return styledLines(n, {})
  }
}

const textBlock = (lines: Row[], wrap: unknown, avail: number | undefined): Block => {
  const rows: Row[] = []
  for (const cells of lines) {
    if (avail === undefined || cells.length <= avail) rows.push(cells)
    else if (typeof wrap === 'string' && wrap !== 'wrap') rows.push(cutRow(cells, avail))
    else for (let i = 0; i < cells.length; i += Math.max(1, avail)) rows.push(cells.slice(i, i + Math.max(1, avail)))
  }
  return block(rows)
}

/** `stretch`: a Box with no width of its own takes all of `avail`, as a flex column's child does. */
const layout = (n: Node, avail: number | undefined, resolve: Resolve, stretch = false): Block => {
  if (typeof n === 'string') return textBlock(styledLines(n, {}), undefined, avail)
  const p = propsOf(n)
  if (n.type === 'Box') return boxBlock(n, avail, resolve, stretch)
  if (n.type === 'Client') {
    const w = typeof p.width === 'number' ? p.width : undefined
    const drawn = resolve(n)
    const inner = drawn ? layout(drawn, w ?? avail, resolve) : block([blank(w ?? 0)])
    return w === undefined ? inner : block(inner.rows.map(r => padRow(cutRow(r, w), w)))
  }
  if (n.type === 'Svg' || n.type === 'Raster' || n.type === 'Image') return { rows: [], width: 0 }
  return textBlock(leafLines(n), p.wrap, avail)
}

const boxBlock = (n: RenderElement, avail: number | undefined, resolve: Resolve, stretch: boolean): Block => {
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
    const parts = flow.map(c => layout(c, innerAvail, resolve, stretches))
    const rows: Row[] = []
    parts.forEach((b, i) => {
      if (i > 0) for (let g = 0; g < gap; g++) rows.push([])
      rows.push(...b.rows)
    })
    content = block(dir === 'column-reverse' ? rows.reverse() : rows)
  } else {
    const gap = firstOf(p, 'columnGap', 'gap')
    const parts = flow.map(c => layout(c, typeof c !== 'string' && typeof propsOf(c).width === 'number' ? undefined : innerAvail, resolve))
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
      parts[shrinkable.i] = layout(c, Math.max(1, shrinkable.b.width - (total() - innerAvail)), resolve)
    }
    const height = Math.max(0, ...parts.map(b => b.rows.length))
    const extra = fixed !== undefined && innerAvail !== undefined ? Math.max(0, innerAvail - total()) : 0
    const gaps = parts.map((_, i) => (i === 0 ? 0 : gap))
    let lead = 0
    if (extra > 0) {
      const grower = flow.findIndex(c => typeof c !== 'string' && space(propsOf(c).flexGrow) > 0)
      const g = parts[grower]
      if (grower >= 0 && g) parts[grower] = block(g.rows.map(r => padRow(r, g.width + extra)))
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
  const [tl, tr, bl, br, h, v] = Array.from(BORDERS[String(p.borderStyle)] ?? BORDERS.single ?? '')
  const bs: Style = typeof p.borderColor === 'string' ? { fg: p.borderColor } : {}
  const edge = (l: string | undefined, r: string | undefined): Row => [{ ...bs, ch: l ?? '' }, ...Array.from({ length: Math.max(0, width - 2) }, () => ({ ...bs, ch: h ?? '' })), { ...bs, ch: r ?? '' }]
  const rows: Row[] = border ? [edge(tl, tr), ...body.map(r => [{ ...bs, ch: v ?? '' }, ...r, { ...bs, ch: v ?? '' }]), edge(bl, br)] : body

  // Absolutely placed children: offsets from inside the border. A placed row may reach the border
  // itself (the frame's `├───┤` dividers do); what falls outside the Box is clipped.
  for (const c of placed) {
    const cp = propsOf(c)
    const b = layout(c, width - 2 * border, resolve)
    const top = typeof cp.top === 'number' ? border + cp.top : typeof cp.bottom === 'number' ? rows.length - border - cp.bottom - b.rows.length : border
    const left = typeof cp.left === 'number' ? border + cp.left : typeof cp.right === 'number' ? width - border - cp.right - b.width : border
    b.rows.forEach((r, dy) => {
      const target = rows[top + dy]
      if (!target) return
      r.forEach((cell, dx) => {
        const x = left + dx
        if (x >= 0 && x < width) target[x] = cell
      })
    })
  }

  const margined = rows.map(r => [...blank(ml), ...r, ...blank(mr)])
  return block([...Array.from({ length: mt }, (): Row => []), ...margined, ...Array.from({ length: mb }, (): Row => [])])
}

/**
 * The cells of `tree` in `width` columns (`undefined`: as wide as it comes), one list per row.
 * `resolve` gives what each `Client` region draws, or null to leave it blank.
 */
export const layoutCells = (tree: RenderElement, width: number | undefined, resolve: Resolve): Cell[][] => layout(tree, width, resolve, true).rows

/**
 * What each known client module draws, as plain elements, for a layout that cannot run one. A clock
 * is its value at this draw; a sweep is its `▱` track tagged `sweep:<colour>`, and a pulse is its
 * `●` tagged `pulse:<on>:<off>`, for the picture to animate. Any other client draws nothing.
 */
export const standIn = (client: RenderElement): RenderElement | null => {
  const p = propsOf(client)
  const file = String(p.module ?? '')
  const q = (typeof p.props === 'object' && p.props !== null ? p.props : {}) as Record<string, unknown>
  const text = (content: string, props: Record<string, unknown>): RenderElement => ({ type: 'Text', props, children: [content] }) as unknown as RenderElement
  if (file.endsWith('elapsed.tsx')) {
    const since = Number(q.since)
    const end = typeof q.endAt === 'number' ? q.endAt : Number(q.now)
    return text(since > 0 ? fmtTimer(end - since) : '—', { color: q.color })
  }
  if (file.endsWith('sweep.tsx')) return text('▱'.repeat(Math.max(1, Number(q.width) || 1)), { color: q.track, tag: `sweep:${String(q.color)}` })
  if (file.endsWith('pulse.tsx')) return text('●', { color: q.color, bold: true, tag: `pulse:${String(q.color)}:${String(q.dim)}` })
  return null
}
