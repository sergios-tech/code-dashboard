// The status line's words: only the fields that have something to say.
import type { Config } from '../config'
import type { Snapshot } from '../state/store'

/**
 * `ctx 51% · agents 2/3 · architect advising · denied 1`, or `undefined` when no field has
 * anything to say (the host then shows no status entry at all).
 */
export const statusText = (s: Pick<Snapshot, 'usage' | 'agents' | 'architect' | 'denials'>, cfg: Config): string | undefined => {
  const { usage, agents, architect, denials } = s
  const running = agents.filter(a => a.status === 'running').length
  const hasArchitect = architect.consults.length > 0 || architect.ids.length > 0
  const isAdvising = architect.consults.some(c => c.endAt === null)
  const parts = [
    usage.pct !== null ? `ctx ${Math.round(usage.pct)}%` : null,
    agents.length > 0 ? `agents ${running}/${agents.length}` : null,
    hasArchitect ? `${cfg.architectLabel.toLowerCase()} ${isAdvising ? 'advising' : architect.consults.length}` : null,
    denials.count > 0 ? `denied ${denials.count}` : null,
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
