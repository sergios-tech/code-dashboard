// The ARCHITECT panel: whether the architect is advising, its consults on one timeline, when the
// last one ran and how long it took, the moment each is inferred at, and the advice it left.
import type { RenderElement } from 'claude-code'

import type { Moment } from '../../../types'
import { fitCells } from '../../domain/agents'
import { MOMENTS } from '../../domain/architect'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { ArchitectView } from '../model'

type Piece = { text: string; color: string; bold?: boolean }

const cells = (s: string): number => Array.from(s).length
const widthOf = (row: Piece[]): number => row.reduce((n, p) => n + cells(p.text), 0)

/** Border and padding on each side of a row inside the frame. */
const CHROME = 4

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

/** The timeline in runs: consults in the architect's colour, the rule between them faint. */
const timelineRow = (d: Draw, timeline: string): Piece[] =>
  (timeline.match(/─+|[^─]+/g) ?? []).map(run => ({ text: run, color: run.startsWith('─') ? d.C.faint : d.C.architect }))

/**
 * `◆ before a plan  ◇ error repeats  ◇ before done  (inferred)`, the last consult's moment lit; a
 * frame too narrow for all three keeps the lit one alone.
 */
const momentsRow = (d: Draw, lit: Moment | null, room: number): Piece[] => {
  const { C } = d
  const piece = (m: Moment): Piece => (m === lit ? { text: `◆ ${m}`, color: C.architect, bold: true } : { text: `◇ ${m}`, color: C.dim })
  const spaced = (ps: Piece[], gap: string): Piece[] => ps.flatMap((p, i) => (i === 0 ? [p] : [{ text: gap, color: C.dim }, p]))
  const tag: Piece = { text: '(inferred)', color: C.dim }
  const all = [...MOMENTS.map(piece), tag]
  const variants = [spaced(all, '  '), spaced(all, ' '), ...(lit ? [spaced([piece(lit), tag], '  ')] : [])]
  return variants.find(v => widthOf(v) <= room) ?? variants[variants.length - 1] ?? []
}

export const architectPanel = (d: Draw, v: ArchitectView, width: number): RenderElement => {
  const { Box } = d.els
  const { C } = d
  const room = Math.max(1, width - CHROME)
  const rows: RenderElement[] = [
    rowOf(d, 'arch-status', [v.isAdvising ? { text: '● advising', color: C.architect, bold: true } : { text: '○ on call', color: C.dim }]),
    rowOf(d, 'arch-timeline', timelineRow(d, v.timeline)),
    rowOf(d, 'arch-since', [{ text: v.since, color: C.dim }]),
  ]
  if (v.moments) rows.push(rowOf(d, 'arch-moments', momentsRow(d, v.moments.lit, room)))
  if (v.advice) rows.push(rowOf(d, 'arch-advice', [{ text: `» ${fitCells(v.advice, room - 2)}`, color: C.architect }]))
  return (
    <Box key="architect" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'architect-frame', label: v.label, meta: v.meta, width, isActive: v.isAdvising, children: rows })}
    </Box>
  )
}
