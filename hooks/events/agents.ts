// Subagents as they start: which offered agent types are the architect's, a consult for an
// architect's spawn and a card for every other. Their steps and ends are followed in turns.ts,
// beside the main loop's.
import type { AgentSpawnInput, EngineInterface, On } from 'claude-code'

import type { Config } from '../config'
import { newCard, whoOf } from '../domain/agents'
import { addAgent, isOfferedArchitect, noteArchitectType, say } from '../state/store'
import { architectSpawned } from './architect'

/**
 * Whether a spawn is the on-call architect, which is followed as a consult instead of as a card:
 * its type matches the architect pattern, or was remembered from the agent listing as matching.
 */
async function isArchitectSpawn($: EngineInterface, cfg: Config, e: AgentSpawnInput): Promise<boolean> {
  return cfg.architect.test(e.subagentType) || (await isOfferedArchitect($, e.subagentType))
}

export const wireAgents = (on: On, cfg: Config): void => {
  // The agent listing names each type the model may call; architect types are remembered by name.
  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) await noteArchitectType($, e.agent)
    return offered
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    // A refused spawn started nothing, and one without an id has no loop to follow.
    if (started.deny !== undefined || !started.agentId) return started
    // A workflow script's agents belong to its run: they show among the other loops as they step.
    if (e.workflow !== undefined) return started
    if (await isArchitectSpawn($, cfg, e)) {
      await architectSpawned($, cfg, started.agentId, e.subagentType)
      return started
    }
    const card = newCard({ id: started.agentId, type: e.name ?? e.subagentType, model: started.model, description: e.description, at: await $.clock.now() })
    await addAgent($, card)
    await say($, whoOf(card), `spawned · ${card.type}`, 'info', card.id)
    return started
  })
}
