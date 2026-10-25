// The agents on one time axis for the surfaces that take `Svg` (desktop, VS Code, mobile), drawn in
// the palette tokens on an OLED-black rect, since the identity does not follow a light host theme.
// Pure. The rest of those surfaces' drawing is `picture.ts`.
import type { AgentCard } from '../../types'
import { agentGlyph, cardTitle, fitCells, isCut, lanes } from '../domain/agents'
import { COLORS } from './palette'

/** `<`, `&` and `>` as entities, so a label is drawn as text and never read as markup. */
export const escapeXml = (s: string): string => s.replace(/[<&>]/g, ch => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;'))

/** The newest agents the axis draws. */
const SVG_LANES = 12
const ROW_PX = 18
const PAD_PX = 8
/** About one monospace character at the label's font size. */
const CHAR_PX = 7
const MIN_PX = 240

/**
 * An agent's colour on every surface: its row, bar and SVG bar. `error` when it failed or ended cut
 * at `max_tokens`, else `green` done, `dim` stopped and `orange` running. Always drawn beside its
 * status glyph, so the state is never told by colour alone.
 */
export const agentTone = (c: AgentCard): string => (isCut(c) ? COLORS.error : c.status === 'done' ? COLORS.green : c.status === 'stopped' ? COLORS.dim : COLORS.orange)

/** The axis's height in pixels for `n` agents: a lane for each of the newest SVG_LANES, and the padding above and below. */
export const lanesHeight = (n: number): number => Math.min(n, SVG_LANES) * ROW_PX + 2 * PAD_PX

/**
 * The agents on one time axis, `widthPx` wide: per agent a label (status glyph and title) and a
 * square bar from its spawn to its end, or to now while it runs, over a faint rule.
 */
export const svgLanes = (cards: AgentCard[], now: number, widthPx: number): string => {
  const shown = cards.slice(-SVG_LANES)
  const w = Math.max(MIN_PX, Math.round(Number.isFinite(widthPx) ? widthPx : 0))
  const labelPx = Math.round(w * 0.36)
  const barX = PAD_PX + labelPx
  const barPx = Math.max(1, w - barX - PAD_PX)
  const h = lanesHeight(shown.length)
  const geo = lanes(shown, now, barPx)
  const chars = Math.max(4, Math.floor(labelPx / CHAR_PX) - 3)
  const rows = shown.map((c, i) => {
    const g = geo[i]
    const y = PAD_PX + i * ROW_PX
    const label = escapeXml(`${agentGlyph(c)} ${fitCells(cardTitle(c), chars)}`)
    return (
      `<line x1="${barX}" y1="${y + 9}" x2="${barX + barPx}" y2="${y + 9}" stroke="${COLORS.faint}" stroke-width="1"/>` +
      `<rect x="${barX + (g?.before ?? 0)}" y="${y + 4}" width="${Math.max(2, g?.bar ?? 1)}" height="10" fill="${agentTone(c)}"/>` +
      `<text x="${PAD_PX}" y="${y + 13}" font-family="monospace" font-size="11" fill="${c.status === 'running' ? COLORS.text : COLORS.dim}">${label}</text>`
    )
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${COLORS.fill}"/>` +
    rows.join('') +
    '</svg>'
  )
}
