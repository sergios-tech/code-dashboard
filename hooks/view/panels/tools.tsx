// The TOOLS & FILES panel: the busiest tools with their errors and average time, then the files
// touched most, each with its reads and edits; a file only subagents touched is drawn dim.
import type { RenderElement } from 'claude-code'

import type { FileRow, ToolRow } from '../../../types'
import { avgLabel, avgMs } from '../../domain/activity'
import { cellCount, fitCells } from '../../domain/agents'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { ToolsView } from '../model'

/** Border and padding on each side of a row inside the frame. */
const CHROME = 4
/** A call or read count, right-aligned. */
const COUNT_CELLS = 5
/** `✗12` or `✎12`, after two spaces. */
const MARK_CELLS = 6
/** `avg* 12.3s`, after one space. */
const AVG_CELLS = 12
/** A name or path stops growing here, so a wide pane keeps its figures beside it, tools' and files' in one column. */
const NAME_MAX = 32

/** `s` filled with spaces to `n` terminal cells. */
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - cellCount(s)))

/** `Bash      42  ✗3   avg* 0.4s`: the error count in the error colour beside its glyph, and only when there are some. */
const toolRow = (d: Draw, r: ToolRow, nameCells: number): RenderElement => {
  const { Text } = d.els
  const { C } = d
  return (
    <Text key={`tool-${r.tool}`} wrap="truncate">
      <Text color={C.text}>{`${pad(fitCells(r.tool, nameCells - 1), nameCells)}${String(r.calls).padStart(COUNT_CELLS)}`}</Text>
      <Text color={C.error}>{pad(r.errors > 0 ? `  ✗${r.errors}` : '', MARK_CELLS)}</Text>
      <Text color={C.dim}>{` ${avgLabel(avgMs(r))}`}</Text>
    </Text>
  )
}

/** `src/auth/login.ts   12  ✎3`: reads, then edits once there are some. */
const fileRow = (d: Draw, f: FileRow, pathCells: number): RenderElement => {
  const { Text } = d.els
  const { C } = d
  const edits = f.edits > 0 ? `  ✎${f.edits}` : ''
  return (
    <Text key={`file-${f.path}`} color={f.byMain ? C.text : C.dim} dimColor={!f.byMain} wrap="truncate">
      {`${pad(fitCells(f.path, pathCells - 1), pathCells)}${String(f.reads).padStart(COUNT_CELLS)}${edits}`}
    </Text>
  )
}

export const toolsPanel = (d: Draw, v: ToolsView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  const room = Math.max(1, width - CHROME)
  const nameCells = Math.max(1, Math.min(NAME_MAX, room - COUNT_CELLS - MARK_CELLS - AVG_CELLS))
  const pathCells = Math.max(1, Math.min(NAME_MAX, room - COUNT_CELLS - MARK_CELLS))
  const rows: RenderElement[] = v.tools.map(r => toolRow(d, r, nameCells))
  if (v.files.length > 0) {
    rows.push(
      <Text key="hot-files" color={C.dim}>
        hot files
      </Text>,
      ...v.files.map(f => fileRow(d, f, pathCells)),
    )
  }
  return (
    <Box key="tools" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'tools-frame', label: 'TOOLS & FILES', meta: v.meta, width, children: rows })}
    </Box>
  )
}
