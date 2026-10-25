// Tool calls in every loop: counted per tool and per file for TOOLS & FILES, timed when nothing but
// the tool ran inside them, added to the turn's tally and to the calling subagent's card, and
// logged when they edit, fail or are refused. A call's permission check runs inside the call, so
// the check only marks the call it belongs to; the call records everything, once.
import type { On } from 'claude-code'

import { timedMs } from '../domain/activity'
import { whoOf } from '../domain/agents'
import { EDIT_TOOLS } from '../domain/turn'
import { describeInput } from '../format/redact'
import { noteAgentTool, noteTurnCall, recordTool, say } from '../state/store'

/** What a call's check said about it: it waited on an approval prompt, or it was refused. */
type Pending = { isAsked: boolean; isDenied: boolean }

export const wireTools = (on: On): void => {
  // The calls under way, by id. A refusal at the check reaches the call as an error result rather
  // than a deny, so the check's verdict is the only way to tell it from a tool that failed.
  const pending = new Map<string, Pending>()

  on('tool.check', async (_$, e, next) => {
    const verdict = await next(e)
    const p = e.tool_use_id !== undefined ? pending.get(e.tool_use_id) : undefined
    if (p && verdict.decision === 'ask') p.isAsked = true
    if (p && verdict.decision === 'deny') p.isDenied = true
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    // A hand-back is architect.ts's to read, and is no tool work.
    if (String(e.tool) === 'SubagentHandback') return next(e)
    const id = e.tool_use_id
    const p: Pending = { isAsked: false, isDenied: false }
    pending.set(id, p)
    const sentAt = await $.clock.now()
    const ran = await next(e).finally(() => pending.delete(id))
    const at = await $.clock.now()
    const isDenied = p.isDenied || ran.deny !== undefined
    const didRun = !isDenied
    const hasFailed = didRun && ran.isError === true
    const inSubagent = Boolean(e.agentId)
    await recordTool($, { tool: e.tool, input: e, hasFailed, inSubagent, didRun, ms: timedMs(didRun, p.isAsked, e.tool, at - sentAt), at })
    // An answered Agent call is its subagent's to report: the card, its turns and its end.
    if (e.tool === 'Agent' && !isDenied) return ran

    const isEdit = didRun && !hasFailed && EDIT_TOOLS.has(e.tool)
    await noteTurnCall($, { inSubagent, hasFailed, isEdit })
    // A call as the log and the cards name it, `Edit → src/main.ts`; each keeps as much as it holds.
    const text = describeInput(e.tool, e)
    const card = e.agentId ? await noteAgentTool($, e.agentId, { tool: e.tool, text, isError: hasFailed || isDenied }) : null
    const who = card ? whoOf(card) : e.agentId ? 'agent' : 'main'
    const agentId = e.agentId ?? null
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    // The marker is stored apart from the text, so a narrow pane cuts the command and keeps it.
    if (isDenied) {
      await say($, who, text, 'error', agentId, '· denied')
    } else if (hasFailed) {
      await say($, who, text, 'error', agentId, '✗')
    } else if (isEdit) {
      await say($, who, text, 'info', agentId)
    }
    return ran
  })
}
