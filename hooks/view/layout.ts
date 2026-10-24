// Layout math: pure functions of widths and settings, no elements and no state.
import type { Layout } from '../../types'
import type { Panel } from '../config'

/** Every panel is laid out for at least this many columns, however narrow the pane. */
export const MIN_WIDTH = 40
/** Docked panes this wide or wider get two columns under `auto`. */
export const WIDE_FROM = 110
const GAP = 2

export const clampWidth = (bodyColumns: number): number =>
  Number.isFinite(bodyColumns) ? Math.max(MIN_WIDTH, Math.floor(bodyColumns)) : MIN_WIDTH

/**
 * The layout to draw: the `/st-code layout` choice, else the configured one, else `auto`, which is
 * the summary inline above the prompt and two columns from WIDE_FROM when docked. A forced `wide`
 * too narrow for two MIN_WIDTH columns draws one column instead of panels squeezed below 40.
 */
export const pickLayout = (
  cfg: Layout,
  override: Layout | null,
  placement: 'dock' | 'inline',
  width: number,
): 'compact' | 'wide' | 'mini' => {
  const chosen = override ?? cfg
  if (chosen === 'wide') return width >= 2 * MIN_WIDTH + GAP ? 'wide' : 'compact'
  if (chosen !== 'auto') return chosen
  if (placement === 'inline') return 'mini'
  return width >= WIDE_FROM ? 'wide' : 'compact'
}

/** The two columns of the wide layout; the right one, holding the agents, takes the odd column. */
export const wideColumns = (width: number): { left: number; right: number; gap: 2 } => {
  const left = Math.floor((width - GAP) / 2)
  return { left, right: width - GAP - left, gap: GAP }
}

export const WIDE_LEFT: Panel[] = ['info', 'trends', 'tools']
export const WIDE_RIGHT: Panel[] = ['agents', 'loops', 'architect']

const cells = (s: string): number => Array.from(s).length

/**
 * The right side of the header bar, the longest variant that fits `room` cells: the status words
 * go first, then the model; the state glyph always stays. An unknown model is left out.
 */
export const headerRight = (model: string, isRunning: boolean, arch: string | null, room: number): string => {
  const glyph = isRunning ? '●' : '○'
  const name = model.trim().toUpperCase()
  const named = name ? `${glyph} ${name}` : glyph
  const state = `${named} ${isRunning ? 'WORKING' : 'IDLE'}`
  const variants = [arch ? `${state} · ${arch}` : null, state, named, glyph]
  return variants.find((v): v is string => v !== null && cells(v) <= room) ?? glyph
}
