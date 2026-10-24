// The status line's words: only the fields that have something to say.
import type { Config } from '../config'
import type { Snapshot } from '../state/store'
import { hasArchitect, isAdvising } from './architect'

/**
 * `ctx 51% ↺1 · agents 2/3 · architect advising · denied 1`, or `undefined` when no field has
 * anything to say (the host then shows no status entry at all).
 */
export const statusText = (s: Pick<Snapshot, 'usage' | 'agents' | 'architect' | 'denials'>, cfg: Config): string | undefined => {
  const { usage, agents, architect, denials } = s
  const running = agents.filter(a => a.status === 'running').length
  const parts = [
    usage.pct !== null ? `ctx ${Math.round(usage.pct)}%${usage.compactions > 0 ? ` ↺${usage.compactions}` : ''}` : null,
    agents.length > 0 ? `agents ${running}/${agents.length}` : null,
    // Advising while a consult is open, else how many consults there have been.
    hasArchitect(architect) ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(architect) ? 'advising' : architect.consults.length}` : null,
    denials.count > 0 ? `denied ${denials.count}` : null,
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
