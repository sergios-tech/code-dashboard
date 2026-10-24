// The AGENTS panel: a bordered card per subagent side by side while they fit, else one lane per
// agent on a shared time axis. The card a hotkey opened shows its details under the frame, and the
// surfaces that draw vectors add the same axis as an SVG. Then the LOOPS row: the model loops no
// card claims.
import type { RenderElement } from 'claude-code'

import type { AgentCard } from '../../../types'
import { AGENT_GLYPH, cardTitle, fitCells, lanes, titleLines } from '../../domain/agents'
import { kTokens, plural, prettyModel } from '../../format/text'
import { clock } from '../draw'
import type { Draw } from '../draw'
import { frame } from '../frame'
import { loopsWords } from '../model'
import type { AgentsView, ExpandedView, LoopsView } from '../model'
import { agentTone, svgLanes } from '../svg'

/** What pressing a card's title does: its expanded block opens, or closes when it was open. */
export type Expand = (id: string) => () => unknown

/** Border and padding on each side of a row inside a card or a frame. */
const CHROME = 4
/** A plain Button with a hotkey draws `1: ` before its label. */
const HOTKEY_CELLS = 3
/** The `▶ ` before the title of the agent being viewed. */
const MARK_CELLS = 2
/** A lane's title, after its hotkey. */
const LANE_TITLE_CELLS = 14
/** A lane's glyph and the space after it. */
const LANE_GLYPH_CELLS = 2
/** A lane's clock, right-aligned: `m:ss` to `XhYY`. */
const LANE_CLOCK_CELLS = 5
/** The axis keeps a few cells however tight the row. */
const LANE_MIN_CELLS = 4
/** About one terminal cell, in CSS pixels, for the width of the desktop's axis. */
const CELL_PX = 8

/** `type`, or `type · Model` when the card runs on another model than the main loop. */
const kindOf = (c: AgentCard, mainModel: string): string => {
  const name = c.model ? prettyModel(c.model) : ''
  return name && name !== mainModel ? `${c.type} · ${name}` : c.type
}

/** The status word beside the glyph: `max_tokens` replaces it once a request was cut there. */
const statusOf = (c: AgentCard): string => `${AGENT_GLYPH[c.status]} ${c.lastStop === 'max_tokens' ? 'max_tokens' : c.status}`

const mark = (d: Draw): RenderElement => {
  const { Text } = d.els
  return (
    <Text key="mark" bold color={d.C.orange}>
      ▶{' '}
    </Text>
  )
}

/** One card: two title rows (the first a hotkey Button), the type, the counts, and status with a clock. */
const card = (d: Draw, a: AgentsView, c: AgentCard, i: number, expand: Expand): RenderElement => {
  const { Box, Text, Button } = d.els
  const { C } = d
  const isViewed = a.viewedId === c.id
  const room = Math.max(1, a.cardWidth - CHROME)
  const [first, second] = titleLines(cardTitle(c), Math.max(1, room - HOTKEY_CELLS - (isViewed ? MARK_CELLS : 0)), room)
  const counts = c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${c.steps} st` : 'starting…'
  return (
    <Box
      key={`card-box-${c.id}`}
      flexDirection="column"
      width={a.cardWidth}
      flexShrink={0}
      borderStyle="single"
      borderColor={c.lastStop === 'max_tokens' ? C.error : C.orange}
      borderDimColor={c.status !== 'running'}
      paddingX={1}
    >
      <Box key="title">
        {isViewed ? mark(d) : null}
        <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={first || c.type} onPress={expand(c.id)} />
      </Box>
      <Text key="title-2" bold color={C.text} wrap="truncate">
        {second || ' '}
      </Text>
      <Text key="kind" color={C.dim} wrap="truncate">
        {kindOf(c, a.mainModel)}
      </Text>
      <Text key="counts" color={C.text} wrap="truncate">
        {counts}
      </Text>
      <Box key="status" columnGap={1}>
        <Text color={agentTone(c)} wrap="truncate">
          {statusOf(c)}
        </Text>
        <Box flexShrink={0}>{clock(d, `card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
      </Box>
    </Box>
  )
}

/** One row per agent, `● 1: title  ···━━━···  0:42`, the newest six, under `+N earlier`. */
const laneRows = (d: Draw, a: AgentsView, width: number, expand: Expand): RenderElement[] => {
  const { Box, Text, Button } = d.els
  const { C } = d
  const titleCells = HOTKEY_CELLS + LANE_TITLE_CELLS
  // The axis takes what the glyph, title, the spaces around the axis and the clock leave.
  const axis = Math.max(LANE_MIN_CELLS, width - CHROME - LANE_GLYPH_CELLS - titleCells - 2 - LANE_CLOCK_CELLS)
  const geo = lanes(a.shown, a.now, axis)
  const rows: RenderElement[] = []
  if (a.earlier > 0) {
    rows.push(
      <Text key="lanes-earlier" color={C.dim}>
        {`+${a.earlier} earlier`}
      </Text>,
    )
  }
  a.shown.forEach((c, i) => {
    const g = geo[i] ?? { before: 0, bar: 1, after: Math.max(0, axis - 1) }
    const isViewed = a.viewedId === c.id
    const tone = agentTone(c)
    rows.push(
      <Box key={`lane-${c.id}`}>
        <Box width={LANE_GLYPH_CELLS} flexShrink={0}>
          <Text color={tone}>{AGENT_GLYPH[c.status]}</Text>
        </Box>
        <Box width={titleCells} flexShrink={0}>
          {isViewed ? mark(d) : null}
          <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={fitCells(cardTitle(c), LANE_TITLE_CELLS - (isViewed ? MARK_CELLS : 0))} onPress={expand(c.id)} />
        </Box>
        <Text color={C.faint}>{` ${'·'.repeat(g.before)}`}</Text>
        <Text color={tone}>{'━'.repeat(g.bar)}</Text>
        <Text color={C.faint}>{`${'·'.repeat(g.after)} `}</Text>
        <Box width={LANE_CLOCK_CELLS} flexShrink={0} justifyContent="flex-end">
          {clock(d, `lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
        </Box>
      </Box>,
    )
  })
  return rows
}

/** The opened card under the frame: the whole task, its facts, the last three tools and the answer's start. */
const expandedBlock = (d: Draw, x: ExpandedView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  return (
    <Box key="agent-open" flexDirection="column" width={width} borderStyle="single" borderColor={C.orange} paddingX={1}>
      {x.description.map((row, i) => (
        <Text key={`task-${i}`} bold color={C.text} wrap="truncate">
          {row}
        </Text>
      ))}
      <Text key="facts" color={C.dim} wrap="truncate">
        {x.meta}
      </Text>
      {x.tools.length === 0 ? (
        <Text key="no-tools" color={C.dim}>
          no tool calls yet
        </Text>
      ) : (
        x.tools.map((n, i) => (
          <Text key={`tool-${i}`} color={n.isError ? C.error : C.text} wrap="truncate">
            {`${n.isError ? '✗' : '·'} ${n.text}`}
          </Text>
        ))
      )}
      {x.answer.map((row, i) => (
        <Text key={`answer-${i}`} color={C.text} wrap="truncate">
          {row}
        </Text>
      ))}
    </Box>
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
  const body =
    a.mode === 'cards'
      ? [
          <Box key="agent-cards" columnGap={1}>
            {a.shown.map((c, i) => card(d, a, c, i, expand))}
          </Box>,
        ]
      : laneRows(d, a, width, expand)
  return (
    <Box key="agents" marginTop={1} flexDirection="column" width={width}>
      {frame(d, { key: 'agents-frame', label: a.label, meta: a.meta, width, children: body })}
      {axisSvg(d, a, width)}
      {a.expanded ? expandedBlock(d, a.expanded, width) : null}
    </Box>
  )
}

const LOOP_GLYPH: Record<LoopsView['dots'][number], string> = { active: '●', done: '✓', idle: '○' }

/** `LOOPS  3 seen · 1 active  ✓○●`: frameless, one row under the agents. */
export const loopsRow = (d: Draw, l: LoopsView, width: number): RenderElement => {
  const { Box, Text } = d.els
  const { C } = d
  const toneOf = (s: LoopsView['dots'][number]) => (s === 'active' ? C.orange : s === 'done' ? C.green : C.dim)
  return (
    <Box key="loops" marginTop={1} paddingX={1} width={width}>
      <Text wrap="truncate">
        <Text key="label" bold color={C.text}>
          LOOPS
        </Text>
        <Text key="words" color={C.dim}>
          {loopsWords(l.seen, l.active)}
        </Text>
        {l.dots.map((s, i) => (
          <Text key={`dot-${i}`} color={toneOf(s)}>
            {LOOP_GLYPH[s]}
          </Text>
        ))}
      </Text>
    </Box>
  )
}
