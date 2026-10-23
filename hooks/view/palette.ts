// The OLED palette: fixed hex on pure black, from the Sergio's Tech black theme. The pane never
// follows the person's terminal theme, so every value here is a literal colour, not a theme key.

export const COLORS = {
  bg: '#000000',
  text: '#d4d4d4',
  /** Header fill and frame lines only: at about 2:1 on black it never carries text. */
  brand: '#8a0000',
  onBrand: '#ffffff',
  main: '#569cd6',
  agent: '#4ec9b0',
  arch: '#c586c0',
  ok: '#0dbc79',
  amber: '#d7ba7d',
  error: '#f44747',
  dim: '#808080',
  /** Empty gauge cells and rules only: too dark to read as text. */
  faint: '#3c3c3c',
} as const

/** The tokens text may be drawn in: every one reaches 4.5:1 on black. */
export const TEXT_TOKENS: (keyof typeof COLORS)[] = ['text', 'onBrand', 'main', 'agent', 'arch', 'ok', 'amber', 'error', 'dim']

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
