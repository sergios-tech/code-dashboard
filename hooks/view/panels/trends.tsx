// The TRENDS panel: the context fill and the cost over the session as two sparklines, each with its
// current figure at the right end and a `⟲` where a compaction happened. The surfaces that draw
// vectors add each line as an SVG.
import type { RenderElement } from 'claude-code'

import { compactionCells } from '../../domain/trends'
import { fmtUsd, plural, sparkline } from '../../format/text'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { TrendsView } from '../model'
import { svgSpark } from '../svg'

type Piece = { text: string; color: string; bold?: boolean }

/** Border and padding on each side of a row inside the frame. */
const CHROME = 4
/** `ctx  ` and `cost `, so both lines start their sparkline in the same cell. */
const LABEL_CELLS = 5
/** About one terminal cell, in CSS pixels, and the height of a desktop line. */
const CELL_PX = 8
const SPARK_PX = 36

const cells = (s: string): number => Array.from(s).length

const rowOf = (d: Draw, key: string, row: Piece[]): RenderElement => {
  const { Text } = d.els
  return (
    <Text key={key} wrap="truncate">
      {row.map((p, i) => (
        <Text key={`p${i}`} color={p.color} bold={p.bold}>
          {p.text}
        </Text>
      ))}
    </Text>
  )
}

/** The sparkline in runs: its cells in `color`, and a `⟲` in amber in place of each compaction's cell. */
const sparkPieces = (d: Draw, v: TrendsView, values: (number | null)[], width: number, color: string, range?: { min: number; max: number }): Piece[] => {
  const line = Array.from(sparkline(values, width, range))
  const marks = new Set(compactionCells(v.samples, width))
  const out: Piece[] = []
  line.forEach((ch, i) => {
    const isMark = marks.has(i)
    const text = isMark ? '⟲' : ch
    const tone = isMark ? d.C.gold : color
    const last = out[out.length - 1]
    if (last && last.color === tone && !isMark) last.text += text
    else out.push({ text, color: tone })
  })
  return out
}

/** The desktop's drawing of one line, below the frame. */
const sparkSvg = (d: Draw, key: string, alt: string, values: (number | null)[], width: number, color: string, range?: { min: number; max: number }): RenderElement | null => {
  const { els } = d
  if (d.surface === 'terminal' || !('Svg' in els)) return null
  return <els.Svg key={key} source={svgSpark(values, width * CELL_PX, SPARK_PX, color, range)} alt={alt} />
}

export const trendsPanel = (d: Draw, v: TrendsView, width: number): RenderElement => {
  const { Box } = d.els
  const { C } = d
  const room = Math.max(1, width - CHROME)
  const ctxValue = v.ctx === null ? '' : `  ${Math.round(v.ctx)}%`
  const total = v.cost ? `  ${fmtUsd(v.cost.usd)}` : ''
  const sparkWidth = Math.max(1, room - LABEL_CELLS - Math.max(cells(ctxValue), cells(total)))
  const ctxValues = v.samples.map(s => s.ctxPct)
  const costValues = v.samples.map(s => s.costUsd)
  const costRange = v.cost ? { min: v.cost.min, max: v.cost.max } : undefined
  const rows: RenderElement[] = []
  const svgs: (RenderElement | null)[] = []
  if (v.ctx !== null) {
    rows.push(
      rowOf(d, 'trend-ctx', [
        { text: 'ctx'.padEnd(LABEL_CELLS), color: C.dim },
        ...sparkPieces(d, v, ctxValues, sparkWidth, C.green, { min: 0, max: 100 }),
        { text: ctxValue, color: C.text, bold: true },
      ]),
    )
    svgs.push(sparkSvg(d, 'trend-ctx-svg', `context fill over ${plural(v.samples.length, 'reading')}`, ctxValues, width, C.green, { min: 0, max: 100 }))
  }
  if (v.cost) {
    rows.push(
      rowOf(d, 'trend-cost', [
        { text: 'cost'.padEnd(LABEL_CELLS), color: C.dim },
        ...sparkPieces(d, v, costValues, sparkWidth, C.green, costRange),
        { text: total, color: C.text, bold: true },
      ]),
    )
    svgs.push(sparkSvg(d, 'trend-cost-svg', `cost over ${plural(v.samples.length, 'reading')}`, costValues, width, C.green, costRange))
  }
  return (
    <Box key="trends" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'trends-frame', label: 'TRENDS', width, children: rows })}
      {svgs}
    </Box>
  )
}
