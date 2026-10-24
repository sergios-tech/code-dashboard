// The Signal palette: fixed hex on a pure black fill. The pane never follows the person's terminal
// theme, so every value here is a literal colour, not a theme key.

export const COLORS = {
  /** Painted under the whole pane, header included. */
  fill: '#000000',
  text: '#d0d0d0',
  dim: '#9e9e9e',
  /** The TRENDS cost sparkline only: too dark to read as text. */
  muted: '#4e4e4e',
  /** Empty gauge and bar cells, empty table cells and rules only: too dark to read as text. */
  faint: '#303030',
  /** Frame lines and dividers only: it never carries text. */
  frame: '#d70000',
  brand: '#ff0000',
  orange: '#ff7f00',
  green: '#5fd75f',
  /** The state dot's low beat, nothing else. */
  pulse: '#5f875f',
  gold: '#ffd700',
  architect: '#d7af00',
  error: '#ff5f5f',
} as const

export type Token = keyof typeof COLORS

/** The tokens text may be drawn in: every one reaches 4.5:1 on black in its hex and its 256-colour fallback. */
export const TEXT_TOKENS: readonly Token[] = ['text', 'dim', 'brand', 'orange', 'green', 'pulse', 'gold', 'architect', 'error']

const CUBE = [0, 95, 135, 175, 215, 255]
const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/**
 * The `#rrggbb` the host draws for `hex` in 256-colour mode (tmux without `CLAUDE_CODE_TMUX_TRUECOLOR`,
 * VS Code's integrated terminal). Greys go to the 24-step ramp; other colours round each channel
 * evenly to 0-5, not to the xterm levels.
 */
export const to256 = (hex: string): string => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  const i =
    r === g && g === b
      ? r < 8 ? 16 : r > 248 ? 231 : Math.round(((r - 8) / 247) * 24) + 232
      : 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
  if (i >= 232) {
    const v = 8 + 10 * (i - 232)
    return `#${hex2(v)}${hex2(v)}${hex2(v)}`
  }
  if (i === 231) return '#ffffff'
  const n = i - 16
  return `#${[CUBE[Math.floor(n / 36)]!, CUBE[Math.floor(n / 6) % 6]!, CUBE[n % 6]!].map(hex2).join('')}`
}

/** A level turns gold from this percent. */
export const HOT = 80
/** A level turns coral from this percent. */
export const CRITICAL = 90

/** The colour of a level: green, gold from 80, coral from 90, by the rounded figure. A non-finite figure counts as 0. */
export const levelColor = (pct: number): string => {
  const p = Number.isFinite(pct) ? Math.round(pct) : 0
  return p >= CRITICAL ? COLORS.error : p >= HOT ? COLORS.gold : COLORS.green
}

/** The colour of a model by family: Opus brand, Sonnet orange, Haiku green, Fable gold, any other dim. */
export const familyColor = (model: string): string => {
  const family = /opus|sonnet|haiku|fable/i.exec(model)?.[0].toLowerCase()
  return family === 'opus' ? COLORS.brand : family === 'sonnet' ? COLORS.orange : family === 'haiku' ? COLORS.green : family === 'fable' ? COLORS.gold : COLORS.dim
}

/** Relative luminance of `#rrggbb` or `#rgb`, as WCAG 2 defines it. */
const luminance = (hex: string): number => {
  const raw = hex.replace(/^#/, '')
  const full = raw.length === 3 ? Array.from(raw, c => c + c).join('') : raw
  const channel = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** The WCAG contrast ratio of two colours, from 1 (none) to 21 (white on black). */
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
