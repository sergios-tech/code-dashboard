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
  /** The surface shows the pane as pictures of its cells (every surface but the terminal), which animate themselves. */
  isPicture: boolean
  /** The person's `motion` setting; the header pulse honours it, clocks tick regardless. */
  motion: boolean
  surface: string
  now: number
}

/** The surface animates what it draws, by client modules or inside a picture, and the person has not turned motion off. */
export const canAnimate = (d: Draw): boolean => d.motion && ((d.hasClient && 'Client' in d.els) || d.isPicture)

/**
 * A region an animated client module draws: the surface's own `Client` when its table has one, else a
 * plain node that only a picture reads (it stands in for the module). The module is named here so each
 * path stays a literal in the source, as the host requires.
 */
export const clientNode = (d: Draw, key: string, module: 'pulse' | 'sweep', width: number, props: Record<string, string | number | boolean>): RenderElement => {
  const { els } = d
  if ('Client' in els) {
    return module === 'pulse' ? (
      <els.Client key={key} module="../client/pulse.tsx" width={width} height={1} props={props} />
    ) : (
      <els.Client key={key} module="../client/sweep.tsx" width={width} height={1} props={props} />
    )
  }
  return (
    module === 'pulse'
      ? { type: 'Client', props: { key, module: '../client/pulse.tsx', width, height: 1, props }, children: [] }
      : { type: 'Client', props: { key, module: '../client/sweep.tsx', width, height: 1, props }, children: [] }
  ) as unknown as RenderElement
}

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
