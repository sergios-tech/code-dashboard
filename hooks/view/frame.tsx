// The square panel frame, its caps label set into the top border: `┌ INFO ───── ○ idle ┐`.
//
// Shipped: the overlay. The label and meta are absolutely positioned Boxes painted over the top
// border row. They are placed against an unbordered wrapper, not the bordered Box itself: offsets
// count from inside a Box's border and paint is clipped there, so a `top: -1` against the bordered
// Box never reaches its border, while `top: 0` against the wrapper lands on it. Checked in a live
// terminal pane; the fallback, a label row as the first content row, was not needed. In a pane
// narrower than the frame the wrapper keeps its width and the label and meta stay on one row, so
// they are clipped with the corners instead of wrapping into the content. Dividers are placed the
// same way, one row down per body row index, over the blank row the caller reserved for each.
import type { RenderElement } from 'claude-code'

import { shorten } from '../format/text'
import type { Draw } from './draw'

const cells = (s: string): number => Array.from(s).length

export type FrameProps = {
  key: string
  label: string
  meta?: string
  width: number
  /** The frame holds running work: the border and dividers are drawn in `green` instead of `frame`. */
  isActive?: boolean
  /** Indexes of body rows drawn as `├───┤` across the full width; each must be a `dividerRow`. */
  dividers?: number[]
  children: RenderElement[]
}

/** A blank body row for a divider: one space, with the `├───┤` drawn over it by the frame. */
export const dividerRow = (d: Draw, key: string): RenderElement => {
  const { Text } = d.els
  return <Text key={key}>{' '}</Text>
}

/**
 * A single-line square border with the label one cell in from the left corner and the meta one
 * cell in from the right, each with a space either side and at least one rule cell between them.
 * When both do not fit, the meta is cut first, then dropped.
 */
export const frame = (d: Draw, p: FrameProps): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  // Corners and the spaces around the label, plus one rule cell after it.
  const label = shorten(p.label.toUpperCase(), Math.max(1, p.width - 5))
  // What is left for the meta and its two spaces, after the label, the rule cell and the corners.
  const metaRoom = p.width - (cells(label) + 2) - 1 - 2 - 2
  const meta = p.meta && metaRoom >= 4 ? shorten(p.meta, metaRoom) : ''
  const border = p.isActive ? C.green : C.frame
  return (
    <Box key={p.key} flexDirection="column" width={p.width} flexShrink={0}>
      <Box flexDirection="column" width={p.width} borderStyle="single" borderColor={border} paddingX={1}>
        {p.children}
      </Box>
      <Box position="absolute" top={0} left={1}>
        <Text bold color={C.text} wrap="truncate">{` ${label} `}</Text>
      </Box>
      {meta ? (
        <Box position="absolute" top={0} right={1}>
          <Text color={C.dim} wrap="truncate">{` ${meta} `}</Text>
        </Box>
      ) : null}
      {(p.dividers ?? []).map(i => (
        <Box key={`divider-${i}`} position="absolute" top={1 + i} left={0}>
          <Text color={border}>{`├${'─'.repeat(Math.max(0, p.width - 2))}┤`}</Text>
        </Box>
      ))}
    </Box>
  )
}
