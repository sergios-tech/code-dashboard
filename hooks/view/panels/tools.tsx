// The TOOLS & FILES panel: a table of the busiest tools (a family glyph, calls, errors, the average
// time), then under a divider the files touched most (reads and edits). A file only subagents
// touched is drawn in the dim token throughout. A name or path too long for its column is cut with
// `…`, so the number columns keep their place at every width.
import type { RenderElement } from 'claude-code'

import { FAMILY_GLYPH, avgMs, avgShort, toolFamily, toolName } from '../../domain/activity'
import { cellCount, fitCells } from '../../domain/agents'
import type { Draw } from '../draw'
import { dividerRow, frame } from '../frame'
import type { ToolsView } from '../model'

type Piece = { text: string; color: string; bold?: boolean }

/** Border and padding on each side of a row inside the frame. */
const CHROME = 4
/** The family glyph and its space. */
const GLYPH = 2
/** The number columns, right-aligned: calls and reads, errors, the average, and edits. */
const CALLS = 6
const ERRORS = 6
const AVERAGE = 7
const EDITS = 6

/** `s` filled with spaces to `n` terminal cells. */
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - cellCount(s)))
const lpad = (s: string, n: number): string => ' '.repeat(Math.max(0, n - cellCount(s))) + s

/** A name or path on exactly `n` cells, cut with `…` and always leaving one cell before the next column. */
const column = (s: string, n: number): string => pad(fitCells(s, n - 1), n)

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

export const toolsPanel = (d: Draw, v: ToolsView, width: number): RenderElement => {
  const { Box } = d.els
  const { C } = d
  const room = Math.max(1, width - CHROME)
  const nameCells = Math.max(1, room - GLYPH - CALLS - ERRORS - AVERAGE)
  const pathCells = Math.max(1, room - CALLS - ERRORS - AVERAGE)
  const rows: RenderElement[] = []
  const dividers: number[] = []

  rows.push(
    rowOf(d, 'tool-head', [
      { text: `${pad('  tool', GLYPH + nameCells)}${lpad('calls', CALLS)}${lpad('err', ERRORS)}${lpad('avg*', AVERAGE)}`, color: C.dim },
    ]),
  )
  for (const r of v.tools)
    rows.push(
      rowOf(d, `tool-${r.tool}`, [
        { text: `${FAMILY_GLYPH[toolFamily(r.tool)]} `, color: C.orange },
        { text: column(toolName(r.tool), nameCells), color: C.text },
        { text: lpad(String(r.calls), CALLS), color: C.text, bold: true },
        { text: lpad(r.errors > 0 ? `✗ ${r.errors}` : '·', ERRORS), color: r.errors > 0 ? C.error : C.faint },
        { text: lpad(avgShort(avgMs(r)), AVERAGE), color: C.text },
      ]),
    )
  if (v.files.length > 0) {
    dividers.push(rows.length)
    rows.push(dividerRow(d, 'tools-divider'))
    rows.push(rowOf(d, 'file-head', [{ text: `${pad('file', pathCells)}${lpad('reads', CALLS)}${lpad('edits', EDITS)}`, color: C.dim }]))
    for (const f of v.files) {
      const tone = f.byMain ? C.text : C.dim
      rows.push(
        rowOf(d, `file-${f.path}`, [
          { text: column(f.path, pathCells), color: tone },
          { text: lpad(String(f.reads), CALLS), color: tone, bold: f.byMain },
          { text: lpad(f.edits > 0 ? `✎ ${f.edits}` : '·', EDITS), color: f.edits > 0 ? (f.byMain ? C.gold : C.dim) : C.faint },
        ]),
      )
    }
  }
  return (
    <Box key="tools" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'tools-frame', label: 'TOOLS & FILES', meta: v.meta, width, dividers, children: rows })}
    </Box>
  )
}
