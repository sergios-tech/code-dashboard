// Turns in every loop. The main loop's opening text goes into the log (or, for an architect's
// hand-back, its advice), its requests are timed as they stream, and its end leaves a receipt. A
// subagent's requests fill its card (or count among the other loops when no card claims it and it
// is not the architect's), and its end settles the card, or the architect's consult, and is logged.
import type { On } from 'claude-code'

import type { Config } from '../config'
import { whoOf } from '../domain/agents'
import { handbackOf } from '../domain/architect'
import { promptLine } from '../domain/log'
import { stepSpeed } from '../domain/vitals'
import { fmtDuration } from '../format/text'
import { beginRequest, beginTurn, endTurn, finishAgent, isArchitectId, noteAgentStep, noteMode, refreshStatus, say, storeSpeed } from '../state/store'
import { finishConsult, handedBack } from './architect'

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
        // A background architect's report reaches the main loop as the text opening this turn. Its
        // hand-back tool call normally carries the advice first; this is the fallback.
        const back = handbackOf(e.text)
        if (!back || !(await handedBack($, cfg, back.from, back.body))) {
          const p = promptLine(e.text)
          await say($, p.who, p.text)
        }
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const id = e.agentId
      const result = yield* next(e)
      // The model that answered, as the API reports it, else the one the request named. An
      // architect's requests belong to its consult: they make neither a card nor a loop.
      const card = await noteAgentStep($, id, { model: result.usage?.model || e.model, usage: result.usage, stopReason: result.stopReason })
      if (card && result.stopReason === 'max_tokens') await say($, whoOf(card), 'hit max_tokens', 'error', id)
      return result
    }
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
      return done
    }
    const id = e.agentId
    // The architect's run ending closes its consult, and its answer is the advice.
    if (await isArchitectId($, id)) {
      await finishConsult($, cfg, e.answer, id)
      return done
    }
    const card = await finishAgent($, id, e.reason, e.answer)
    if (card) {
      const took = card.spawnedAt > 0 && card.endedAt !== null ? ` · ${fmtDuration(card.endedAt - card.spawnedAt)}` : ''
      if (card.status === 'done') await say($, whoOf(card), `done${took}`, 'done', id)
      else await say($, whoOf(card), card.status, card.status === 'failed' ? 'error' : 'info', id)
      await refreshStatus($, cfg)
    }
    return done
  })
}
