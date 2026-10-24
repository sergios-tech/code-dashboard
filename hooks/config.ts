// The plugin's `/config` values, read leniently: anything malformed falls back to its default.
import type { Layout } from '../types'

export type Panel = 'info' | 'trends' | 'agents' | 'architect' | 'tools' | 'log'

export const PANELS: readonly Panel[] = ['info', 'trends', 'agents', 'architect', 'tools', 'log']

export type Config = {
  architect: RegExp
  matchDescriptions: boolean
  architectLabel: string
  panels: Panel[]
  layout: Layout
  motion: boolean
  moments: boolean
  openOnStart: boolean
  statusLine: boolean
}

const DEFAULT_PATTERN = 'advisor|architect'

// A pattern that does not compile must not take the plugin down: fall back to the default one.
const safeRegExp = (source: string): RegExp => {
  try {
    return new RegExp(source, 'i')
  } catch {
    return new RegExp(DEFAULT_PATTERN, 'i')
  }
}

const TRUE_WORDS = ['true', 'on', 'yes']
const FALSE_WORDS = ['false', 'off', 'no']

export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const text = (k: string, d: string): string => {
    const v = o[k]
    return typeof v === 'string' && v.trim() !== '' ? v : d
  }
  // The settings screen may hand a switch over as a boolean or as a word.
  const flag = (k: string, d: boolean): boolean => {
    const v = o[k]
    if (typeof v === 'boolean') return v
    if (typeof v !== 'string') return d
    const w = v.trim().toLowerCase()
    return TRUE_WORDS.includes(w) ? true : FALSE_WORDS.includes(w) ? false : d
  }
  const listed = o.panels
  const names = (Array.isArray(listed) ? listed : typeof listed === 'string' ? listed.split(',') : [])
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter((p): p is Panel => (PANELS as readonly string[]).includes(p))
  const layout = text('layout', 'auto').trim().toLowerCase()
  return {
    architect: safeRegExp(text('architectPattern', DEFAULT_PATTERN)),
    matchDescriptions: flag('matchDescriptions', false),
    architectLabel: text('architectLabel', 'ARCHITECT'),
    panels: names.length > 0 ? [...new Set(names)] : [...PANELS],
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    motion: flag('motion', true),
    moments: flag('moments', true),
    openOnStart: flag('openOnStart', true),
    statusLine: flag('statusLine', true),
  }
}
