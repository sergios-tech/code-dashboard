// One atom per key of PluginState['st-code'], each starting at its default. The plugin and key are
// literals on purpose: the host scans them to list the values this plugin reads and writes.
import { atom } from 'claude-code'

import {
  DEFAULT_ACTIVITY,
  DEFAULT_ARCHITECT,
  DEFAULT_DENIALS,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TRENDS,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  SCHEMA_VERSION,
} from './schema'

export const PLUGIN = 'st-code'
export const PANE_ID = 'st-code'

export const meta = atom({ plugin: 'st-code', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
export const main = atom({ plugin: 'st-code', key: 'main' } as const, DEFAULT_MAIN)
export const usage = atom({ plugin: 'st-code', key: 'usage' } as const, DEFAULT_USAGE)
export const turn = atom({ plugin: 'st-code', key: 'turn' } as const, DEFAULT_TURN)
export const receipt = atom({ plugin: 'st-code', key: 'receipt' } as const, null)
export const agents = atom({ plugin: 'st-code', key: 'agents' } as const, [])
export const loops = atom({ plugin: 'st-code', key: 'loops' } as const, [])
export const architect = atom({ plugin: 'st-code', key: 'architect' } as const, DEFAULT_ARCHITECT)
export const activity = atom({ plugin: 'st-code', key: 'activity' } as const, DEFAULT_ACTIVITY)
export const trends = atom({ plugin: 'st-code', key: 'trends' } as const, DEFAULT_TRENDS)
export const denials = atom({ plugin: 'st-code', key: 'denials' } as const, DEFAULT_DENIALS)
export const log = atom({ plugin: 'st-code', key: 'log' } as const, [])
export const view = atom({ plugin: 'st-code', key: 'view' } as const, DEFAULT_VIEW)
export const roster = atom({ plugin: 'st-code', key: 'roster' } as const, DEFAULT_ROSTER)
