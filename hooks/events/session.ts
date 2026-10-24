// The session's start and end: bring stored state up to date, take a first reading, open the
// pane, and start over on `/clear`.
import type { On } from 'claude-code'

import type { Config } from '../config'
import { resetAll, takeSample, takeUsageReading, migrate } from '../state/store'
import { openPane, registerCommand } from './command'

export const wireSession = (on: On, cfg: Config): void => {
  on('session.start', async ($, e, next) => {
    await registerCommand($)
    await migrate($)
    await takeUsageReading($)
    await takeSample($)
    // Opening can wait on the host's layout; the session does not wait for it.
    if (cfg.openOnStart) void openPane($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A `/clear` keeps the process and the pane but not the conversation they described.
    if (e.reason === 'clear') await resetAll($)
    return next(e)
  })
}
