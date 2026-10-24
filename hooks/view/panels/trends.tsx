// The TRENDS panel: a table of two rows, the context fill and the cost over the session. Each row
// holds an orange head icon, the dim label, the sparkline, the latest figure and its change. The
// context cells take the level colour of their own reading, the cost cells are muted, and a
// compaction is a gold `↺` in the cell of the reading that showed it.
import type { RenderElement } from 'claude-code'

import type { Sample } from '../../../types'
import { compactionCells } from '../../domain/trends'
import { fmtUsd, placeCells, sparkline } from '../../format/text'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { TrendsView } from '../model'
import { levelColor } from '../palette'

type Piece = { text: string; color: string; bold?: boolean }

/** Border and padding on each side of a row inside the frame. */
const CHROME = 4
/** The head icon column, the label column, and the figure and change columns. */
const ICON = 2
const LABEL = 7
const FIGURE = 7
const CHANGE = 7
/** The change column is drawn from this many cells inside the frame. */
const CHANGE_FROM = 50

const cells = (s: string): number => Array.from(s).length
const lpad = (s: string, n: number): string => ' '.repeat(Math.max(0, n - cells(s))) + s

const rowOf = (d: Draw, key: string, row: Piece[]): RenderElement => {
  const { Text } = d.els
  return (
    <Text key={key} wrap="truncate">
      {row
        .filter(p => p.text !== '')
        .map((p, i) => (
          <Text key={`p${i}`} color={p.color} bold={p.bold}>
            {p.text}
          </Text>
        ))}
    </Text>
  )
}

/**
 * The sparkline in runs: neighbouring cells of one colour join, an empty cell is a space and a
 * compaction's cell is a gold `↺` of its own. `color` gives the colour of a reading's cell.
 */
export const sparkPieces = (d: Draw, samples: Sample[], values: (number | null)[], width: number, range: { min: number; max: number }, color: (reading: number) => string): Piece[] => {
  const placed = placeCells(values, width)
  const glyphs = Array.from(sparkline(values, width, range))
  const marks = new Set(compactionCells(samples, width))
  const out: Piece[] = []
  glyphs.forEach((glyph, i) => {
    const reading = placed[i] ?? null
    const isMark = marks.has(i)
    const isEmpty = reading === null && !isMark
    const text = isMark ? '↺' : isEmpty ? ' ' : glyph
    const tone = isMark ? d.C.gold : isEmpty ? d.C.dim : color(reading ?? 0)
    const last = out[out.length - 1]
    if (last && last.color === tone && !isMark && last.text !== '↺' && (last.text.trim() === '') === isEmpty) last.text += text
    else out.push({ text, color: tone })
  })
  return out
}

/** `+2`, `−3`: the signed change in whole percent points. */
const fmtPoints = (n: number): string => `${n > 0 ? '+' : '−'}${Math.abs(n)}`

export const trendsPanel = (d: Draw, v: TrendsView, width: number): RenderElement => {
  const { Box } = d.els
  const { C } = d
  const inside = Math.max(1, width - CHROME)
  const hasChange = inside >= CHANGE_FROM
  const sparkWidth = Math.max(1, inside - (ICON + LABEL) - FIGURE - (hasChange ? CHANGE : 0))
  const ctxValues = v.samples.map(s => s.ctxPct)
  const costValues = v.samples.map(s => s.costUsd)
  const ctxRange = { min: 0, max: 100 }
  const row = (key: string, icon: string, label: string, spark: Piece[], figure: string, change: string): RenderElement =>
    rowOf(d, key, [
      { text: icon, color: C.orange },
      { text: label.padEnd(LABEL), color: C.dim },
      ...spark,
      { text: lpad(figure, FIGURE), color: C.text, bold: true },
      { text: hasChange ? lpad(change, CHANGE) : '', color: C.dim },
    ])
  const rows: RenderElement[] = []
  if (v.ctx) {
    const change = v.ctx.change === null ? '' : fmtPoints(v.ctx.change)
    rows.push(row('trend-ctx', '◐ ', 'ctx', sparkPieces(d, v.samples, ctxValues, sparkWidth, ctxRange, levelColor), `${Math.round(v.ctx.pct)}%`, change))
  }
  if (v.cost) {
    const change = v.cost.change === null ? '' : `+${fmtUsd(v.cost.change)}`
    const range = { min: v.cost.min, max: v.cost.max }
    rows.push(row('trend-cost', '$ ', 'cost', sparkPieces(d, v.samples, costValues, sparkWidth, range, () => C.muted), fmtUsd(v.cost.usd), change))
  }
  return (
    <Box key="trends" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'trends-frame', label: 'TRENDS', width, children: rows })}
    </Box>
  )
}
