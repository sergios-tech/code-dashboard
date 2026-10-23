// The host's measurements of the session: context, cost and rate limits, and compactions.
import type { On } from 'claude-code'

import type { Config } from '../config'
import { applyMeasure, markTrendCompaction, noteCompaction, refreshStatus, say, takeSample } from '../state/store'

export const wireMeasures = (on: On, cfg: Config): void => {
  on('session.measure', async ($, e, next) => {
    await applyMeasure($, e)
    if (e.changed.includes('context') || e.changed.includes('cost')) await takeSample($)
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // A vetoed compaction changed nothing, a precompute installs nothing, and a subagent's is its own.
    if (!('skip' in done && done.skip !== undefined) && !e.agentId && e.trigger !== 'precompute') {
      await noteCompaction($)
      await markTrendCompaction($)
      await say($, 'main', `context compacted (${e.trigger})`)
      await refreshStatus($, cfg)
    }
    return done
  })
}
