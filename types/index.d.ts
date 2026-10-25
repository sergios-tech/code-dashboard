export type Moment = 'before a plan' | 'error repeats' | 'before done'
export type Layout = 'auto' | 'compact' | 'wide' | 'mini'
export type Speed = { ttftMs: number; tokPerS: number | null }
export type Main = { model: string; effort: string; mode: string; steps: number; isRunning: boolean; speed: Speed | null }
export type Limit = { kind: string; pct: number; resetsAt: number | null }
export type Usage = { pct: number | null; tokens: number | null; window: number; costUsd: number | null; limits: Limit[]; compactions: number; lastCompactAt: number | null }
export type Turn = { edits: number; errorStreak: number }
export type ToolNote = { tool: string; text: string; isError: boolean }
export type AgentStatus = 'running' | 'done' | 'stopped' | 'failed'
export type AgentCard = { id: string; type: string; model: string; description: string; status: AgentStatus; spawnedAt: number; endedAt: number | null; ctx: number; out: number; steps: number; lastStop: string | null; tools: ToolNote[]; answer: string }
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }
export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }
export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }
export type ToolRow = { tool: string; calls: number; errors: number; timedCalls: number; timedMs: number }
export type FileRow = { path: string; reads: number; edits: number; byMain: boolean; lastAt: number }
export type Activity = { tools: ToolRow[]; files: FileRow[]; calls: number }
export type LogKind = 'info' | 'error' | 'consult' | 'done'
export type LogMark = '✗' | '· denied'
export type LogLine = { at: number; who: string; text: string; agentId: string | null; kind: LogKind; mark: LogMark | null }
export type View = { expanded: string | null; layout: Layout | null }
export type Roster = { architectTypes: string[] }

declare module 'claude-code' {
  interface PluginState {
    'st-code': {
      meta: { schemaVersion: number }
      main: Main; usage: Usage; turn: Turn
      agents: AgentCard[]; loops: Loop[]; architect: Architect
      activity: Activity
      log: LogLine[]; view: View; roster: Roster
    }
  }
}
