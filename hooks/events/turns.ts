// The main loop's turn: what opens it goes into the log, its requests are timed as they stream,
// and its end leaves a receipt. A subagent's own turns are the agents' module's to follow.
import type { On } from 'claude-code'

import type { Config } from '../config'
import { promptLine } from '../domain/log'
import { stepSpeed } from '../domain/vitals'
import { beginRequest, beginTurn, endTurn, noteMode, refreshStatus, say, storeSpeed } from '../state/store'

export const wireTurns = (on: On, cfg: Config): void => {
  // The permission mode rides on the person's prompt; read it and pass the event on.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's first prompt is the spawn's, which the agent log lines will cover.
    if (!e.agentId) {
      await beginTurn($)
      if (typeof e.text === 'string' && e.text.trim() !== '') {
        const p = promptLine(e.text)
        await say($, p.who, p.text)
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    // The main loop's model and effort are known when its request starts, so a long first request does not read `—`.
    await beginRequest($, e.model, e.effort)
    // Time the response as it passes: the first piece that is not the engine's envelope, then the
    // stop chunk. Two clock reads in the stream, and nothing stored until it has ended.
    const sentAt = await $.clock.now()
    let firstAt: number | null = null
    let stopAt: number | null = null
    const s = next(e)
    for await (const c of s) {
      if (c.kind === 'stop') stopAt = await $.clock.now()
      else if (firstAt === null && c.kind !== 'engine') firstAt = await $.clock.now()
      yield c
    }
    const result = await s.result
    const speed = result.usage && stopAt !== null ? stepSpeed(sentAt, firstAt, stopAt, result.usage.output_tokens) : null
    if (speed) await storeSpeed($, speed)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      await endTurn($, { durationMs: e.durationMs, reason: e.reason })
      await refreshStatus($, cfg)
    }
    return done
  })
}
