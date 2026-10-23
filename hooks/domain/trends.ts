// The trend lines: context fill and cost over the session, kept as a bounded list of samples that
// is thinned rather than truncated, so the lines always span the whole session. Pure.
import type { Sample, Trends } from '../../types'

/** Samples kept; past this the list is thinned. */
export const SAMPLES_MAX = 60

/**
 * One reading added. It carries the compaction flag set since the last one, and clears it. Past
 * SAMPLES_MAX the list is thinned, except its first sample: pairing that one with a later one over
 * and over would move the line's start to the end of the session.
 */
export const addSample = (t: Trends, s: { at: number; ctxPct: number | null; costUsd: number | null }): Trends => {
  const samples = [...t.samples, { ...s, isCompaction: t.pendingCompaction }]
  const [first, ...rest] = samples
  return { samples: first && samples.length > SAMPLES_MAX ? [first, ...thin(rest)] : samples, pendingCompaction: false }
}

/** A compaction happened: the next reading is the one that shows it. */
export const markCompaction = (t: Trends): Trends => ({ ...t, pendingCompaction: true })

/**
 * Half the samples: neighbours (0+1, 2+3, …) pair into one with the later one's reading and a
 * compaction mark if either had one. An odd last sample stays as it is.
 */
export const thin = (samples: Sample[]): Sample[] => {
  const out: Sample[] = []
  for (let i = 0; i < samples.length; i += 2) {
    const a = samples[i]
    const b = samples[i + 1]
    if (a && b) out.push({ ...b, isCompaction: a.isCompaction || b.isCompaction })
    else if (a) out.push(a)
  }
  return out
}

/**
 * The cells of a sparkline `width` wide that hold a compaction, as `sparkline` places the samples:
 * resampled onto the cells when there are more samples than cells, else right-aligned.
 */
export const compactionCells = (samples: Sample[], width: number): number[] => {
  const w = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0))
  const cells = new Set<number>()
  samples.forEach((s, j) => {
    if (s.isCompaction && w > 0) cells.add(samples.length > w ? Math.floor((j * w) / samples.length) : w - samples.length + j)
  })
  return [...cells].sort((a, b) => a - b)
}
