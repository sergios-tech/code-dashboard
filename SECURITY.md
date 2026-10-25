# Security

## Reporting a vulnerability

Please report a vulnerability privately through a GitHub security advisory:
[Report a vulnerability](https://github.com/sergios-tech/code-dashboard/security/advisories/new)
on `sergios-tech/code-dashboard`.

Please don't open a public issue for a vulnerability. In the report, include:

- the plugin version and the host version
- what you did, step by step
- what leaked or what changed, and where you saw it: the pane or the stored state

## Supported versions

Fixes go into the latest release, which is currently 0.1.x.

## What the plugin can see

st-code only watches the session. Its hooks receive the following:

- Every tool call's name and input, whether it failed and how long it took, plus the permission
  verdict for each call.
- Subagent spawns, their model requests, their token usage and their final answers.
- The opening text of each main-loop turn (your prompt) and the permission mode.
- The main loop's replies, read only for server-side advisor calls.
- Context, cost and rate-limit readings, and compactions.

Every hook passes its event on unchanged. The plugin never denies, rewrites or blocks a tool call, a
prompt or a subagent. It makes no network requests, runs no processes, reads and writes no files and
calls no model.

## What it keeps

The plugin keeps short summaries in session state, held by the host for the current session:

- tool calls as a name plus a command, a path cut to its last two segments, a pattern, a URL or a
  description
- prompts' first 70 characters
- agent tasks and the start of their answers
- the first line of architect advice
- counts and timings

It **stores nothing across sessions**: it uses no persistent store and writes no files. `/clear` and
`/st-code reset` empty most of the session state.

Each stored list has a cap: 24 agents, 60 other loops, 60 log lines, 40 consults, 40 tools and 200
files.

Before anything is stored, credentials are masked as `•••`. That covers:

- authorization headers and bearer tokens
- vendor-style keys (`sk-`, `pk-`, `rk-`, `ghp_`, `gho_`, `ghs_`, `github_pat_`, `xox…-`)
- `api_key`, `token`, `secret` and `password` assignments
- `--token`, `--password`, `--api-key` and `--secret` flags
- upper-case `…KEY=`, `…TOKEN=`, `…SECRET=` and `…PASSWORD=` variables
- passwords in URLs

Masking works by matching patterns, so a credential in an unusual format can get past it.

Two more things to keep in mind:

- The host lets any plugin loaded in the same session read another plugin's state.
- The pane shows prompts, task descriptions and file names on screen, so take care when you share
  your screen or record a session.

## In scope

- A credential that survives masking into stored state, the pane or the log.
- Any way the plugin changes, denies or blocks an event.
- Any network, process or file access by the plugin.
- Stored state that grows without bound.

Problems in the host application itself belong with that application's maintainers.
