import type { Speed } from '../../types'

// Pure text and number formatting for the pane. Nothing here touches state or the host.

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

/** Code points of `s`, so a cut never splits an emoji's surrogate pair. */
const points = (s: string): string[] => Array.from(s)

/** One line of text collapsed to single spaces, with control characters treated as spaces. */
const oneLine = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim() : ''

/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` is `Opus 5.5 1M`,
 * `claude-sonnet-4-5@20250929` is `Sonnet 4.5`, `claude-3-5-haiku-20241022` is
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters; an empty id is `—`.
 */
export const prettyModel = (id: string): string => {
  if (!id) return '—'
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const named = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?!\d)/i.exec(id)
  if (named?.[1]) return `${cap(named[1].toLowerCase())} ${named[2]}${named[3] ? `.${named[3]}` : ''}${big}`
  const legacy = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (legacy?.[3]) return `${cap(legacy[3].toLowerCase())} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}${big}`
  return shorten(id, 22)
}

/** The family word of a model id, the first word of `prettyModel`: `claude-haiku-4-5` is `Haiku`; empty for an empty id. */
export const modelFamily = (id: string): string => (id ? (prettyModel(id).split(' ')[0] ?? '') : '')

/** One row whatever the input: whitespace and newlines collapse, and anything past `n` ends in `…`. */
export const shorten = (s: string, n: number): string => {
  const one = oneLine(s)
  if (n <= 0) return ''
  const chars = points(one)
  return chars.length > n ? `${chars.slice(0, n - 1).join('').trimEnd()}…` : one
}

export const kTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const pad2 = (n: number) => String(n).padStart(2, '0')

/** An elapsed time in whole seconds, as the running clock counts them: `42s`, `1m42s`, `1h05m`. */
export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${pad2(s % 60)}s` : `${Math.floor(m / 60)}h${pad2(m % 60)}m`
}

/** A running clock as the live cards draw it: `m:ss`, or `XhYY` past an hour. */
export const fmtTimer = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${pad2(s % 60)}` : `${Math.floor(m / 60)}h${pad2(m % 60)}`
}

/** Local wall-clock time `HH:MM:SS`; `--:--:--` when the time is unknown (zero or less). */
export const fmtClock = (ms: number): string => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')

/** `1 error`, `2 errors`. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const fmtUsd = (n: number): string => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/** `ttft 0.8s · 42 tok/s`; `— tok/s` when the rate could not be timed. */
export const fmtSpeed = (s: Speed): string => `ttft ${(s.ttftMs / 1000).toFixed(1)}s · ${s.tokPerS !== null ? Math.round(s.tokPerS) : '—'} tok/s`

/** Time left until a window resets, its two largest units: `25m`, `3h10m`, `4d2h`; empty when unknown or past. */
export const fmtResetIn = (resetsAt: number | null, now: number): string => {
  if (resetsAt === null || resetsAt === undefined || !(resetsAt > now)) return ''
  const m = Math.max(1, Math.floor((resetsAt - now) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${pad2(m % 60)}m` : `${m}m`
}

/** A rate-limit window's short name: `five_hour` is `5h`, `seven_day_opus` is `7d opus`. */
export const limitLabel = (kind: string): string =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

/** A gauge of `width` cells: `on` is the filled run of ▰, `off` the empty run of ▱. */
export const gauge = (pct: number, width: number): { on: string; off: string } => {
  const w = Math.max(0, Math.floor(width))
  const full = Number.isFinite(pct) ? Math.max(0, Math.min(w, Math.round((pct / 100) * w))) : 0
  return { on: '▰'.repeat(full), off: '▱'.repeat(w - full) }
}

/**
 * `s` broken at word boundaries into at most `maxRows` rows of at most `width` cells. A word longer than
 * a row is cut across rows. When words remain after the last allowed row, that row takes the words that
 * fit in `width - 1` and ends with `…`.
 */
export const wrapText = (s: string, width: number, maxRows: number): string[] => {
  const w = Math.floor(width)
  if (w <= 0 || maxRows <= 0) return []
  const words = oneLine(s).split(' ').filter(Boolean)
  const rows: string[] = []
  let i = 0
  while (i < words.length) {
    if (rows.length === maxRows - 1) {
      // The last allowed row: everything left if it fits, else the words that fit beside a closing `…`.
      const rest = words.slice(i)
      const all = rest.join(' ')
      if (points(all).length <= w) return [...rows, all]
      let take = ''
      for (const r of rest) {
        const next = take ? `${take} ${r}` : r
        if (points(next).length > w - 1) break
        take = next
      }
      return [...rows, `${take || points(rest[0] ?? '').slice(0, w - 1).join('')}…`]
    }
    const head = words[i] ?? ''
    if (points(head).length > w) {
      // A word wider than a row: this row takes its head, and the tail starts the next row.
      const chars = points(head)
      rows.push(chars.slice(0, w).join(''))
      words[i] = chars.slice(w).join('')
      continue
    }
    let line = head
    i++
    while (i < words.length && points(`${line} ${words[i] ?? ''}`).length <= w) line += ` ${words[i++]}`
    rows.push(line)
  }
  return rows
}
