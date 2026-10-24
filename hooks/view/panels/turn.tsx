// The TURN panel: the running turn's clock and tally, or the receipt of the last turn.
import type { RenderElement } from 'claude-code'

import { receiptRows } from '../../domain/turn'
import { plural } from '../../format/text'
import { clock } from '../draw'
import type { Draw } from '../draw'
import { frame } from '../frame'
import type { TurnView } from '../model'

/** The edit and error counts join the running row from this width, so a 120-column pane's right column (59) keeps them. */
const COUNTS_FROM = 56

const running = (d: Draw, t: TurnView, width: number): RenderElement[] => {
  const { Box, Text } = d.els
  const { C } = d
  const counts = width >= COUNTS_FROM
  const rows: RenderElement[] = [
    <Box key="turn-run" columnGap={1}>
      <Text bold color={C.green}>
        ◐ turn
      </Text>
      {clock(d, 'turn-clock', t.startedAt, null, C.green)}
      {counts ? (
        <Text color={C.dim} wrap="truncate">{`· ${plural(t.edits, 'edit')} · ${plural(t.errors, 'error')}`}</Text>
      ) : null}
    </Box>,
  ]
  if (t.isReviewing) {
    rows.push(
      <Text key="turn-review" color={C.architect} wrap="truncate">
        reviewing before done (inferred)
      </Text>,
    )
  }
  return rows
}

const receipt = (d: Draw, t: TurnView, width: number): RenderElement[] => {
  const { Box, Text } = d.els
  const { C } = d
  const r = t.receipt
  if (!r) return []
  const isOk = r.reason === 'answer'
  return receiptRows(r, width).map((row, i) => (
    <Box key={`turn-last-${i}`} columnGap={1}>
      <Box width={1} flexShrink={0}>
        <Text bold color={isOk ? C.green : C.error}>
          {i === 0 ? (isOk ? '✓' : '✗') : ' '}
        </Text>
      </Box>
      <Text color={C.text} wrap="truncate">
        {row}
      </Text>
    </Box>
  ))
}

export const turnPanel = (d: Draw, t: TurnView, width: number): RenderElement => {
  const { Box } = d.els
  return (
    <Box key="turn" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'turn-frame', label: 'TURN', width, isActive: t.isRunning, children: t.isRunning ? running(d, t, width) : receipt(d, t, width) })}
    </Box>
  )
}
