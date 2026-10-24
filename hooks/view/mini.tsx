// The inline summary above the prompt: at most eight frameless rows. The main model's line first,
// then the context sparkline, up to three agents with their clocks, the agents left out, the other
// loops.
import type { RenderElement } from 'claude-code'

import type { AgentCard } from '../../types'
import { AGENT_GLYPH, cardTitle, cellCount, fitCells } from '../domain/agents'
import { fmtUsd, gauge, kTokens, plural, sparkline } from '../format/text'
import { clock } from './draw'
import type { Draw } from './draw'
import type { MiniView } from './model'
import { agentTone } from './svg'

type Piece = { text: string; color: string; bold?: boolean }

const CTX_CELLS = 6
/** A gauge turns amber from here, as the vitals panel's does. */
const HOT = 80
/** `ctx ` before the sparkline and ` 100%` after it. */
const SPARK_CHROME = 9
/** An agent's glyph and the space after it. */
const GLYPH_CELLS = 2
/** `  ctx 41k`, padded so every row's clock starts in the same cell. */
const COUNT_CELLS = 11
/** An agent's clock, right-aligned: `m:ss` to `XhYY`. */
const CLOCK_CELLS = 5
/** A title stops growing here, so a wide terminal keeps the figures beside it. */
const TITLE_MAX = 48

/** `s` filled with spaces to `n` terminal cells. */
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - cellCount(s)))

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

/** `▌Opus 5.5 ● working · ctx ▰▰▰▱▱▱ 51% ⟲1 · $3.12 · architect 2`: each figure only once the host has reported it. */
const headRow = (d: Draw, m: MiniView): Piece[] => {
  const { C } = d
  const row: Piece[] = [{ text: '▌', color: C.brand }]
  if (m.model) row.push({ text: `${m.model} `, color: C.green, bold: true })
  row.push(m.isRunning ? { text: '● working', color: C.green } : { text: '○ idle', color: C.dim })
  if (m.ctx) {
    const g = gauge(m.ctx.pct, CTX_CELLS)
    row.push(
      { text: ' · ctx ', color: C.dim },
      { text: g.on, color: m.ctx.pct >= HOT ? C.gold : C.green },
      { text: g.off, color: C.faint },
      { text: ` ${Math.round(m.ctx.pct)}%`, color: C.text },
    )
    if (m.ctx.compactions > 0) row.push({ text: ` ⟲${m.ctx.compactions}`, color: C.gold })
  }
  if (m.costUsd !== null) row.push({ text: ` · ${fmtUsd(m.costUsd)}`, color: C.text })
  if (m.arch) row.push({ text: ` · ${m.arch}`, color: C.architect })
  return row
}

/** `ctx ▁▂▃▅▇ 51%`: one cell per sample while they fit, so a short session draws a short line. */
const sparkRow = (d: Draw, spark: NonNullable<MiniView['spark']>, width: number): Piece[] => {
  const { C } = d
  const cells = Math.max(1, Math.min(spark.values.length, width - SPARK_CHROME))
  return [
    { text: 'ctx ', color: C.dim },
    { text: sparkline(spark.values, cells, { min: 0, max: 100 }), color: C.green },
    { text: ` ${Math.round(spark.pct)}%`, color: C.text, bold: true },
  ]
}

/** `● Map the call sites  ctx 41k  0:42`. */
const agentRow = (d: Draw, c: AgentCard, titleCells: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  return (
    <Box key={`mini-agent-${c.id}`}>
      <Box width={GLYPH_CELLS} flexShrink={0}>
        <Text color={agentTone(c)}>{AGENT_GLYPH[c.status]}</Text>
      </Box>
      <Text color={C.text} wrap="truncate">
        {pad(fitCells(cardTitle(c), titleCells), titleCells)}
      </Text>
      <Text color={C.dim}>{pad(c.steps > 0 ? `  ctx ${kTokens(c.ctx)}` : '', COUNT_CELLS)}</Text>
      <Box width={CLOCK_CELLS} flexShrink={0} justifyContent="flex-end">
        {clock(d, `mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
      </Box>
    </Box>
  )
}

export const miniPane = (d: Draw, m: MiniView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  const titleCells = Math.max(1, Math.min(TITLE_MAX, width - GLYPH_CELLS - COUNT_CELLS - CLOCK_CELLS))
  const rows: RenderElement[] = [rowOf(d, 'mini-head', headRow(d, m))]
  if (m.spark) rows.push(rowOf(d, 'mini-ctx', sparkRow(d, m.spark, width)))
  rows.push(...m.agents.map(c => agentRow(d, c, titleCells)))
  if (m.more > 0) {
    rows.push(
      <Text key="mini-more" color={C.dim} wrap="truncate">
        {`+${plural(m.more, 'more agent')} · /st-code layout compact for all`}
      </Text>,
    )
  }
  if (m.loops) {
    rows.push(
      rowOf(d, 'mini-loops', [
        { text: 'LOOPS', color: C.text, bold: true },
        { text: ` ${m.loops.seen} · ${m.loops.active} active`, color: C.dim },
      ]),
    )
  }
  return (
    <Box flexDirection="column" width={width} backgroundColor={C.fill}>
      {rows}
    </Box>
  )
}
