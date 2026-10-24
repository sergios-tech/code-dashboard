// The VITALS panel: the main model's effort, context, spend, rate limits and last request. Each row
// is drawn only when its data exists, and a row too long for the frame loses its least important
// parts rather than being cut mid-word.
import type { RenderElement } from 'claude-code'

import type { Limit } from '../../../types'
import { fmtResetIn, fmtSpeed, fmtUsd, gauge, kTokens, limitLabel, shorten } from '../../format/text'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { VitalsView } from '../model'

type Piece = { text: string; color: string; bold?: boolean }

const cells = (s: string): number => Array.from(s).length
const widthOf = (row: Piece[]): number => row.reduce((n, p) => n + cells(p.text), 0)

// Border and padding on each side of a row inside the frame.
const CHROME = 4
/** The countdown to a window's reset needs a frame at least this wide. */
const RESET_FROM = 56
const CTX_CELLS = 10
const LIMIT_CELLS = 5
const EFFORT_STEPS = 4
/** A gauge turns amber from here, paired with the percentage beside it. */
const HOT = 80

/** The first of the variants, richest first, that fits `room`; the last when none does. */
const firstFit = (variants: Piece[][], room: number): Piece[] => variants.find(v => widthOf(v) <= room) ?? variants[variants.length - 1] ?? []

/** The non-empty groups side by side, three spaces between. */
const spaced = (d: Draw, groups: Piece[][]): Piece[] =>
  groups
    .filter(g => g.length > 0)
    .flatMap((g, i): Piece[] => (i === 0 ? g : [{ text: '   ', color: d.C.dim }, ...g]))

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

/** `effort ▮▮▮▯ high   mode auto   42 req`: the gauge only for an effort on the scale. */
const paceRow = (d: Draw, v: VitalsView, room: number): Piece[] => {
  const { C } = d
  const level = Math.min(EFFORT_STEPS, v.effortLevel)
  const effort: Piece[] =
    v.effort === ''
      ? []
      : [
          { text: 'effort ', color: C.dim },
          ...(level > 0
            ? [
                { text: '▮'.repeat(level), color: C.green },
                { text: '▯'.repeat(EFFORT_STEPS - level), color: C.faint },
                { text: ' ', color: C.dim },
              ]
            : []),
          { text: shorten(v.effort, 12), color: C.green, bold: true },
        ]
  const mode: Piece[] = v.mode === '' ? [] : [{ text: `mode ${shorten(v.mode, 14)}`, color: C.dim }]
  const req: Piece[] = v.requests > 0 ? [{ text: `${v.requests} req`, color: C.dim }] : []
  return firstFit([spaced(d, [effort, mode, req]), spaced(d, [effort, req]), spaced(d, [effort, mode]), spaced(d, [effort])], room)
}

/** `ctx ▰▰▰▰▰▱▱▱▱▱ 51%  102k/200k  ⟲1`: the token counts go first when the row is tight. */
const ctxRow = (d: Draw, ctx: NonNullable<VitalsView['ctx']>, room: number): Piece[] => {
  const { C } = d
  const g = gauge(ctx.pct, CTX_CELLS)
  const head: Piece[] = [
    { text: 'ctx ', color: C.dim },
    { text: g.on, color: ctx.pct >= HOT ? C.gold : C.green },
    { text: g.off, color: C.faint },
    { text: ` ${Math.round(ctx.pct)}%`, color: C.text, bold: true },
  ]
  const tokens: Piece[] = ctx.tokens !== null && ctx.window > 0 ? [{ text: `  ${kTokens(ctx.tokens)}/${kTokens(ctx.window)}`, color: C.dim }] : []
  const compacted: Piece[] = ctx.compactions > 0 ? [{ text: `  ⟲${ctx.compactions}`, color: C.gold }] : []
  return firstFit([[...head, ...tokens, ...compacted], [...head, ...compacted]], room)
}

/** One rate-limit window: `5h ▰▰▱▱▱ 38% ↻2h10m`. */
const limitPieces = (d: Draw, l: Limit, now: number, withReset: boolean): Piece[] => {
  const { C } = d
  const g = gauge(l.pct, LIMIT_CELLS)
  const label = limitLabel(l.kind)
  const reset = withReset ? fmtResetIn(l.resetsAt, now) : ''
  return [
    ...(label ? [{ text: `${label} `, color: C.dim }] : []),
    { text: g.on, color: l.pct >= HOT ? C.gold : C.green },
    { text: g.off, color: C.faint },
    { text: ` ${Math.round(l.pct)}%`, color: C.text },
    ...(reset ? [{ text: ` ↻${reset}`, color: C.dim }] : []),
  ]
}

/** `$3.12   5h ▰▰▱▱▱ 38% ↻2h10m   7d …`: both windows before the countdowns, countdowns only in a wide enough frame. */
const spendRow = (d: Draw, v: VitalsView, width: number, room: number): Piece[] => {
  const cost: Piece[] = v.costUsd !== null ? [{ text: fmtUsd(v.costUsd), color: d.C.text }] : []
  const variants: Piece[][] = []
  for (let n = v.limits.length; n >= 0; n--) {
    for (const withReset of width >= RESET_FROM ? [true, false] : [false]) {
      variants.push(spaced(d, [cost, ...v.limits.slice(0, n).map(l => limitPieces(d, l, v.now, withReset))]))
    }
  }
  return firstFit(variants, room)
}

export const vitalsPanel = (d: Draw, v: VitalsView, width: number): RenderElement => {
  const { Box } = d.els
  const { C } = d
  const room = Math.max(1, width - CHROME)
  const rows: RenderElement[] = []
  if (v.has.pace) rows.push(rowOf(d, 'pace', paceRow(d, v, room)))
  if (v.ctx) rows.push(rowOf(d, 'ctx', ctxRow(d, v.ctx, room)))
  if (v.has.spend) rows.push(rowOf(d, 'spend', spendRow(d, v, width, room)))
  if (v.speed) rows.push(rowOf(d, 'speed', [{ text: `last req  ${fmtSpeed(v.speed)}`, color: C.dim }]))
  if (rows.length === 0) rows.push(rowOf(d, 'waiting', [{ text: 'waiting for the first request', color: C.dim }]))
  return (
    <Box key="vitals" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'vitals-frame', label: 'VITALS', meta: v.isRunning ? '● working' : '○ idle', width, children: rows })}
    </Box>
  )
}
