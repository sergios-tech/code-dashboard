// The on-call architect. A consult opens when an architect agent is spawned (agents.ts) or a
// server-side advisor tool shows in the main loop's replies, and closes when that agent's run ends
// (turns.ts) or the tool's result arrives. Its advice comes from the run's answer, from the agent's
// hand-back tool call, or from the hand-back turn it opens in the main loop (turns.ts).
import type { ApiContentBlock, EngineInterface, On } from 'claude-code'

import type { Config } from '../config'
import { adviceLine } from '../domain/architect'
import { addArchitectId, closeConsult, isArchitectId, markSeen, openConsult, readArchitect, say, storeAdvice } from '../state/store'

/** The log's name for the architect: its label, as a source column reads. */
const whoOf = (cfg: Config): string => cfg.architectLabel.toLowerCase()

/** An agent type as a consult names it: `fable-advisor:fable-advisor` is `fable-advisor`. */
const viaOf = (type: string): string => type.split(':').pop() || 'agent'

/** A consult opened: logged at the moment it is inferred at, or plainly with the moments switched off. */
async function beginConsult($: EngineInterface, cfg: Config, id: string, via: string): Promise<void> {
  const moment = await openConsult($, id, via)
  if (moment === null) return
  await say($, whoOf(cfg), cfg.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
}

/**
 * The consult `id` (else the latest open one) ended with `report`, its advice its first line. One
 * already closed is left as it is, and so is advice the log already has.
 */
export async function finishConsult($: EngineInterface, cfg: Config, report: string | null, id?: string): Promise<void> {
  const a = await readArchitect($)
  const isOpen = a.consults.some(c => c.endAt === null && (id === undefined || c.id === id))
  const advice = report ? adviceLine(report) : ''
  const isNew = advice !== '' && advice !== a.lastAdvice
  if (!isOpen && !isNew) return
  await closeConsult($, advice || null, id)
  await say($, whoOf(cfg), isNew ? `advice: ${advice}` : 'advice returned', 'consult')
}

/** A spawned architect agent: followed as a consult under its id, never as a card or a loop. */
export async function architectSpawned($: EngineInterface, cfg: Config, id: string, type: string): Promise<void> {
  await addArchitectId($, id)
  await beginConsult($, cfg, id, viaOf(type))
}

/**
 * A report handed back by agent `from`: when it is an architect's, its first line is the advice
 * (logged once however many ways it arrives). False when `from` is no architect.
 */
export async function handedBack($: EngineInterface, cfg: Config, from: string, report: string): Promise<boolean> {
  if (!(await isArchitectId($, from))) return false
  const advice = adviceLine(report)
  if (await storeAdvice($, advice)) await say($, whoOf(cfg), `advice: ${advice}`, 'consult')
  return true
}

const isAdvisorUse = (cfg: Config, b: ApiContentBlock): b is ApiContentBlock & { id: string; name: string } =>
  b.type === 'server_tool_use' && typeof b.id === 'string' && b.id !== '' && typeof b.name === 'string' && cfg.architect.test(b.name)

const isServerResult = (b: ApiContentBlock): b is ApiContentBlock & { tool_use_id: string } =>
  typeof b.type === 'string' && b.type.endsWith('_tool_result') && typeof b.tool_use_id === 'string'

/** One row of the model's reply, in order: an advisor call opens a consult, and its result, here or in a later row, closes it. */
async function readServerTools($: EngineInterface, cfg: Config, content: readonly ApiContentBlock[]): Promise<void> {
  for (const b of content) {
    if (isAdvisorUse(cfg, b)) {
      if (await markSeen($, b.id)) await beginConsult($, cfg, b.id, `${b.name} tool`)
    } else if (isServerResult(b)) {
      await finishConsult($, cfg, null, b.tool_use_id)
    }
  }
}

export const wireArchitect = (on: On, cfg: Config): void => {
  // A server-side advisor never reaches tool.call: it shows only as blocks of the main loop's replies.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant' && Array.isArray(e.message.content)) await readServerTools($, cfg, e.message.content)
    return next(e)
  })

  // A background agent hands its report back through this tool. No built-in list names it, so it is
  // matched by pattern, and every other call passes this hook by.
  on('tool.call', { tool: /^SubagentHandback$/ }, async ($, e, next) => {
    const ran = await next(e)
    const message = (e as { message?: unknown }).message
    if (ran.deny === undefined && e.agentId && typeof message === 'string') await handedBack($, cfg, e.agentId, message)
    return ran
  })
}
