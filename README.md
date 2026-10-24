# Sergio's Tech · Code

[![Release](https://img.shields.io/github/v/release/sergios-tech/sergio-tech-code-dashboard)](https://github.com/sergios-tech/sergio-tech-code-dashboard/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.300+ plugin](https://img.shields.io/badge/Claude%20Code-2.1.300%2B%20plugin-8a0000.svg)](#install)

**A live, read-only session dashboard for Claude Code.** It opens a pane beside the transcript that
shows what the session is doing right now: the main model's vitals, the running turn, subagents at
work, architect consults, the busiest tools and files, how context and cost trend, and a session
log. Every number comes from a real session event, anything inferred says so, and nothing leaves
your machine.

<p align="center">
  <img src="docs/media/demo.gif" alt="The st-code pane, docked at 66 columns, through a real three-subagent run: the turn starts, three agent cards go from starting to running to done, TOOLS &amp; FILES counts the calls and edited files, and the log fills with spawns, writes, failed calls in red and completions" width="528">
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#what-you-see">What you see</a> · <a href="#use">Use</a> · <a href="#where-it-runs">Where it runs</a> · <a href="#what-it-can-reach">What it can reach</a> · <a href="#configure">Configure</a> · <a href="#troubleshooting">Troubleshooting</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

## Install

Inside Claude Code 2.1.300 or later:

```
/plugin marketplace add sergios-tech/sergio-tech-code-dashboard
/plugin install st-code@sergios-tech
/reload-plugins
/st-code
```

From a terminal:

```sh
claude plugin marketplace add sergios-tech/sergio-tech-code-dashboard
claude plugin install st-code@sergios-tech
```

Or load it from a clone for one session:

```sh
git clone https://github.com/sergios-tech/sergio-tech-code-dashboard
claude --plugin-dir ./sergio-tech-code-dashboard
```

If the installer lists options as unset, the defaults apply. You can change them in
[`/config`](#configure).

The hooks API this plugin is built on is an early-access part of Claude Code and can change between
releases. If something breaks after an update, see [Troubleshooting](#troubleshooting).

## What you see

<p align="center">
  <img src="docs/media/docked-session.png" alt="A fullscreen session 160 columns wide: on the left, the transcript reports three finished subagents and a passing test run; on the right, the docked st-code pane shows the crimson SERGIO'S TECH · CODE header over VITALS, TRENDS, TURN, AGENTS with three done cards, TOOLS &amp; FILES and LOG in one column; below the prompt, the status line reads st-code: ctx 5% · agents 0/3" width="820">
</p>

| Two columns, in a 120-column dock | One column, in the default 66-column dock |
| --- | --- |
| <img src="docs/media/docked-wide.png" alt="The wide layout: VITALS, TRENDS and TOOLS &amp; FILES on the left; TURN and AGENTS on the right, where three subagents share one time axis as lanes, one still running; the LOG full width underneath, listing edits to tally/parser.py, tally/cli.py and tally/utils.py" width="480"> | <img src="docs/media/compact.png" alt="The compact layout close up: VITALS, TRENDS, TURN, AGENTS with three done cards, TOOLS &amp; FILES and LOG stacked in one column under the crimson header" width="300"> |

<p align="center">
  <img src="docs/media/inline-mini.png" alt="A 100-column session with the summary inline above the prompt, in five rows: the model, its state, a context gauge and the session cost; a context sparkline; two running subagents with their ctx and clocks; and the last turn" width="620">
</p>

The crimson header bar reads `SERGIO'S TECH · CODE` on the left and the main model's state on the
right, for example `● OPUS 5.5 WORKING` or `○ OPUS 5.5 IDLE`. Once an architect has been seen,
`· ARCHITECT ADVISING` or `· ARCHITECT ON CALL` joins it. The dot pulses while a turn or a subagent
is running.

Panels with nothing to show take no room, so a fresh session shows the header, VITALS and LOG.

| Panel | Shows | From |
| --- | --- | --- |
| **VITALS** | Effort gauge (`effort ▮▮▮▯ high`), permission mode and request count. A context gauge with tokens/window and compactions (`⟲1`). Session cost and the first two rate-limit windows, each with its reset countdown (`↻3h10m`) when the frame is 56 columns or wider. The last main-loop request's `ttft` and `tok/s`. Each row appears once its data exists. | `turn.step`, `classic.UserPromptSubmit`, `session.measure`, `session.compact`, `$.session.usage()` |
| **TURN** | While a turn runs: `◐ turn`, a live clock, and the edit and error counts when the frame is 56 columns or wider. During an architect review it adds `reviewing before done (inferred)`. After the turn: `✓` or `✗` with duration, agents spawned, edits, errors and the cost added, when that is $0.005 or more. The frame turns blue while a turn runs. | `turn.start`, `tool.call`, `turn.complete`, `$.session.usage()` |
| **AGENTS** | `AGENTS running/total`. Cards sit side by side while they fit (`maxCards`, each at least 20 columns). Each card shows the task, the type, the model when it differs from the main one, `ctx`, `out`, steps, a status glyph and a ticking clock. `max_tokens` shows in red. Past that limit, each agent gets a lane on one shared time axis, the newest six shown under `+N earlier`. | `agent.spawn`, `turn.step`, `tool.call`, `turn.complete` |
| **LOOPS** | Model loops that no card claims (workflow agents, compactions, forks), shown as `LOOPS 3 seen · 1 active` with one dot each: `●` active, `✓` done, `○` idle. | `turn.step` and `turn.complete` of loops without a card |
| **ARCHITECT** | `● advising` or `○ on call`. Consults on a one-row timeline (`◆` where one started, `━` while it ran). When the last one ran and how long it took. The inferred moment of the last consult. A `»` line with the first line of the advice. | `agent.offer`, `agent.spawn` of a matching type, matching server tools in `session.append`, `turn.complete`, the `SubagentHandback` call or hand-back turn |
| **TOOLS & FILES** | The busiest tools (4 rows, 6 in two columns), each with calls, errors (`✗3`) and the average time per call (`avg* 0.4s`). Under `hot files`, the 5 paths touched most, each with reads and edits (`✎2`). Paths show their last two segments, and a file that only subagents touched is dimmed. | `tool.call`, `tool.check` |
| **TRENDS** | Context fill and cumulative cost as two sparklines across the session, with a `⟲` where a compaction landed. The current percentage and total sit at the right end, followed by the last turn's cost (`+$0.41`). Appears from the second reading; when the host reports no cost, only the ctx line shows. | `session.measure` readings that change context or cost, the start-of-session reading, `session.compact` |
| **LOG** | Prompts (first 70 characters), spawns, completions, consults and advice, edits, errors, denials, compactions and `max_tokens` hits. Each line has an `HH:MM:SS` time and a colour-coded source. It takes 4 to 8 rows, whatever the other panels leave. | all of the above |
| **Status line** | `ctx 51% · agents 2/3 · architect advising · denied 1`. Each field appears only when it has something to say. With no consult open, the architect field shows the consult count. | the same state |

A **denial** is a call refused by a permission rule or hook. It writes one red log line
(`Bash → rm · denied`) and adds to `denied N` in the status line. Declining an approval prompt
is not a denial: that call counts as a failed call (`✗`) in TOOLS & FILES and the log.

## Use

| Command | Does |
| --- | --- |
| `/st-code` (or `/st-code open`) | Opens the pane. |
| `/st-code close` | Closes it. |
| `/st-code reset` | Clears the turn and its receipt, agents, loops, consults, tools and files, the denial count, the log and any `/st-code layout` choice. The model, permission mode, session cost, rate limits, compaction count and trend lines stay. The context gauge returns with the next reading. |
| `/st-code layout auto\|compact\|wide\|mini` | Picks the layout for this session, overriding the `layout` option. |

`/clear` resets the pane the same way as `/st-code reset`.

Focus the pane with `ctrl+x tab`, then:

| Key | Does |
| --- | --- |
| `1` to `6` | Opens an agent card or lane: the full task, its type, model, status and steps, its last 3 tool calls and the start of its answer. Press the key again to close it. |

While you view a subagent's transcript, its card or lane is marked `▶` and the log shows only that
agent's lines (`LOG · THIS AGENT`).

## Where it runs

- **Fullscreen terminal, 110 columns or wider:** the pane docks beside the transcript. The dock opens
  66 columns wide, which draws one column.
- **Main screen, or a terminal under 110 columns:** the pane sits inline above the prompt and, under
  `auto`, draws a summary of at most 8 rows. The summary holds the model line, a context sparkline,
  up to 3 agents (running ones first) with their clocks, how many more there are, the other loops
  and the last turn.
- **Desktop app and VS Code:** the same panels, plus three SVG drawings on black: the agents on a
  time axis, the two TRENDS lines and the architect timeline. The desktop app keeps the live clocks
  and the pulse. VS Code shows each clock as it stood at the last redraw, and the header dot stays
  still.

**Two columns.** Under `auto`, the wide layout starts at a dock of 110 columns. The host caps the
dock at 45% of the terminal's width and opens it at 66 columns, so you need both of these:

- A terminal at least 245 columns wide.
- A dock widened to 110 columns or more. Drag it wider; the host remembers the width you set.

`/st-code layout wide` draws two columns from a dock of 82 columns: a terminal at least 183 columns
wide, with the dock widened. Below 82 it stays in one column. `/st-code layout compact` keeps one
column at any width. `/st-code layout mini` draws the 8-row summary even when docked.
`/st-code layout auto` goes back to choosing by width.

**Opening by itself.** With `openOnStart`, the plugin opens the pane when a session starts. The host
only places a pane opened that way in a terminal at least 144 columns wide, or 110 once you have
opened the pane yourself and not closed it by hand. Below that, run `/st-code`, which opens it at any
width.

**Colours.** The palette is fixed: OLED colours on pure black, taken from the
[Sergio's Tech Code in Black](https://github.com/sergios-tech/sergio-tech-code-black-theme) theme
and made for black or dark terminals. It doesn't follow your terminal or host theme, and there's no
light variant. Every text colour reaches at least 4.5:1 contrast on black. Crimson never carries
text: it fills the header and draws the panel frames. A state never relies on colour alone: `●`
running, `✓` done, `✗` failed, `■` stopped, `⟲` compaction, and a refused call says `denied`.

## What it can reach

The plugin only watches. Every hook passes its event on unchanged: it never denies, rewrites or
blocks a tool call, a prompt or a subagent.

| It sees | Through |
| --- | --- |
| Every tool call's name and input, whether it failed, and how long it took | `tool.call` |
| Each call's permission verdict, used only to tell an approval prompt or a refusal apart | `tool.check` |
| The agent types offered to the model, used to remember which ones are the architect | `agent.offer` |
| Subagent spawns, their model requests and token usage, and their final answers | `agent.spawn`, `turn.step`, `turn.complete` |
| The main loop's requests: model, effort, timing and output tokens | `turn.step` |
| The opening text of each main-loop turn (your prompt, first 70 characters, for the log) and the permission mode | `turn.start`, `classic.UserPromptSubmit` |
| Context, cost and rate-limit readings, and compactions | `session.measure`, `session.compact`, `$.session.usage()` |
| The main loop's replies, read only for server-side advisor calls (whose content stays encrypted) | `session.append` |
| An architect agent's hand-back report | the `SubagentHandback` tool call |

What it keeps, in session state: a tool call as its name plus a command, a path cut to its last two
segments, a pattern, a URL or a description; your prompts' first 70 characters; agent tasks and the
start of their answers; the first line of the architect's advice. Credentials are masked before
anything is stored. The lists are capped: 24 agent cards, 60 other loops, 60 log lines, 40
consults, 40 tools, 200 files and 60 trend samples.

What it never does: it makes no network requests, runs no processes, reads and writes no files,
calls no model and stores nothing across sessions. `claude plugin validate .` prints every hook it
registers and every host call it makes.

## What is inferred, not measured

- **Architect moments.** "Before a plan" means nothing has been edited yet this turn. "Error repeats"
  means 2 or more main-loop errors in a row. "Before done" means edits were made this turn. The
  panel labels them `(inferred)`, and `moments: false` turns them off.
- **Server-side advice is encrypted.** When the architect is a server tool, the pane counts and times
  the consult and logs `advice returned`, but cannot show what the tool said. The `»` advice line
  comes only from an architect agent's answer or hand-back.
- **Per-agent `ctx` is the latest request's whole input** (uncached, cache read and cache write). It
  is labelled `ctx`, not cost, because there is no per-agent cost to report.
- **Other loops** can't tell a workflow agent from a compaction or a fork. All of them are model loops
  that no card claims.
- **A background agent's first step** can arrive before its card exists, so its card may count one
  step late.
- **Request speed.** `ttft` and `tok/s` are timed at st-code's own `turn.step` hook, so they include
  everything beneath it: other plugins' hooks, the engine, the network and any retry. `tok/s` divides
  the reported `output_tokens` (thinking included) by the time from the first piece of the response
  to the stop. They are measured, but they aren't the API's own figures.
- **`avg*` in TOOLS & FILES.** The clock is read before and after the rest of the tool call runs, so
  the time includes other plugins' hook time on that call. Some calls are left out of the average
  because they would time something other than the tool: calls whose permission check asked for
  approval, denied calls and `Agent` calls, which run a subagent to its end. These calls still count
  toward calls and errors.
- **Trends thinning.** Past 60 readings, the session's first reading stays and the rest pair up. Each
  pair keeps the later reading, plus a `⟲` if either had one. The lines still span the whole
  session, but a short spike between two kept readings can drop out.

## Configure

In `/config`, or under `pluginConfigs["st-code"].options` in `settings.json`. Reads are lenient: a
malformed value falls back to its default.

| Option | Default | Meaning |
| --- | --- | --- |
| `architectPattern` | `advisor\|architect` | Case-insensitive regex for architect agent types and server tools |
| `matchDescriptions` | `false` | Also match agent descriptions |
| `architectLabel` | `ARCHITECT` | Label for the architect role |
| `panels` | `vitals,trends,turn,agents,loops,architect,tools,log` | Which panels show, in order (compact layout) |
| `layout` | `auto` | `auto`, `compact`, `wide` or `mini` |
| `maxCards` | `3` | Cards before swimlanes (1–6) |
| `motion` | `on` | `on` or `off` |
| `moments` | `true` | Show the inferred consult moments |
| `openOnStart` | `true` | Open the pane at session start, in terminals ≥ 144 columns |
| `statusLine` | `true` | Status line fields |

`motion: off` stops the header pulse, but the clocks keep ticking. The wide layout puts VITALS,
TRENDS, ARCHITECT and TOOLS & FILES in the left column and TURN, AGENTS and LOOPS in the right,
with the LOG underneath. There, `panels` still hides panels and sets the order inside each column.

## Troubleshooting

**The pane doesn't appear.**
- Check that `claude --version` reports 2.1.300 or later, then run `/reload-plugins` and `/st-code`.
- When the host can't place the pane, `/st-code` replies `The dashboard is not shown yet:` followed by
  the host's reason.
- At session start the pane only opens by itself in terminals at least 144 columns wide. Run
  `/st-code` to open it at any width.
- Look in the transcript for a dim line starting `st-code:`. It names the hook that failed or the
  reason the pane was refused. Please
  [open an issue](https://github.com/sergios-tech/sergio-tech-code-dashboard/issues) and include it.

**It stays in one column.** The dock opens at 66 columns. See [Two columns](#where-it-runs).

**The colours look wrong.** The palette is fixed and made for a black background. In a terminal
limited to 256 colours, the hex values get rounded and the crimson comes out lighter. Use a terminal
with 24-bit colour (`COLORTERM=truecolor`).

**There's too much motion.** Set `motion` to `off`.

**The counters look stale after an update.** Run `/st-code reset`. Stored state is always read
leniently, and state saved under an older schema is rewritten when a session starts.

## Credits

Derived from [Flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella, under the
MIT license. Flightdeck proved the idea and the event-to-reducer approach. st-code is a rewrite with
its own panels, layouts and look. Both copyright notices are in [LICENSE](LICENSE).

Screenshots and the demo are captured from a real session with the scripts in
[`scripts/capture/`](scripts/capture/README.md). The social preview card is
[`docs/media/social-preview.png`](docs/media/social-preview.png).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Security: [SECURITY.md](SECURITY.md) · License:
[MIT](LICENSE)

---

Made by Sergio Jovanotti at [Sergio's Tech](https://www.sergios.tech).
