// Vector drawings for the surfaces that take `Svg` (desktop, VS Code, mobile). They use the same
// tokens on an OLED-black rect, since the identity does not follow a light host theme. Pure.
import type { AgentCard, Architect } from '../../types'
import { AGENT_GLYPH, cardTitle, fitCells, lanes } from '../domain/agents'
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
 * An agent's colour on every surface: its card status, lane bar and SVG bar. Always drawn beside its
 * status glyph, so the state is never told by colour alone.
 */
export const agentTone = (c: AgentCard): string =>
  c.lastStop === 'max_tokens' || c.status === 'failed' ? COLORS.error : c.status === 'done' ? COLORS.ok : c.status === 'stopped' ? COLORS.dim : COLORS.agent

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
  const h = shown.length * ROW_PX + 2 * PAD_PX
  const geo = lanes(shown, now, barPx)
  const chars = Math.max(4, Math.floor(labelPx / CHAR_PX) - 3)
  const rows = shown.map((c, i) => {
    const g = geo[i]
    const y = PAD_PX + i * ROW_PX
    const label = escapeXml(`${AGENT_GLYPH[c.status]} ${fitCells(cardTitle(c), chars)}`)
    return (
      `<line x1="${barX}" y1="${y + 9}" x2="${barX + barPx}" y2="${y + 9}" stroke="${COLORS.faint}" stroke-width="1"/>` +
      `<rect x="${barX + (g?.before ?? 0)}" y="${y + 4}" width="${Math.max(2, g?.bar ?? 1)}" height="10" fill="${agentTone(c)}"/>` +
      `<text x="${PAD_PX}" y="${y + 13}" font-family="monospace" font-size="11" fill="${c.status === 'running' ? COLORS.text : COLORS.dim}">${label}</text>`
    )
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${COLORS.bg}"/>` +
    rows.join('') +
    '</svg>'
  )
}

/** The timeline's height, and the half-width of the diamond that marks a consult's start. */
const TIMELINE_PX = 24
const DIAMOND_PX = 5

/**
 * The consults on one timeline, `widthPx` wide, from the first consult to now: a faint rule, and per
 * consult a bar while it ran (to now while it runs) and a diamond where it started, as `◆` and `━`
 * draw it in the terminal.
 */
export const svgTimeline = (a: Architect, now: number, widthPx: number): string => {
  const w = Math.max(MIN_PX, Math.round(Number.isFinite(widthPx) ? widthPx : 0))
  const spanPx = w - 2 * PAD_PX
  const first = a.consults.length > 0 ? Math.min(...a.consults.map(c => c.at)) : now
  const span = Math.max(1, now - first)
  const x = (t: number) => PAD_PX + Math.round(((Math.min(Math.max(t, first), first + span) - first) / span) * spanPx)
  const mid = TIMELINE_PX / 2
  const marks = a.consults.map(c => {
    const from = x(c.at)
    const d = DIAMOND_PX
    return (
      `<rect x="${from}" y="${mid - 2}" width="${Math.max(2, x(c.endAt ?? now) - from)}" height="4" fill="${COLORS.arch}"/>` +
      `<polygon points="${from},${mid - d} ${from + d},${mid} ${from},${mid + d} ${from - d},${mid}" fill="${COLORS.arch}"/>`
    )
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${TIMELINE_PX}" viewBox="0 0 ${w} ${TIMELINE_PX}">` +
    `<rect x="0" y="0" width="${w}" height="${TIMELINE_PX}" fill="${COLORS.bg}"/>` +
    `<line x1="${PAD_PX}" y1="${mid}" x2="${PAD_PX + spanPx}" y2="${mid}" stroke="${COLORS.faint}" stroke-width="1"/>` +
    marks.join('') +
    '</svg>'
  )
}
