// The LOG panel: the newest session lines, each `HH:MM:SS  who  text`.
import type { RenderElement } from 'claude-code'

import type { LogLine } from '../../../types'
import { logText } from '../../domain/log'
import { fmtClock, shorten } from '../../format/text'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { LogView } from '../model'

const TIME_CELLS = 9
const WHO_CELLS = 12
// Border and padding on each side of a row inside the frame.
const CHROME = 4

/** A line's colour from what kind it is and who said it: errors, consults and finished work first. */
const colorOf = (d: Draw, l: LogLine): string => {
  const { C } = d
  if (l.kind === 'error') return C.error
  if (l.kind === 'consult') return C.architect
  if (l.kind === 'done') return C.green
  if (l.who === 'main') return C.green
  if (l.who === 'you' || l.who === 'engine') return C.text
  if (l.who === 'gate') return C.gold
  return C.orange
}

export const logPanel = (d: Draw, log: LogView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  const textCells = Math.max(1, width - CHROME - TIME_CELLS - WHO_CELLS)
  const rows =
    log.lines.length === 0
      ? [
          <Text key="empty" color={C.dim}>
            nothing yet
          </Text>,
        ]
      : log.lines.map((l, i) => (
          <Box key={`${i}-${l.at}`}>
            <Box width={TIME_CELLS} flexShrink={0}>
              <Text color={C.dim}>{fmtClock(l.at)}</Text>
            </Box>
            <Box width={WHO_CELLS} flexShrink={0}>
              <Text bold color={colorOf(d, l)} wrap="truncate">
                {shorten(l.who, WHO_CELLS - 1)}
              </Text>
            </Box>
            <Text color={l.kind === 'error' ? C.error : C.text} wrap="truncate">
              {logText(l, textCells)}
            </Text>
          </Box>
        ))
  return (
    <Box key="log" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'log-frame', label: log.isViewingAgent ? 'LOG · THIS AGENT' : 'LOG', width, children: rows })}
    </Box>
  )
}
