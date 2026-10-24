// Vector drawings for the surfaces that take `Svg` (desktop, VS Code, mobile). They use the same
// tokens on an OLED-black rect, since the identity does not follow a light host theme. Pure.
import type { AgentCard, Architect } from '../../types'
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
      `<rect x="${from}" y="${mid - 2}" width="${Math.max(2, x(c.endAt ?? now) - from)}" height="4" fill="${COLORS.architect}"/>` +
      `<polygon points="${from},${mid - d} ${from + d},${mid} ${from},${mid + d} ${from - d},${mid}" fill="${COLORS.architect}"/>`
    )
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${TIMELINE_PX}" viewBox="0 0 ${w} ${TIMELINE_PX}">` +
    `<rect x="0" y="0" width="${w}" height="${TIMELINE_PX}" fill="${COLORS.fill}"/>` +
    `<line x1="${PAD_PX}" y1="${mid}" x2="${PAD_PX + spanPx}" y2="${mid}" stroke="${COLORS.faint}" stroke-width="1"/>` +
    marks.join('') +
    '</svg>'
  )
}

/**
 * A line of `values` in `color`, `widthPx` by `heightPx`, on a faint baseline. The first value sits at
 * the left edge and the last at the right; a missing value breaks the line, and a run of one is a dot.
 * Values are placed between `range.min` and `range.max` (default: 0 to the largest value).
 */
export const svgSpark = (values: (number | null)[], widthPx: number, heightPx: number, color: string, range?: { min: number; max: number }): string => {
  const w = Math.max(MIN_PX, Math.round(Number.isFinite(widthPx) ? widthPx : 0))
  const h = Math.max(TIMELINE_PX, Math.round(Number.isFinite(heightPx) ? heightPx : 0))
  const list = Array.isArray(values) ? values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null)) : []
  const min = range?.min ?? 0
  const max = range?.max ?? Math.max(0, ...list.filter((v): v is number => v !== null))
  const spanX = w - 2 * PAD_PX
  const spanY = h - 2 * PAD_PX
  const x = (i: number) => PAD_PX + (list.length > 1 ? Math.round((i / (list.length - 1)) * spanX) : spanX)
  const y = (v: number) => PAD_PX + Math.round((1 - (max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0)) * spanY)
  const runs: { x: number; y: number }[][] = []
  let open: { x: number; y: number }[] | null = null
  list.forEach((v, i) => {
    if (v === null) {
      open = null
      return
    }
    if (!open) runs.push((open = []))
    open.push({ x: x(i), y: y(v) })
  })
  const marks = runs.map(r =>
    r.length === 1
      ? `<circle cx="${r[0]?.x}" cy="${r[0]?.y}" r="2" fill="${color}"/>`
      : `<polyline points="${r.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`,
  )
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${COLORS.fill}"/>` +
    `<line x1="${PAD_PX}" y1="${h - PAD_PX}" x2="${PAD_PX + spanX}" y2="${h - PAD_PX}" stroke="${COLORS.faint}" stroke-width="1"/>` +
    marks.join('') +
    '</svg>'
  )
}
