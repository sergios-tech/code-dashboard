// What every renderer draws with: the surface's element table and the facts about that surface.
import type { EngineInterface } from 'claude-code'

import { COLORS } from './palette'

/** The element table `$.ui.resolve(e)` hands out, for whichever surface asked. */
export type Els = ReturnType<EngineInterface['ui']['resolve']>

export type Draw = {
  els: Els
  C: typeof COLORS
  /** The surface can run a `Client` module: the terminal and the desktop app. */
  hasClient: boolean
  /** The person's `motion` setting; the header pulse honours it, clocks tick regardless. */
  motion: boolean
  surface: string
  now: number
}
