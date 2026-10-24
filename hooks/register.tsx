// Composition only: each concern wires its own hooks.
import type { Register } from 'claude-code'

import { parseConfig } from './config'
import { wireAgents } from './events/agents'
import { wireArchitect } from './events/architect'
import { wireCommand } from './events/command'
import { wireMeasures } from './events/measures'
import { wireRender } from './events/render'
import { wireSession } from './events/session'
import { wireTools } from './events/tools'
import { wireTurns } from './events/turns'

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  wireSession(on, cfg)
  wireCommand(on)
  wireTurns(on, cfg)
  wireAgents(on, cfg)
  wireArchitect(on, cfg)
  wireTools(on)
  wireMeasures(on)
  wireRender(on, cfg)
}
