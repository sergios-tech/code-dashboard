// Shared harness for the render tests: the engine stubs every test needs, the pane's mount spec,
// spawn payloads, and a text drawing of a mounted tree for width checks.
import type { AgentSpawnInput, On, RenderElement } from 'claude-code'
import { mock } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
} from '../hooks/state/schema'
import type { Snapshot } from '../hooks/state/schema'
import { cellsOf, layoutCells } from '../hooks/view/cells'
import type { Draw } from '../hooks/view/draw'
import { buildViewModel } from '../hooks/view/model'
import { COLORS } from '../hooks/view/palette'

/** The mocked clock, plus answers for the events the plugin passes on but the kit leaves open. */
export const engine = (on: On) => {
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

/** The mount spec of the dashboard pane at a body width; spread it and add the `surface`. */
export const pane = (bodyColumns: number, placement: 'dock' | 'inline' = 'dock') => ({
  plugin: 'st-code',
  component: 'Pane' as const,
  requestId: 'st-code',
  props: {
    title: "Sergio's Tech · Code",
    isFocused: true,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawned = 0

/** An `agent.spawn` payload from the main loop, each with its own tool_use_id. */
export const spawn = (subagentType: string, description: string): AgentSpawnInput => ({
  tool_use_id: `spawn-${++spawned}`,
  prompt: description,
  description,
  subagentType,
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

// ---------------------------------------------------------------- render helpers
//
// Element constructors that build the same plain data a surface's table does, so a renderer can be
// drawn without a mount, a snapshot with nothing in it, and finders over a drawn tree.

export const el =
  (type: string) =>
  ({ children, ...props }: Record<string, unknown> & { children?: unknown[] }) =>
    ({ type, props, children: children ?? [] }) as unknown as RenderElement
export const ELS = { Box: el('Box'), Text: el('Text'), Client: el('Client'), Button: el('Button'), Svg: el('Svg') }
export const draw = (o: Partial<Draw> = {}): Draw => ({ els: ELS as never, C: COLORS, hasClient: true, motion: true, surface: 'terminal', isPicture: false, now: 0, isIdle: false, ...o })

export const FRESH: Snapshot = {
  main: DEFAULT_MAIN,
  usage: DEFAULT_USAGE,
  turn: DEFAULT_TURN,
  agents: [],
  loops: [],
  architect: DEFAULT_ARCHITECT,
  activity: DEFAULT_ACTIVITY,
  log: [],
  view: DEFAULT_VIEW,
  roster: DEFAULT_ROSTER,
}
export const vmOf = (s: Partial<Snapshot>, bodyColumns = 64, placement: 'dock' | 'inline' = 'dock', now = 0) =>
  buildViewModel({ ...FRESH, ...s }, { cfg: parseConfig({}), now, bodyColumns, placement, viewedAgentId: null })

/** The props of every node of a type in a tree. */
export const found = (tree: unknown, type: string): Record<string, unknown>[] => {
  if (typeof tree !== 'object' || tree === null) return []
  const n = tree as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  return [...(n.type === type ? [n.props ?? {}] : []), ...(n.children ?? []).flatMap(c => found(c, type))]
}

/** One entry per Text node: its own string children joined, with its colour and weight. */
export const texts = (tree: unknown): { text: string; color?: string; bold?: boolean }[] => {
  if (typeof tree !== 'object' || tree === null) return []
  const n = tree as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const kids = n.children ?? []
  const own: { text: string; color?: string; bold?: boolean }[] = []
  if (n.type === 'Text') {
    const { color, bold } = n.props ?? {}
    own.push({
      text: kids.filter((c): c is string => typeof c === 'string').join(''),
      ...(typeof color === 'string' ? { color } : {}),
      ...(typeof bold === 'boolean' ? { bold } : {}),
    })
  }
  return [...own, ...kids.flatMap(texts)]
}

// ---------------------------------------------------------------- text drawing
//
// The terminal's layout lives in `hooks/view/cells.ts`, the same cells the desktop app's and VS
// Code's pictures are made of; the kit only reads them as text.

type Clients = ReadonlyMap<string, RenderElement | undefined>

/** Cells a string takes on the terminal: two for a wide character, none for a combining mark. */
export const cellWidth = (s: string): number => cellsOf(s).length

const propsOf = (n: RenderElement): Record<string, unknown> => (n as { props?: Record<string, unknown> }).props ?? {}
const clientKeys = (n: unknown): string[] => {
  if (typeof n !== 'object' || n === null) return []
  const node = n as RenderElement
  const own = node.type === 'Client' && typeof propsOf(node).key === 'string' ? [String(propsOf(node).key)] : []
  return [...own, ...((node as { children?: unknown[] }).children ?? []).flatMap(clientKeys)]
}

/** The text rows of a tree, as the terminal would lay it out; `clients` are what each `Client` drew, by key. */
export const drawRows = (tree: RenderElement, clients: Clients = new Map()): string[] =>
  layoutCells(tree, undefined, n => clients.get(String(propsOf(n).key)) ?? null).map(r => r.map(c => c.ch).join(''))

/** A mounted drawing flattened into its text rows, each `Client` region filled with what its module drew. */
export async function rowsOf(ui: { drawn: (scope?: { in?: string }) => Promise<RenderElement> }): Promise<string[]> {
  const tree = await ui.drawn()
  const clients = new Map<string, RenderElement | undefined>()
  for (const key of clientKeys(tree)) clients.set(key, await ui.drawn({ in: key }).catch(() => undefined))
  return drawRows(tree, clients)
}
