// Composition only: each concern wires its own hooks.
import type { Register } from 'claude-code'

import { parseConfig } from './config'
import { wireCommand } from './events/command'
import { wireMeasures } from './events/measures'
import { wireRender } from './events/render'
import { wireSession } from './events/session'
import { wireTurns } from './events/turns'

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  wireSession(on, cfg)
  wireCommand(on, cfg)
  wireTurns(on, cfg)
  wireMeasures(on, cfg)
  wireRender(on, cfg)
}
