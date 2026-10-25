// The host's measurements of the session: context, cost and rate limits, and compactions.
import type { On } from 'claude-code'

import { applyMeasure, noteCompaction, say } from '../state/store'

export const wireMeasures = (on: On): void => {
  on('session.measure', async ($, e, next) => {
    await applyMeasure($, e)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // A vetoed compaction changed nothing, a precompute installs nothing, and a subagent's is its own.
    if (!('skip' in done && done.skip !== undefined) && !e.agentId && e.trigger !== 'precompute') {
      await noteCompaction($)
      await say($, 'main', `context compacted (${e.trigger})`)
    }
    return done
  })
}
