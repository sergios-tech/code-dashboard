// Off the terminal each block of the pane is one picture: an SVG drawn from the cells the terminal
// would show. Letters are set word by word at their own cells and fitted with `textLength`, so no
// font can push a column; the graphic glyphs (frame lines, gauge and spark cells, rules) are shapes.
// The sweep and the pulse animate in SMIL, since a picture holds no client module.
import type { RenderElement } from 'claude-code'

import { layoutCells, standIn } from './cells'
import type { Cell } from './cells'
import type { Draw } from './draw'
import { escapeXml } from './svg'
import { COLORS } from './palette'

/** One cell in CSS pixels, and one row: about what the desktop's panel font gives a `ch` and a line. */
export const CELL_PX = 7.8
export const ROW_PX = 17
/** The most characters one SVG may hold. */
export const SVG_MAX = 131_072
const FONT_PX = 13
const MONO = "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace"
/** The sweep's block, in cells, and the time it takes to step one cell. */
const SWEEP_CELLS = 3
const SWEEP_STEP_S = 0.1

type Node = RenderElement | string

const propsOf = (n: RenderElement): Record<string, unknown> => (n as { props?: Record<string, unknown> }).props ?? {}
const kids = (n: RenderElement): Node[] => ((n as { children?: unknown[] }).children ?? []).flat(Infinity).filter((c): c is Node => typeof c === 'string' || (typeof c === 'object' && c !== null))

/** Which of a cell's four edges a frame glyph reaches: left, right, up, down. */
const ARMS: Record<string, string> = {
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ru', '┘': 'lu', '├': 'udr', '┤': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'lrud',
  '╭': 'rd', '╮': 'ld', '╰': 'ru', '╯': 'lu',
}
const SPARK = '▁▂▃▄▅▆▇█'

const isGraphic = (ch: string): boolean => ch in ARMS || '━▰▱▮▯'.includes(ch) || SPARK.includes(ch)
const px = (n: number): string => String(Math.round(n * 100) / 100)

/** The shape of one graphic cell at column x, row y. */
const shape = (c: Cell, x: number, y: number): string => {
  const fg = c.fg ?? COLORS.text
  const X = x * CELL_PX
  const Y = y * ROW_PX
  const cx = X + CELL_PX / 2
  const cy = Y + ROW_PX / 2
  const arms = ARMS[c.ch]
  if (arms) {
    const seg = (a: string) => (a === 'l' ? `M${px(cx)} ${px(cy)}H${px(X)}` : a === 'r' ? `M${px(cx)} ${px(cy)}H${px(X + CELL_PX)}` : a === 'u' ? `M${px(cx)} ${px(cy)}V${px(Y)}` : `M${px(cx)} ${px(cy)}V${px(Y + ROW_PX)}`)
    return `<path d="${Array.from(arms).map(seg).join('')}" stroke="${fg}" fill="none"/>`
  }
  if (c.ch === '━') return `<rect x="${px(X)}" y="${px(cy - 1.5)}" width="${px(CELL_PX)}" height="3" fill="${fg}"/>`
  if (c.ch === '▰' || c.ch === '▱') return `<rect x="${px(X + 0.8)}" y="${px(cy - 4)}" width="${px(CELL_PX - 1.6)}" height="8" fill="${fg}"/>`
  if (c.ch === '▮' || c.ch === '▯') return `<rect x="${px(X + 1.5)}" y="${px(cy - 5)}" width="${px(CELL_PX - 3)}" height="10" fill="${fg}"/>`
  const h = (ROW_PX - 2) * ((SPARK.indexOf(c.ch) + 1) / 8)
  return `<rect x="${px(X)}" y="${px(Y + ROW_PX - 1 - h)}" width="${px(CELL_PX)}" height="${px(h)}" fill="${fg}"/>`
}

const sameStyle = (a: Cell, b: Cell): boolean => a.fg === b.fg && a.bold === b.bold && a.tag === b.tag

/** The sweep over a track of `n` cells from column x: a three-cell block stepping to the end and back. */
const sweep = (color: string, n: number, x: number, y: number): string => {
  const block = Math.min(SWEEP_CELLS, n)
  const last = Math.max(0, n - SWEEP_CELLS)
  const at = (s: number) => px((x + s) * CELL_PX + 0.8)
  const attrs = `y="${px(y * ROW_PX + ROW_PX / 2 - 4)}" width="${px(block * CELL_PX - 1.6)}" height="8" fill="${color}"`
  if (last === 0) return `<rect x="${at(0)}" ${attrs}/>`
  // Out along the track and back, one cell a step, without repeating either end.
  const steps = [...Array.from({ length: last + 1 }, (_, i) => i), ...Array.from({ length: last - 1 }, (_, i) => last - 1 - i)]
  return `<rect x="${at(0)}" ${attrs}><animate attributeName="x" values="${steps.map(at).join(';')}" dur="${px(steps.length * SWEEP_STEP_S)}s" calcMode="discrete" repeatCount="indefinite"/></rect>`
}

/** Rows of cells as one SVG document on black, `width` cells wide. */
export const rowsSvg = (rows: Cell[][], width: number): string => {
  const out: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const c = row[x] as Cell
      if (c.tag?.startsWith('sweep:')) {
        let n = 0
        while (row[x + n]?.tag === c.tag) n++
        for (let i = 0; i < n; i++) out.push(shape({ ...c, ch: '▱' }, x + i, y))
        out.push(sweep(c.tag.slice('sweep:'.length), n, x, y))
        x += n
        continue
      }
      if (c.tag?.startsWith('pulse:')) {
        const [, on, off] = c.tag.split(':')
        out.push(`<circle cx="${px(x * CELL_PX + CELL_PX / 2)}" cy="${px(y * ROW_PX + ROW_PX / 2)}" r="3.6" fill="${on}"><animate attributeName="fill" values="${on};${off}" dur="1.2s" calcMode="discrete" repeatCount="indefinite"/></circle>`)
        x += 1
        continue
      }
      if (c.ch === '─' || c.ch === '━') {
        // A rule is one stroke across its run of cells.
        let n = 1
        while (row[x + n]?.ch === c.ch && !row[x + n]?.tag && sameStyle(c, row[x + n] as Cell)) n++
        const fg = c.fg ?? COLORS.text
        const cy = y * ROW_PX + ROW_PX / 2
        out.push(
          c.ch === '─'
            ? `<path d="M${px(x * CELL_PX)} ${px(cy)}H${px((x + n) * CELL_PX)}" stroke="${fg}" fill="none"/>`
            : `<rect x="${px(x * CELL_PX)}" y="${px(cy - 1.5)}" width="${px(n * CELL_PX)}" height="3" fill="${fg}"/>`,
        )
        x += n
        continue
      }
      if (isGraphic(c.ch)) {
        out.push(shape(c, x, y))
        x += 1
        continue
      }
      let n = 1
      while (x + n < row.length && !isGraphic((row[x + n] as Cell).ch) && !(row[x + n] as Cell).tag && sameStyle(c, row[x + n] as Cell)) n++
      // Each word at its own cell: an SVG collapses the spaces inside a run, and `textLength` would
      // then spread the letters over the gap.
      const weight = c.bold ? ' font-weight="700"' : ''
      let k = x
      while (k < x + n) {
        if ((row[k] as Cell).ch === ' ') {
          k++
          continue
        }
        let m = 0
        while (k + m < x + n && (row[k + m] as Cell).ch !== ' ') m++
        const word = row
          .slice(k, k + m)
          .map(q => q.ch)
          .join('')
        out.push(`<text x="${px(k * CELL_PX)}" y="${px(y * ROW_PX + 12.5)}" textLength="${(m * CELL_PX).toFixed(1)}" lengthAdjust="spacingAndGlyphs" fill="${c.fg ?? COLORS.text}"${weight}>${escapeXml(word)}</text>`)
        k += m
      }
      x += n
    }
  })
  const w = Math.ceil(width * CELL_PX)
  const h = rows.length * ROW_PX
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${MONO}" font-size="${FONT_PX}" xml:space="preserve">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${COLORS.fill}"/>` +
    out.join('') +
    '</svg>'
  )
}

/** What a picture says to a reader that cannot see it: its rows' words, without the frame lines. */
const altOf = (rows: Cell[][]): string =>
  rows
    .map(r => r.map(c => c.ch).join('').replace(/[┌┐└┘├┤│─━]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('; ')

/** The rows as one SVG, or as the fewest consecutive SVGs that each fit under the cap. */
const fitted = (rows: Cell[][], width: number): { rows: Cell[][]; svg: string }[] => {
  const svg = rowsSvg(rows, width)
  if (svg.length <= SVG_MAX || rows.length < 2) return [{ rows, svg }]
  const half = Math.ceil(rows.length / 2)
  return [...fitted(rows.slice(0, half), width), ...fitted(rows.slice(half), width)]
}

/** The hidden Boxes in a tree (the hotkey Buttons live in them), kept so the keys still work. */
const hiddenBoxes = (n: Node): RenderElement[] => {
  if (typeof n === 'string') return []
  if (n.type === 'Box' && propsOf(n).display === 'none') return [n]
  return kids(n).flatMap(hiddenBoxes)
}

/** The `Svg` elements a block holds of its own (the agents' time axis), kept beside its picture. */
const ownSvgs = (n: Node): RenderElement[] => {
  if (typeof n === 'string') return []
  return n.type === 'Svg' ? [n] : kids(n).flatMap(ownSvgs)
}

/**
 * Each non-empty block as one `Svg` of its cells, `width` cells wide and sized in pixels, followed by
 * the Svgs the block holds itself. The hidden hotkey Boxes of every block come last, in one Box.
 */
export const pictures = (d: Draw, blocks: RenderElement[], width: number): RenderElement[] => {
  if (!('Svg' in d.els)) return []
  const { Box, Svg } = d.els
  // The constructors are called as JSX calls them, `key` among the props.
  const svg = (key: string, source: string, alt: string, rows: number) =>
    Svg({ key, source, alt, width: Math.ceil(width * CELL_PX), height: rows * ROW_PX, isInteractive: source.includes('<animate') } as Parameters<typeof Svg>[0])
  const out: RenderElement[] = []
  blocks.forEach((b, i) => {
    const rows = layoutCells(b, width, standIn)
    if (rows.length === 0) return
    fitted(rows, width).forEach((part, j) => out.push(svg(`pic-${i}-${j}`, part.svg, altOf(part.rows), part.rows.length)))
    out.push(...ownSvgs(b))
  })
  const hidden = blocks.flatMap(hiddenBoxes)
  if (hidden.length > 0) out.push(Box({ key: 'pic-keys', children: hidden } as Parameters<typeof Box>[0]))
  return out
}
