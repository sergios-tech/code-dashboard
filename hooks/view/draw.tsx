// What every renderer draws with: the surface's element table and the facts about that surface.
import type { EngineInterface, RenderElement } from 'claude-code'

import { fmtTimer } from '../format/text'
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

/** The surface can run the animated client modules and the person has not turned motion off. */
export const canAnimate = (d: Draw): boolean => d.motion && d.hasClient && 'Client' in d.els

/**
 * A clock from `since` to `endAt`, or to now while `endAt` is null. A start of 0 is unknown (state
 * saved before it was recorded), so it reads `—` rather than decades. Where the surface runs client
 * modules the clock ticks by itself, so the pane need not redraw each second; elsewhere it is the
 * value at this draw.
 */
export const clock = (d: Draw, key: string, since: number, endAt: number | null, color: string): RenderElement => {
  const { els } = d
  const { Text } = els
  if (!(since > 0)) return <Text key={key} color={color}>—</Text>
  if (d.hasClient && 'Client' in els) return <els.Client key={key} module="../client/elapsed.tsx" props={{ since, now: d.now, endAt, color }} />
  return (
    <Text key={key} color={color}>
      {fmtTimer((endAt ?? d.now) - since)}
    </Text>
  )
}
