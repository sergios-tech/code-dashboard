// The LOG panel: the newest session lines, each `m:ss  actor  text`, with a state mark last.
import type { RenderElement } from 'claude-code'

import type { LogLine } from '../../../types'
import { cellCount, fitCells } from '../../domain/agents'
import { fmtSession } from '../../format/text'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { LogView } from '../model'
import { familyColor } from '../palette'

const WHO_CELLS = 11
// Border and padding on each side of a row inside the frame.
const CHROME = 4

/** The actor as the row names it: the main loop by its model family in lower case, else as stored. */
const actorName = (l: LogLine, mainModel: string): string => (l.who === 'main' ? ((mainModel.split(' ')[0] ?? '').toLowerCase() || 'main') : l.who)

/** The actor's colour: the main loop by its model family, consults in the architect colour, agents in orange. */
const actorTone = (d: Draw, l: LogLine, mainModel: string): string => {
  const { C } = d
  if (l.who === 'main') return familyColor(mainModel)
  if (l.who === 'you') return C.text
  if (l.who === 'engine') return C.dim
  if (l.who === 'architect' || l.kind === 'consult') return C.architect
  if (l.who === 'gate') return C.gold
  return C.orange
}

/** A line's time into the session, `--:--` when it or the session's start is unknown. */
const timeLabel = (at: number, startedAt: number | null): string => (at > 0 && startedAt !== null ? fmtSession(at - startedAt) : '--:--')

export const logPanel = (d: Draw, log: LogView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  // The times are right-aligned to the widest one shown, plus a space before the actor.
  const times = log.lines.map(l => timeLabel(l.at, log.startedAt))
  const timeCells = Math.max(0, ...times.map(cellCount)) + 1
  const lines =
    log.lines.length === 0
      ? [
          <Text key="empty" color={C.dim}>
            nothing yet
          </Text>,
        ]
      : log.lines.map((l, i) => {
          // The mark keeps its cells and a space before it; only the text is cut to what is left.
          const markCells = l.mark ? cellCount(l.mark) + 1 : 0
          const textCells = Math.max(1, width - CHROME - timeCells - WHO_CELLS - markCells)
          return (
            <Box key={`${i}-${l.at}`}>
              <Box width={timeCells} flexShrink={0}>
                <Text color={C.dim}>{(times[i] ?? '').padStart(timeCells - 1)}</Text>
              </Box>
              <Box width={WHO_CELLS} flexShrink={0}>
                <Text bold color={actorTone(d, l, log.mainModel)} wrap="truncate">
                  {fitCells(actorName(l, log.mainModel), WHO_CELLS - 1)}
                </Text>
              </Box>
              <Text color={C.text} wrap="truncate">
                {fitCells(l.text, textCells)}
              </Text>
              {l.mark ? (
                <Text bold color={l.mark === '✗' ? C.error : C.gold} wrap="truncate">
                  {` ${l.mark}`}
                </Text>
              ) : null}
            </Box>
          )
        })
  // Blank rows keep the side borders running down to the bottom border, at the pane's last row.
  const rows = [...lines, ...Array.from({ length: Math.max(0, log.rows - lines.length) }, (_, i) => <Text key={`pad-${i}`}>{' '}</Text>)]
  return (
    <Box key="log" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'log-frame', label: log.isViewingAgent ? 'LOG · THIS AGENT' : 'LOG', width, children: rows })}
    </Box>
  )
}
