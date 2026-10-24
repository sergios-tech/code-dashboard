// The AGENTS panel: one row per agent, running first, each with a status glyph, its hotkey digit and
// title, its model tag, a status bar and a clock. The agent a hotkey opened shows its details inside
// the frame after a divider, then the loops row: the model loops no agent claims, after another
// divider. The surfaces that draw vectors add the agents on one time axis as an SVG.
import type { RenderElement } from 'claude-code'

import type { AgentCard } from '../../../types'
import { agentGlyph, cardTitle, fitCells, modelTag } from '../../domain/agents'
import { plural } from '../../format/text'
import { canAnimate, clock } from '../draw'
import type { Draw } from '../draw'
import { dividerRow, frame } from '../frame'
import { loopsWords } from '../model'
import type { AgentsView, ExpandedView, LoopsView } from '../model'
import { familyColor } from '../palette'
import { agentTone, svgLanes } from '../svg'

/** What pressing an agent's row does: its details open inside the frame, or close when they were open. */
export type Expand = (id: string) => () => unknown

/** Border and padding on each side of a row inside a frame. */
const CHROME = 4
/** The status glyph and the space after it. */
const GLYPH_CELLS = 2
/** The `N:` of a row and the space after it, beyond the title. */
const NUMBER_CELLS = 3
/** The `▶ ` before the title of the agent being viewed. */
const MARK_CELLS = 2
/** The model tag's column, and the cells its name may take. */
const TAG_CELLS = 7
const TAG_NAME_CELLS = 6
/** The tag is dropped when the frame's inside is narrower than this. */
const TAG_FROM = 50
/** A clock, right-aligned: `m:ss` to `XhYY`. */
const CLOCK_CELLS = 5
/** The status bar is 14 cells from this inside width, 10 from the next, else 6. */
const BAR_WIDE_FROM = 56
const BAR_MID_FROM = 46
/** The least a title column keeps, however tight the row. */
const TITLE_MIN = 6
/** About one terminal cell, in CSS pixels, for the width of the desktop's axis. */
const CELL_PX = 8

const barCells = (inside: number): number => (inside >= BAR_WIDE_FROM ? 14 : inside >= BAR_MID_FROM ? 10 : 6)

/**
 * The status bar of one row, `w` cells: a running agent's three-cell block bouncing along the track
 * where the surface animates, else still at the start of it; an ended agent's bar full in its tone.
 */
const bar = (d: Draw, c: AgentCard, w: number): RenderElement[] => {
  const { Text } = d.els
  const { C } = d
  const tone = agentTone(c)
  if (c.status !== 'running') {
    return [
      <Text key="bar" color={tone}>
        {'▰'.repeat(w)}
      </Text>,
    ]
  }
  if (canAnimate(d) && 'Client' in d.els) {
    const { Client } = d.els
    return [<Client key={`sweep-${c.id}`} module="../../client/sweep.tsx" width={w} height={1} props={{ width: w, color: tone, track: C.faint }} />]
  }
  return [
    <Text key="bar-on" color={tone}>
      {'▰'.repeat(Math.min(3, w))}
    </Text>,
    <Text key="bar-off" color={C.faint}>
      {'▱'.repeat(Math.max(0, w - 3))}
    </Text>,
  ]
}

/** One row per agent, `● 1: title  Haiku  ▰▰▰▱▱▱▱▱▱▱▱▱▱▱  0:37`, and `+N earlier` above them. */
const rows = (d: Draw, a: AgentsView, width: number, expand: Expand): RenderElement[] => {
  const { Box, Text, Button } = d.els
  const { C } = d
  const inside = width - CHROME
  const hasTag = inside >= TAG_FROM
  const tagCells = hasTag ? TAG_CELLS : 0
  const barWidth = barCells(inside)
  // What the glyph, the tag, the bar with a space either side and the clock leave for the digit and title.
  const titleCells = Math.max(TITLE_MIN, inside - GLYPH_CELLS - NUMBER_CELLS - tagCells - (barWidth + 2) - CLOCK_CELLS)
  const out: RenderElement[] = []
  if (a.earlier > 0) {
    out.push(
      <Text key="agents-earlier" color={C.dim}>
        {`+${a.earlier} earlier`}
      </Text>,
    )
  }
  a.shown.forEach((c, i) => {
    const isViewed = a.viewedId === c.id
    const title = fitCells(cardTitle(c), titleCells - 1 - (isViewed ? MARK_CELLS : 0))
    const tag = hasTag ? modelTag(c, a.mainModel) : ''
    out.push(
      <Box key={`row-${c.id}`}>
        <Box width={GLYPH_CELLS} flexShrink={0}>
          <Text color={agentTone(c)}>{agentGlyph(c)}</Text>
        </Box>
        <Box width={NUMBER_CELLS + titleCells} flexShrink={0}>
          {isViewed ? (
            <Text key="mark" bold color={C.orange}>
              {'▶ '}
            </Text>
          ) : null}
          {/* The host draws a plain Button's hotkey in its theme accent, a blue: the hotkey sits on a Button that is not drawn, and the visible one has no hotkey. */}
          <Box key={`hot-${c.id}`} display="none">
            <Button key={`key-${c.id}`} plain hotkey={String(i + 1)} label={title} onPress={expand(c.id)} />
          </Box>
          <Button key={`card-${c.id}`} plain onPress={expand(c.id)}>
            <Text key="n" color={C.orange}>
              {String(i + 1)}
            </Text>
            <Text key="c" color={C.dim}>
              :
            </Text>
            <Text key="t" color={C.text}>
              {` ${title}`}
            </Text>
          </Button>
        </Box>
        {hasTag ? (
          <Box width={TAG_CELLS} flexShrink={0}>
            <Text color={tag ? familyColor(tag) : C.dim}>{fitCells(tag, TAG_NAME_CELLS)}</Text>
          </Box>
        ) : null}
        <Text>{' '}</Text>
        {bar(d, c, barWidth)}
        <Text>{' '}</Text>
        <Box width={CLOCK_CELLS} flexShrink={0} justifyContent="flex-end">
          {clock(d, `row-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
        </Box>
      </Box>,
    )
  })
  return out
}

/** The opened agent's rows: the whole task, its facts, the last three tools and the answer's start. */
const expandedRows = (d: Draw, x: ExpandedView): RenderElement[] => {
  const { Text } = d.els
  const { C } = d
  return [
    ...x.task.map((row, i) => (
      <Text key={`task-${i}`} bold color={C.text} wrap="truncate">
        {row}
      </Text>
    )),
    <Text key="facts" color={C.dim} wrap="truncate">
      {x.facts}
    </Text>,
    ...(x.tools.length === 0
      ? [
          <Text key="no-tools" color={C.dim}>
            no tool calls yet
          </Text>,
        ]
      : x.tools.map((n, i) => (
          <Text key={`tool-${i}`} color={n.isError ? C.error : C.text} wrap="truncate">
            {`${n.isError ? '✗' : '·'} ${n.text}`}
          </Text>
        ))),
    ...(x.answer
      ? [
          <Text key="answer" color={C.text} wrap="truncate">
            {x.answer}
          </Text>,
        ]
      : []),
  ]
}

const LOOP_GLYPH: Record<LoopsView['dots'][number], string> = { active: '●', done: '✓', idle: '○' }

/** `loops  3 seen · 1 active  ✓○●`: the row under the last divider. */
const loopsRow = (d: Draw, l: LoopsView): RenderElement => {
  const { Text } = d.els
  const { C } = d
  const toneOf = (s: LoopsView['dots'][number]) => (s === 'active' ? C.orange : s === 'done' ? C.green : C.dim)
  return (
    <Text key="loops" wrap="truncate">
      <Text key="words" color={C.dim}>
        {loopsWords(l.seen, l.active)}
      </Text>
      {l.dots.map((s, i) => (
        <Text key={`dot-${i}`} color={toneOf(s)}>
          {LOOP_GLYPH[s]}
        </Text>
      ))}
    </Text>
  )
}

/** The agents on one time axis as a vector drawing, for the surfaces that take `Svg`. */
const axisSvg = (d: Draw, a: AgentsView, width: number): RenderElement | null => {
  const { els } = d
  if (d.surface === 'terminal' || !('Svg' in els)) return null
  return <els.Svg key="agents-axis" source={svgLanes(a.all, a.now, width * CELL_PX)} alt={`${plural(a.all.length, 'agent')} on one time axis`} />
}

export const agentsPanel = (d: Draw, a: AgentsView, width: number, expand: Expand): RenderElement => {
  const { Box } = d.els
  const body = rows(d, a, width, expand)
  const dividers: number[] = []
  // A divider row is reserved for the frame to draw over, then the block or row it separates.
  const divide = (key: string, after: RenderElement[]) => {
    dividers.push(body.length)
    body.push(dividerRow(d, key), ...after)
  }
  if (a.expanded) divide('divider-open', expandedRows(d, a.expanded))
  if (a.loops) divide('divider-loops', [loopsRow(d, a.loops)])
  return (
    <Box key="agents" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'agents-frame', label: 'AGENTS', meta: a.meta, width, isActive: a.isActive, dividers, children: body })}
      {axisSvg(d, a, width)}
    </Box>
  )
}
