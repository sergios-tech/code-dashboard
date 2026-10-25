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
 * The layout to draw: the `/st-code-display layout` choice, else the configured one, else `auto`, which is
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

export const WIDE_LEFT: Panel[] = ['info', 'tools']
export const WIDE_RIGHT: Panel[] = ['agents', 'architect']

const cells = (s: string): number => Array.from(s).length

/**
 * How much of the header's right side fits `room` cells: the longest of `● MODEL · ARCH` (`arch`),
 * `● MODEL` (`model`) and `●` (`dot`). An empty model drops out of every variant; the state dot
 * always stays.
 */
export const headerFit = (model: string, arch: string | null, room: number): 'arch' | 'model' | 'dot' => {
  const name = model.trim().toUpperCase()
  const named = name ? `● ${name}` : '●'
  if (arch && cells(`${named} · ${arch}`) <= room) return 'arch'
  return cells(named) <= room ? 'model' : 'dot'
}
