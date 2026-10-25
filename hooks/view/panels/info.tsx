// The INFO panel: a labelled table in three groups split by dividers. The model group holds the
// effort, permission mode and request count; the usage group the context gauge and each rate-limit
// window on its own row; the spend group the cost and the last request's speed. A group with nothing
// to show is left out with its divider, and a row too long for the frame loses its least telling
// parts rather than being cut mid-word.
import type { RenderElement } from 'claude-code'

import type { Limit } from '../../../types'
import { fmtResetIn, fmtUsd, gauge, kTokens, limitLabel, shorten } from '../../format/text'
import type { Draw } from '../draw'
import { dividerRow, frame } from '../frame'
import type { InfoView } from '../model'
import { levelColor } from '../palette'

type Piece = { text: string; color: string; bold?: boolean }

const cells = (s: string): number => Array.from(s).length
const widthOf = (row: Piece[]): number => row.reduce((n, p) => n + cells(p.text), 0)
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - cells(s)))
const lpad = (s: string, n: number): string => ' '.repeat(Math.max(0, n - cells(s))) + s

/** Border and padding on each side of a row inside the frame. */
const CHROME = 4
/** The label column, after the 2-cell icon column. */
const LABEL = 7
const ICON = 2
/** The gauge column: wide from this many cells inside the frame, narrow below. */
const WIDE_FROM = 56
const GAUGE_WIDE = 16
const GAUGE_NARROW = 10
/** The percentage column. */
const FIGURE = 5
const EFFORT_STEPS = 4
const MODE_MAX = 14
const EFFORT_MAX = 12

/** The pieces of `groups` side by side with `gap` between, the empty groups left out. */
const spaced = (d: Draw, groups: Piece[][], gap: string): Piece[] =>
  groups.filter(g => g.length > 0).flatMap((g, i): Piece[] => (i === 0 ? g : [{ text: gap, color: d.C.dim }, ...g]))

/** `head` with the first of `variants`, richest first, that fits `room`; the last one when none does. */
const fit = (head: Piece[], variants: Piece[][], room: number): Piece[] => [...head, ...(variants.find(v => widthOf(head) + widthOf(v) <= room) ?? variants[variants.length - 1] ?? [])]

/** The non-empty groups after a row's gauge, two spaces before each; nothing when all are empty. */
const after = (d: Draw, groups: Piece[][]): Piece[] => groups.filter(g => g.length > 0).flatMap(g => [{ text: '  ', color: d.C.dim }, ...g])

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

/** The icon and label columns: an orange icon on a group's head, two spaces inside the group. */
const head = (d: Draw, label: string, icon?: string): Piece[] => [icon ? { text: `${icon} `, color: d.C.orange } : { text: ' '.repeat(ICON), color: d.C.dim }, { text: pad(label, LABEL), color: d.C.dim }]

/** The percentage as printed: rounded, and 0 when the reading is not a number. */
const figureOf = (pct: number): number => (Number.isFinite(pct) ? Math.round(pct) : 0)

/** `▰▰▱▱▱▱▱▱▱▱  11%`: the gauge clamped to its track in the level's colour, then the right-aligned figure. */
const meter = (d: Draw, pct: number, cellsWide: number): Piece[] => {
  const g = gauge(pct, cellsWide)
  return [
    { text: g.on, color: levelColor(pct) },
    { text: g.off, color: d.C.faint },
    { text: lpad(`${figureOf(pct)}%`, FIGURE), color: d.C.text, bold: true },
  ]
}

const effortPieces = (d: Draw, v: InfoView): Piece[] => {
  if (v.effort === '') return []
  const level = Math.min(EFFORT_STEPS, v.effortLevel)
  return [
    ...(level > 0
      ? [
          { text: '▮'.repeat(level), color: d.C.green },
          { text: '▯'.repeat(EFFORT_STEPS - level), color: d.C.faint },
          { text: ' ', color: d.C.dim },
        ]
      : []),
    { text: shorten(v.effort, EFFORT_MAX), color: d.C.green, bold: true },
  ]
}

const modePieces = (d: Draw, mode: string): Piece[] =>
  mode === ''
    ? []
    : [{ text: 'mode ', color: d.C.dim }, mode === 'bypassPermissions' ? { text: 'bypass', color: d.C.error, bold: true } : { text: shorten(mode, MODE_MAX), color: d.C.text }]

const requestPieces = (d: Draw, n: number): Piece[] => (n > 0 ? [{ text: 'req ', color: d.C.dim }, { text: String(n), color: d.C.text }] : [])

const speedPieces = (d: Draw, v: InfoView, withLabel: boolean): Piece[] =>
  v.speed
    ? [
        ...(withLabel ? [{ text: 'ttft ', color: d.C.dim }] : []),
        { text: `${(v.speed.ttftMs / 1000).toFixed(1)}s`, color: d.C.text },
        { text: ' · ', color: d.C.dim },
        { text: v.speed.tokPerS !== null ? String(Math.round(v.speed.tokPerS)) : '—', color: d.C.text },
        { text: ' tok/s', color: d.C.dim },
      ]
    : []

const resetPieces = (d: Draw, l: Limit, now: number): Piece[] => {
  const reset = fmtResetIn(l.resetsAt, now)
  return reset ? [{ text: `↻ ${reset}`, color: d.C.dim }] : []
}

const hasModel = (v: InfoView): boolean => v.effort !== '' || v.mode !== '' || v.requests > 0
const hasUsage = (v: InfoView): boolean => v.ctx !== null || v.limits.length > 0
const hasSpend = (v: InfoView): boolean => v.costUsd !== null || v.speed !== null

export const infoPanel = (d: Draw, v: InfoView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const room = Math.max(1, width - CHROME)
  const gaugeCells = room >= WIDE_FROM ? GAUGE_WIDE : GAUGE_NARROW
  const rows: RenderElement[] = []
  const dividers: number[] = []
  const divide = () => {
    if (rows.length === 0) return
    dividers.push(rows.length)
    rows.push(dividerRow(d, `divider-${rows.length}`))
  }

  if (hasModel(v)) {
    const [effort, mode, req] = [effortPieces(d, v), modePieces(d, v.mode), requestPieces(d, v.requests)]
    rows.push(rowOf(d, 'model', fit(head(d, 'effort', '◆'), [spaced(d, [effort, mode, req], '   '), spaced(d, [effort, mode], '   '), spaced(d, [effort], '   ')], room)))
  }
  if (hasUsage(v)) {
    divide()
    if (v.ctx) {
      const { ctx } = v
      const tokens: Piece[] = ctx.tokens !== null && ctx.window > 0 ? [{ text: `${kTokens(ctx.tokens)}/${kTokens(ctx.window)}`, color: d.C.dim }] : []
      const compacted: Piece[] = ctx.compactions > 0 ? [{ text: `↺${ctx.compactions}`, color: d.C.gold }] : []
      const top = [...head(d, 'ctx', '◐'), ...meter(d, ctx.pct, gaugeCells)]
      rows.push(rowOf(d, 'ctx', fit(top, [after(d, [tokens, compacted]), after(d, [compacted]), []], room)))
    }
    v.limits.forEach((l, i) => {
      const top = [...head(d, shorten(limitLabel(l.kind), LABEL), v.ctx || i > 0 ? undefined : '◐'), ...meter(d, l.pct, gaugeCells)]
      rows.push(rowOf(d, `limit-${i}`, fit(top, [after(d, [resetPieces(d, l, v.now)]), []], room)))
    })
  }
  if (hasSpend(v)) {
    divide()
    const cost: Piece[] = v.costUsd !== null ? [{ text: fmtUsd(v.costUsd), color: d.C.text, bold: true }] : []
    rows.push(rowOf(d, 'spend', fit(head(d, 'spend', '$'), [spaced(d, [cost, speedPieces(d, v, true)], '   '), spaced(d, [cost, speedPieces(d, v, false)], '   '), cost], room)))
  }
  if (rows.length === 0) rows.push(<Text key="waiting" color={d.C.dim} wrap="truncate">waiting for the first request</Text>)
  return (
    <Box key="info" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'info-frame', label: 'INFO', meta: v.isRunning ? '● working' : '○ idle', metaColor: v.isRunning ? d.C.orange : d.C.dim, width, isActive: v.isRunning, dividers, children: rows })}
    </Box>
  )
}
