// The LOG panel: the newest session lines, each `HH:MM:SS  actor  text`, with a state mark last.
import type { RenderElement } from 'claude-code'

import type { LogLine } from '../../../types'
import { cellCount, fitCells } from '../../domain/agents'
import { fmtClock } from '../../format/text'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { LogView } from '../model'
import { familyColor } from '../palette'

const TIME_CELLS = 9
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

export const logPanel = (d: Draw, log: LogView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  const rows =
    log.lines.length === 0
      ? [
          <Text key="empty" color={C.dim}>
            nothing yet
          </Text>,
        ]
      : log.lines.map((l, i) => {
          // The mark keeps its cells and a space before it; only the text is cut to what is left.
          const markCells = l.mark ? cellCount(l.mark) + 1 : 0
          const textCells = Math.max(1, width - CHROME - TIME_CELLS - WHO_CELLS - markCells)
          return (
            <Box key={`${i}-${l.at}`}>
              <Box width={TIME_CELLS} flexShrink={0}>
                <Text color={C.dim}>{fmtClock(l.at)}</Text>
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
  return (
    <Box key="log" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'log-frame', label: log.isViewingAgent ? 'LOG · THIS AGENT' : 'LOG', width, children: rows })}
    </Box>
  )
}
