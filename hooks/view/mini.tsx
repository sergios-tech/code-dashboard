// The inline summary above the prompt: at most eight frameless rows on the black fill. The main
// model's state and a digest of INFO's figures first, then up to six agents with their bars and
// clocks, and a last row for the agents left out and the other loops.
import type { RenderElement } from 'claude-code'

import type { AgentCard, Limit } from '../../types'
import { agentGlyph, cardTitle, cellCount, fitCells, modelTag } from '../domain/agents'
import { fmtUsd, gauge, limitLabel, shorten } from '../format/text'
import { clock } from './draw'
import type { Draw } from './draw'
import { stateDot } from './header'
import type { MiniView } from './model'
import { ctxColor, familyColor, limitColor } from './palette'
import { LOOP_GLYPH, bar, loopTone } from './panels/agents'
import { agentTone } from './svg'

type Piece = { text: string; color: string; bold?: boolean }

/** The most rows the summary draws. */
const MAX_ROWS = 8
/** An agent's glyph and the space after it. */
const GLYPH_CELLS = 2
/** The model tag's column, its name taking at most the cells before the space. */
const TAG_CELLS = 8
/** The tag is dropped, and the bar is 10 cells, from this width. */
const TAG_FROM = 50
/** The bar is 14 cells from this width, 10 from TAG_FROM, else 6. */
const BAR_WIDE_FROM = 70
/** An agent's clock, right-aligned: `m:ss` to `XhYY`. */
const CLOCK_CELLS = 6
const CTX_GAUGE = 8
const LIMIT_GAUGE = 6
const LIMIT_LABEL = 7
const EFFORT_MAX = 12

const widthOf = (row: Piece[]): number => row.reduce((n, p) => n + cellCount(p.text), 0)
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - cellCount(s)))

/** The figure as printed: rounded, and 0 when the reading is not a number. */
const figureOf = (pct: number): number => (Number.isFinite(pct) ? Math.round(pct) : 0)

/** `pieces` as one truncating Text of coloured runs. */
const textOf = (d: Draw, key: string, pieces: Piece[]): RenderElement => {
  const { Text } = d.els
  return (
    <Text key={key} wrap="truncate">
      {pieces
        .filter(p => p.text !== '')
        .map((p, i) => (
          <Text key={`p${i}`} color={p.color} bold={p.bold}>
            {p.text}
          </Text>
        ))}
    </Text>
  )
}

/** The groups that are not empty side by side, `gap` between. */
const joined = (d: Draw, groups: Piece[][], gap: string): Piece[] => groups.filter(g => g.length > 0).flatMap((g, i): Piece[] => (i === 0 ? g : [{ text: gap, color: d.C.dim }, ...g]))

/** The model's name in its family colour and the loop's state, `idle` with nothing running: the header's right side without its dot. */
const stateWords = (d: Draw, h: MiniView['header']): Piece[] => {
  const name = h.model.trim().toUpperCase()
  return [...(name ? [{ text: ` ${name}`, color: familyColor(name), bold: true }] : []), { text: h.isRunning ? ' WORKING' : ' IDLE', color: h.isActive ? d.C.dim : d.C.idle }]
}

/**
 * Row one: the state, then INFO's figures. The first of eight forms that fits the width, richest
 * first: the cooler limit goes first, then the architect words, then the gauges shrink to figures,
 * then effort, the hotter limit and spend. Ctx stays longest and the state never drops.
 */
const headRow = (d: Draw, m: MiniView, width: number): RenderElement => {
  const { Box } = d.els
  const { C } = d
  const state = stateWords(d, m.header)
  const arch: Piece[] = m.header.arch ? [{ text: ` · ${m.header.arch}`, color: m.header.isAdvising ? C.architect : C.dim }] : []
  const effort: Piece[] = m.effort ? [{ text: '◆ ', color: C.orange }, { text: shorten(m.effort, EFFORT_MAX), color: C.green, bold: true }] : []
  const compacted: Piece[] = m.ctx && m.ctx.compactions > 0 ? [{ text: ` ↺${m.ctx.compactions}`, color: C.gold }] : []
  const meter = (pct: number, cells: number, level: (pct: number) => string): Piece[] => {
    const g = gauge(pct, cells)
    return [
      { text: g.on, color: level(pct) },
      { text: g.off, color: C.faint },
      { text: ` ${figureOf(pct)}%`, color: C.text, bold: true },
    ]
  }
  const ctxGauge: Piece[] = m.ctx ? [{ text: '◐ ', color: C.orange }, ...meter(m.ctx.pct, CTX_GAUGE, ctxColor), ...compacted] : []
  const ctxFigure: Piece[] = m.ctx ? [{ text: '◐ ', color: C.orange }, { text: `${figureOf(m.ctx.pct)}%`, color: ctxColor(m.ctx.pct), bold: true }, ...compacted] : []
  const label = (l: Limit): Piece => ({ text: `${shorten(limitLabel(l.kind), LIMIT_LABEL)} `, color: C.dim })
  const limitGauge = (l: Limit): Piece[] => [label(l), ...meter(l.pct, LIMIT_GAUGE, limitColor)]
  const limitFigure = (l: Limit): Piece[] => [label(l), { text: `${figureOf(l.pct)}%`, color: limitColor(l.pct), bold: true }]
  const [hot] = m.limits
  const spend: Piece[] = m.costUsd === null ? [] : [{ text: '$ ', color: C.orange }, { text: fmtUsd(m.costUsd).replace(/^\$/, ''), color: C.text, bold: true }]
  const roomy = (groups: Piece[][]) => joined(d, groups, '   ')
  const tight = (groups: Piece[][]) => joined(d, groups, '  ')
  const forms: [Piece[], Piece[]][] = [
    [[...state, ...arch], roomy([effort, ctxGauge, ...m.limits.map(limitGauge), spend])],
    [[...state, ...arch], roomy([effort, ctxGauge, hot ? limitGauge(hot) : [], spend])],
    [state, roomy([effort, ctxGauge, hot ? limitGauge(hot) : [], spend])],
    [state, tight([effort, ctxFigure, hot ? limitFigure(hot) : [], spend])],
    [state, tight([ctxFigure, hot ? limitFigure(hot) : [], spend])],
    [state, tight([ctxFigure, spend])],
    [state, ctxFigure],
    [state, []],
  ]
  const rows = forms.map(([head, digest]): Piece[] => (digest.length > 0 ? [...head, { text: '   ', color: C.dim }, ...digest] : head))
  // The dot takes the first cell.
  const row = rows.find(r => 1 + widthOf(r) <= width) ?? state
  return (
    <Box key="mini-head" width={width}>
      {stateDot(d, m.header.isActive)}
      {textOf(d, 'mini-state', row)}
    </Box>
  )
}

/** `● Count tests by file    Haiku    ▰▰▰▱▱▱▱▱▱▱▱▱▱▱  0:37`: the AGENTS row without its hotkey digit, the mini taking no keys. */
const agentRow = (d: Draw, c: AgentCard, m: MiniView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  const hasTag = width >= TAG_FROM
  const barCells = width >= BAR_WIDE_FROM ? 14 : hasTag ? 10 : 6
  const titleCells = Math.max(1, width - GLYPH_CELLS - (hasTag ? TAG_CELLS : 0) - 1 - barCells - CLOCK_CELLS)
  const tag = hasTag ? modelTag(c, m.mainModel) : ''
  return (
    <Box key={`mini-agent-${c.id}`} width={width}>
      <Box width={GLYPH_CELLS} flexShrink={0}>
        <Text color={agentTone(c)}>{agentGlyph(c)}</Text>
      </Box>
      <Text color={C.text} wrap="truncate">
        {pad(fitCells(cardTitle(c), titleCells), titleCells)}
      </Text>
      {hasTag ? <Text color={tag ? familyColor(tag) : C.dim}>{pad(fitCells(tag, TAG_CELLS - 1), TAG_CELLS)}</Text> : null}
      <Text>{' '}</Text>
      {bar(d, c, barCells)}
      <Box width={CLOCK_CELLS} flexShrink={0} justifyContent="flex-end">
        {clock(d, `mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
      </Box>
    </Box>
  )
}

/** `+2 earlier · loops 2 seen · 1 active  ✓●`, or null when there is nothing to count. */
const tailRow = (d: Draw, m: MiniView, width: number): RenderElement | null => {
  const { C } = d
  const words: Piece[] = []
  if (m.earlier > 0) words.push({ text: `+${m.earlier} earlier`, color: C.dim })
  if (m.loops) words.push({ text: `${m.earlier > 0 ? ' · ' : ''}loops ${m.loops.seen} seen · ${m.loops.active} active  `, color: C.dim })
  if (words.length === 0) return null
  // The dots are the newest that fit beside the words.
  const room = Math.max(0, width - widthOf(words))
  const dots = m.loops && room > 0 ? m.loops.dots.slice(-room) : []
  return textOf(d, 'mini-tail', [...words, ...dots.map((s): Piece => ({ text: LOOP_GLYPH[s], color: loopTone(d, s) }))])
}

/** The summary rows on black; `fillRows`, given when docked, carries the black down to that many rows. */
export const miniPane = (d: Draw, m: MiniView, width: number, fillRows?: number): RenderElement => {
  const { Box } = d.els
  const rows: (RenderElement | null)[] = [headRow(d, m, width)]
  rows.push(...m.agents.map(c => agentRow(d, c, m, width)))
  rows.push(tailRow(d, m, width))
  return (
    <Box flexDirection="column" width={width} minHeight={fillRows} backgroundColor={d.C.fill}>
      {rows.filter((r): r is RenderElement => r !== null).slice(0, MAX_ROWS)}
    </Box>
  )
}
