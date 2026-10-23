// A turn's start: what opened it goes into the log. Turn timing and cost join this module later.
import type { On } from 'claude-code'

import type { Config } from '../config'
import { promptLine } from '../domain/log'
import { say } from '../state/store'

export const wireTurns = (on: On, _cfg: Config): void => {
  on('turn.start', async ($, e, next) => {
    // A subagent's first prompt is the spawn's, which the agent log lines will cover.
    if (!e.agentId && typeof e.text === 'string' && e.text.trim() !== '') {
      const p = promptLine(e.text)
      await say($, p.who, p.text)
    }
    return next(e)
  })
}
