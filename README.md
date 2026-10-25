# Sergio's Tech · Code Display

[![Release](https://img.shields.io/github/v/release/sergios-tech/code-display)](https://github.com/sergios-tech/code-display/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.300+ plugin](https://img.shields.io/badge/Claude%20Code-2.1.300%2B%20plugin-8a0000.svg)](#install)

**A live, read-only session dashboard for Claude Code.** It opens a pane beside the transcript that
shows what the session is doing right now: the main model's INFO, subagents at work, architect
consults, the busiest tools and files, and a session log. Every number comes from a real session event, anything inferred says so, and nothing leaves
your machine.

<div align="center">

![The pane, docked at 66 columns, through a real run with three subagents and an architect: INFO switches to an orange working state, three agents appear in AGENTS with a bouncing bar while they run and a full green bar with a check once done, the header reads ARCHITECT ADVISING while the ARCHITECT panel draws the consult on its timeline, then ON CALL with the 7-second consult marked before a plan and its verdict that normalize belongs in utils.py, TOOLS & FILES counts the calls and the files each agent read and edited, and the LOG, running to the pane's bottom edge, fills with the prompt, spawns, the architect's advice, edits and completions while the spend climbs to $1.04](docs/media/demo.gif)

</div>

<p align="center">
  <a href="#install">Install</a> · <a href="#what-you-see">What you see</a> · <a href="#use">Use</a> · <a href="#where-it-runs">Where it runs</a> · <a href="#what-it-can-reach">What it can reach</a> · <a href="#configure">Configure</a> · <a href="#troubleshooting">Troubleshooting</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

## Install

Inside Claude Code 2.1.300 or later:

```
/plugin marketplace add sergios-tech/code-display
/plugin install st-code-display@sergios-tech
/reload-plugins
/st-code-display
```

From a terminal:

```sh
claude plugin marketplace add sergios-tech/code-display
claude plugin install st-code-display@sergios-tech
```

Or load it from a clone for one session:

```sh
git clone https://github.com/sergios-tech/code-display
claude --plugin-dir ./code-display
```

If the installer lists options as unset, the defaults apply. You can change them in
[`/config`](#configure).

**Upgrading from `st-code`.** The plugin was called `st-code` before it became `st-code-display`.
Remove an install of the old name with `/plugin uninstall st-code@sergios-tech` before you install
the new one, and set its options again: they, like the stored state, start fresh under the new name.

The hooks API this plugin is built on is an early-access part of Claude Code and can change between
releases. If something breaks after an update, see [Troubleshooting](#troubleshooting).

## What you see

![A fullscreen session 160 columns wide: on the left, the transcript reports three finished subagents that added docstrings and the architect's answer, lists each function's new docstring, notes that the 5 tests pass and ends with the architect's verdict that normalize belongs in utils.py; on the right, the docked pane shows the SERGIO'S TECH · CODE header with OPUS 5.5 IDLE · ARCHITECT ON CALL over INFO at $1.04 spent, AGENTS with three finished agents, ARCHITECT with one 7-second consult and its verdict, TOOLS & FILES with 17 calls, and the LOG running down to the pane's bottom edge, in one column](docs/media/docked-session.png)

| Two columns, in a 120-column dock | One column, in the default 66-column dock |
| --- | --- |
| ![The wide layout: INFO and TOOLS & FILES stacked on the left, AGENTS with three finished agents and ARCHITECT on call after one 7-second consult on the right, and the LOG across the full width underneath down to the pane's bottom edge, listing the architect's advice, the edits to tally/parser.py, tally/cli.py and tally/utils.py and the agents finishing](docs/media/docked-wide.png) | ![The compact layout close up: INFO, AGENTS with three finished agents, ARCHITECT on call with its consult on the timeline and its verdict, TOOLS & FILES and LOG stacked in one column under the header, with green gauges at 6% context and 5% and 56% of the limits, the reads and edits of each file, and the LOG reaching the pane's bottom edge](docs/media/compact.png) |

![A 100-column session with the summary inline above the prompt, in four rows: the model and its state, the effort, a context gauge, the 7-day and 5-hour limits and the session cost; then three finished subagents, each with a check, a full green bar and its clock](docs/media/inline-mini.png)

The header is one unfilled row on black. `▌SERGIO'S TECH · CODE DISPLAY` sits on the left. On the right are
the state dot and the main model in its family colour (Opus red, Sonnet orange, Haiku green, Fable
gold, any other model grey), for example `● OPUS 5.5` or `○ OPUS 5.5`. Once an architect has been
seen, `· ARCHITECT ADVISING` or `· ARCHITECT ON CALL` joins it. The dot is green and pulses while a
turn, a subagent or a workflow's agent is running, and the header carries no state word: INFO's
frame reads `● working` or `○ idle` for the main loop. A frame turns green while its panel holds
running work: INFO while the main loop works, AGENTS while an agent or a loop runs, ARCHITECT while
the architect advises. When nothing runs at all, neither a turn nor an agent nor a loop, every frame
and the `○` of the header and the `○ IDLE` of the inline summary turn dark red (`#7f0000`, a step
under the Sergio's Tech themes' `#800000`).

Panels with nothing to show take no room, so a fresh session shows the header, INFO and LOG. The
wide layout is the exception: it shows AGENTS beside INFO from the start, reading `no agents yet`.
In one column AGENTS appears with the first agent, or with the first model loop that no agent
claims, such as a workflow's agents; until an agent has a row, it reads `only loops running` while
one runs.

| Panel | Shows | From |
| --- | --- | --- |
| **INFO** | Three groups split by dividers. Model: the effort gauge (`◆ effort ▮▮▮▮ xhigh`), `mode auto` and `req 7`. Usage: a context gauge with tokens/window and compactions (`↺1`), then each of the first two rate-limit windows on its own row with its reset countdown (`↻ 3h51m`). Spend: the session cost and the last main-loop request's `ttft` and `tok/s`. The effort gauge's lit cells turn red at `xhigh` and `max`; the word stays green. The context gauge is green, orange from 30% and red from 50%. Every rate-limit window is green, orange from 80% and red from 90%, judged by the printed figure. The frame meta reads `● working` in orange while the main loop runs and `○ idle` in dim. `mode bypass` shows in coral. A group with no data is left out, and with none at all the panel reads `waiting for the first request`. | `turn.step`, `classic.UserPromptSubmit`, `session.measure`, `session.compact`, `$.session.usage()` |
| **AGENTS** | One row per agent, running agents first and the newest first among them. Each row has a status glyph, its hotkey digit and title, the model when it differs from the main one, a status bar and a clock. The bar is a 3-cell block that bounces along the track while the agent runs, and fills green, coral or grey once it is done, failed or stopped; it shows that an agent is alive, not how far along it is. A request cut at `max_tokens` shows as failed. Six rows show, hotkeys `1`–`6`, under a `+N earlier` row. The frame meta reads `N running · N total`. An opened agent shows inside the frame after a divider. The last row is `loops  2 seen · 1 active` with one dot per model loop that no agent claims (workflow agents, compactions, forks): `●` active, `✓` done, `○` idle. | `agent.spawn`, `turn.step`, `tool.call`, `turn.complete` |
| **ARCHITECT** | `● advising` or `○ on call`. Consults on a one-row timeline (`◆` where one started, `━` while it ran). How long the open consult has run (`consulting for 42s`), or when the last one ended and how long it took. The inferred moment of the last consult. A `»` line with the first line of the advice. The frame is green while it advises. | `agent.offer`, `agent.spawn` of a matching type, matching server tools in `session.append`, `turn.complete`, the `SubagentHandback` call or hand-back turn |
| **TOOLS & FILES** | A table of the busiest tools (4 rows, 6 in two columns): a glyph for the tool's family (`›` read, `✎` edit, `▸` run, `●` agent, `·` other), the name (an MCP tool as `server:tool`), calls, errors (`✗ 3`) and the average time per call under `avg*`. After a divider, the 5 paths touched most, each with reads and edits (`✎ 2`). Paths show their last two segments, and a file that only subagents touched is dimmed. | `tool.call`, `tool.check` |
| **LOG** | Prompts, spawns, completions, consults and advice, edits, errors, denials, compactions and `max_tokens` hits. Each line has a time, how long into the session it was logged (`0:42`, `12:04`, then `1:02:04` past an hour; `--:--` when unknown), right-aligned to the widest shown, an actor (`opus` for the main loop, named by its model, then `you`, an agent such as `Explore 1`, or `architect`) and its text, as much of it as the pane's width holds, with `…` where it is cut. Only the mark after the text carries a state: `✗` in coral, `· denied` in gold. Docked, it takes every row the other panels leave and pads with blank rows, so its frame ends on the pane's bottom edge. Inline it takes up to 8, and 4 to 8 when the pane's height is unknown. A pane too short for 2 hides it rather than cutting it off at the bottom edge. | all of the above |

A **denial** is a call refused by a permission rule or hook. It writes one log line that ends with a
gold `· denied` (`Bash → rm -rf build · denied`). Declining an approval prompt is not a denial: that
call counts as a failed call (`✗`) in TOOLS & FILES and the log.

## Use

| Command | Does |
| --- | --- |
| `/st-code-display` (or `/st-code-display open`) | Opens the pane. |
| `/st-code-display close` | Closes it. |
| `/st-code-display reset` | Clears agents and loops, consults, tools and files, the denial count, the log and any `/st-code-display layout` choice. The model, permission mode, session cost, rate limits and compaction count stay. The context gauge returns with the next reading. |
| `/st-code-display layout auto\|compact\|wide\|mini` | Picks the layout for this session, overriding the `layout` option. |

`/clear` resets the pane the same way as `/st-code-display reset`.

Focus the pane with `ctrl+x tab`, then:

| Key | Does |
| --- | --- |
| `1` to `6` | Opens that row's agent inside the AGENTS frame: the full task, its type, model, status and steps, its last 3 tool calls and the start of its answer. Press the key again to close it. The digits follow the drawn order, so they shift when an agent finishes. |

While you view a subagent's transcript, its row is marked `▶` and the log shows only that
agent's lines (`LOG · THIS AGENT`).

## Where it runs

- **Fullscreen terminal, 110 columns or wider:** the pane docks beside the transcript. The dock opens
  66 columns wide, which draws one column.
- **Main screen, or a terminal under 110 columns:** the pane sits inline above the prompt and, under
  `auto`, draws a summary of at most 8 rows on black, without frames. The rows are the state and a
  digest of INFO's figures, up to six agents, running ones first, and a last row for the agents left
  out and the loops. Its figures take the colours INFO's gauges use. It takes no keys, so its agent rows carry no digit.
- **Desktop app and VS Code:** the same design, drawn as pictures. Each block (the header, each panel
  or the two columns together, and the log) is one SVG laid out cell for cell as the terminal would
  show it, on black. The header pulse and the AGENTS sweep animate on both, and both show each clock
  as it stood at the last redraw. The agents' time axis stays under AGENTS. The digit keys still open
  an agent, but a picture's text can't be selected and its rows can't be clicked.

**Two columns.** Under `auto`, the wide layout starts at a dock of 110 columns. The host caps the
dock at 45% of the terminal's width and opens it at 66 columns, so you need both of these:

- A terminal at least 245 columns wide.
- A dock widened to 110 columns or more. Drag it wider; the host remembers the width you set.

`/st-code-display layout wide` draws two columns from a dock of 82 columns: a terminal at least 183 columns
wide, with the dock widened. Below 82 it stays in one column. `/st-code-display layout compact` keeps one
column at any width. `/st-code-display layout mini` draws the 8-row summary even when docked.
`/st-code-display layout auto` goes back to choosing by width.

**Opening by itself.** With `openOnStart`, the plugin opens the pane when a session starts. The host
only places a pane opened that way in a terminal at least 144 columns wide, or 110 once you have
opened the pane yourself and not closed it by hand. Below that, run `/st-code-display`, which opens it at any
width.

**Colours.** The palette is fixed: the Signal palette on a pure black fill, made for black or dark
terminals. It doesn't follow your terminal or host theme, and there's no light variant. Green is the
working colour, gauges go green to orange to red, agents are orange and frames are red, turned down
to dark red while nothing runs. Every text colour reaches at least 4.5:1 contrast on black, and so
does its 256-colour fallback, with one exception: the resting `○` of the header and the inline
summary's `○ IDLE` in dark red (1.9:1), which the `○` shape repeats. Frame lines and the empty cells
of gauges and bars never carry text. A state never relies on colour alone: `●` running, `✓` done,
`✗` failed, `■` stopped, `↺` compaction, and a refused call says `denied`.

## What it can reach

The plugin only watches. Apart from its own command and its own pane, every hook passes its event on
unchanged: it never denies, rewrites or blocks a tool call, a prompt or a subagent.
[What each hook does](#what-each-hook-does) lists them one by one.

| It sees | Through |
| --- | --- |
| Every tool call's name and input, whether it failed, and how long it took | `tool.call` |
| Each call's permission verdict, used only to tell an approval prompt or a refusal apart | `tool.check` |
| The agent types offered to the model, used to remember which ones are the architect | `agent.offer` |
| Subagent spawns, their model requests and token usage, and their final answers | `agent.spawn`, `turn.step`, `turn.complete` |
| The main loop's requests: model, effort, timing and output tokens | `turn.step` |
| The opening text of each main-loop turn (your prompt, first 400 characters, for the log) and the permission mode | `turn.start`, `classic.UserPromptSubmit` |
| Context, cost and rate-limit readings, and compactions | `session.measure`, `session.compact`, `$.session.usage()` |
| The main loop's replies, read only for server-side advisor calls (whose content stays encrypted) | `session.append` |
| An architect agent's hand-back report | the `SubagentHandback` tool call |

What it keeps, in session state: a tool call as its name plus a command, a path cut to its last two
segments, a pattern, a URL or a description; the first 400 characters of each log line, your prompts
included; agent tasks and the start of their answers; the first line of the architect's advice.
Credentials are masked before anything is stored. The lists are capped: 24 agents, 60 other loops,
60 log lines, 40 consults, 40 tools and 200 files.

What it never does: it makes no network requests, runs no processes, reads and writes no files,
calls no model and stores nothing across sessions. `claude plugin validate .` prints every hook it
registers and every host call it makes.

## What each hook does

The plugin hooks 15 events, with 16 hooks, in the order `claude plugin validate .` lists them
(`tool.call` is hooked twice). Each row says when the hook runs, what it reads, and what it keeps.
What it keeps goes into session state, capped and with credentials masked, as described in
[What it can reach](#what-it-can-reach); the one exception is marked in its row. Nothing is kept
outside the session.

| Hook | Runs | Reads and keeps | Event |
| --- | --- | --- | --- |
| `session.start` | When a session starts, and again after `/reload-plugins`. | Registers `/st-code-display`, brings stored state up to the current schema, notes the session's start time and takes the host's first context, cost and rate-limit reading. With `openOnStart` it asks the host to open the pane. Keeps the start time and that reading. | Passed on unchanged. |
| `session.end` | When a session ends. | Reads only the reason. After `/clear` it clears the pane as `/st-code-display reset` does. Keeps nothing. | Passed on unchanged. |
| `command.run` | Only for `/st-code-display`. Other commands never reach it. | Reads the arguments: `open`, `close`, `reset` or `layout`. Opens or closes the pane, clears its state on `reset`, and keeps the layout you pick. | Answered: the command's own reply text. It is the only command the plugin answers. |
| `classic.UserPromptSubmit` | When you submit a prompt. | Reads only the permission mode, not the prompt. Keeps the mode. | Passed on unchanged. |
| `turn.start` | When the main loop or a subagent starts a turn. | In the main loop it reads the opening text and keeps its first 400 characters as a log line, marks the loop as running and starts a fresh tally for the turn. When the text is an architect's hand-back, it keeps the first line of the advice instead. A subagent's turn is left alone. | Passed on unchanged. |
| `turn.step` | For each model request, as its response streams. | In the main loop it reads the model, the effort and the kind of each streamed chunk, never its content, and reads the clock up to three times. It keeps the model, the effort, the request count and, once the response ends, `ttft` and `tok/s`. For a subagent it reads the model, token usage and stop reason and keeps them on the agent's row, with a log line for `max_tokens`. | Every streamed chunk and the final result are passed through unchanged. |
| `turn.complete` | When a turn ends. | In the main loop it marks the loop idle and clears the turn's tally. For a subagent it reads the end reason and the answer. It keeps the status, a log line and the first 400 characters of the answer. For an architect it keeps the first line of the advice. | Passed on unchanged. |
| `agent.offer` | When the host lists an agent type the model may call. | Reads the type's name, and its description with `matchDescriptions`. Keeps the name of each type that matches `architectPattern`, the newest 20. | Passed on unchanged. |
| `agent.spawn` | When a subagent is spawned. | Reads the type, name and description, and the id and model the host gave it. Keeps a row for the agent and a log line. For an architect it keeps only the id, as a consult. A refused spawn, and a workflow script's agent, is left alone here. | Passed on unchanged. |
| `session.append` | When a message is added to the conversation. | Reads the main loop's replies, only for server-side advisor calls and their results. Keeps the ids it has seen and the consult's times. Other messages, and every subagent's, are ignored. | Passed on unchanged. |
| `tool.call` for `SubagentHandback` | When a subagent hands its report back. | Reads the report only when the sender is a known architect. Keeps the first line as the advice, and a log line. | Passed on unchanged. Other calls pass this hook by. |
| `tool.check` | On each call's permission check. | Reads the verdict and the call's id. Keeps the verdict in memory only, until the call ends, to tell an approval prompt or a refusal from a failed tool. It does not change the verdict. | The verdict is passed on unchanged. |
| `tool.call` for every call | Around each tool call, in every loop. | Reads the clock before and after, the tool's name and input, and whether the call failed or was refused. Keeps the tool's name and a short description of its input, counts, errors and average time, the files touched, the subagent's last three calls and a log line for each edit, failure or refusal. | The call and its result are passed on unchanged. It never denies or rewrites a call. |
| `session.measure` | When the host measures the session. | Reads the context, cost and rate-limit readings. Keeps the latest. | Passed on unchanged. |
| `session.compact` | When the conversation is compacted. | Reads the trigger, and whether the compaction was vetoed. Keeps the count, the time and a log line. A vetoed compaction, a precompute and a subagent's compaction are not counted. | Passed on unchanged. |
| `ui.render` | Each time the pane is drawn, for its own pane only. | Reads the stored state, the clock, and the pane's size and surface. Keeps which agent your digit key has opened. | Answered: the drawing of the plugin's own pane. |

**No hook decides anything.**

- `tool.check` passes the permission check on and only reads its verdict, to mark a refused call.
- `tool.call` never denies or rewrites a call. It reads the result after the call has run.
- `turn.step` passes every streamed chunk through unchanged.
- The only answers the plugin gives are `/st-code-display`'s own reply text and the drawing of its
  own pane.

The host calls it makes, as `claude plugin validate .` prints them:

| Call | Used for |
| --- | --- |
| `$.state.get`, `$.state.set` | Reading and writing the state above. It lasts for the session; the plugin keeps nothing across sessions. |
| `$.clock.now` | The times of log lines and clocks, and the timing of a request or a tool call. |
| `$.clock.after` | One timer, set when a model loop that no agent claims steps, to redraw the pane when that loop stops counting as running. |
| `$.command.register` | Registering `/st-code-display` at session start. |
| `$.session.usage` | The host's first context, cost and rate-limit reading at session start. |
| `$.ui.open`, `$.ui.close` | Opening the pane at session start and on `/st-code-display`, and closing it on `/st-code-display close`. |
| `$.ui.invalidate` | Asking the host to draw the pane again. |
| `$.ui.resolve` | Getting the host's drawing elements for the pane. |

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
  that no agent row claims.
- **A background agent's first step** can arrive before its row exists, so its row may count one
  step late.
- **Request speed.** `ttft` and `tok/s` are timed at Code Display's own `turn.step` hook, so they include
  everything beneath it: other plugins' hooks, the engine, the network and any retry. `tok/s` divides
  the reported `output_tokens` (thinking included) by the time from the response's first chunk to the
  stop. A response that arrives in one burst can't be timed and reads `— tok/s`. They are measured, but they aren't the API's own figures.
- **`avg*` in TOOLS & FILES.** The clock is read before and after the rest of the tool call runs, so
  the time includes other plugins' hook time on that call. Some calls are left out of the average
  because they would time something other than the tool: calls whose permission check asked for
  approval, denied calls and `Agent` calls, which run a subagent to its end. These calls still count
  toward calls and errors.

## Configure

In `/config`, or under `pluginConfigs["st-code-display"].options` in `settings.json`. Reads are lenient: a
malformed value falls back to its default.

| Option | Default | Meaning |
| --- | --- | --- |
| `architectPattern` | `advisor\|architect` | Case-insensitive regex for architect agent types and server tools |
| `matchDescriptions` | `false` | Also match agent descriptions |
| `architectLabel` | `ARCHITECT` | Label for the architect role |
| `panels` | `info,agents,architect,tools,log` | Which panels show, in order (compact layout) |
| `layout` | `auto` | `auto`, `compact`, `wide` or `mini` |
| `motion` | `on` | `on` or `off` |
| `moments` | `true` | Show the inferred consult moments |
| `openOnStart` | `true` | Open the pane at session start, in terminals ≥ 144 columns |

`motion: off` stops the header pulse and the AGENTS sweep, but the clocks keep ticking. The wide layout
puts INFO and TOOLS & FILES in the left column and AGENTS and ARCHITECT in the right, with the LOG
underneath. AGENTS shows there from the start, so the first agent doesn't move the panels. There,
`panels` still hides panels and sets the order inside each column, and when it leaves one column
with nothing to show, the other takes the full width.

## Troubleshooting

**The pane doesn't appear.**
- Check that `claude --version` reports 2.1.300 or later, then run `/reload-plugins` and `/st-code-display`.
- When the host can't place the pane, `/st-code-display` replies `The dashboard is not shown yet:` followed by
  the host's reason.
- At session start the pane only opens by itself in terminals at least 144 columns wide. Run
  `/st-code-display` to open it at any width.
- Look in the transcript for a dim line starting `st-code-display:`. It names the hook that failed or the
  reason the pane was refused. Please
  [open an issue](https://github.com/sergios-tech/code-display/issues) and include it.

**It stays in one column.** The dock opens at 66 columns. See [Two columns](#where-it-runs).

**The colours look wrong.** The palette is fixed and made for a black background. Under tmux the host
draws 256 colours unless `CLAUDE_CODE_TMUX_TRUECOLOR=1` is set, and VS Code's integrated terminal is
capped at 256. So is WSL in Windows Terminal, which sets no `COLORTERM`: add
`export COLORTERM=truecolor` to your shell's profile and restart for exact colours. In 256 colours,
orange draws as `#ff8700`, the idle dark red as `#870000`, and the reds and greens shift slightly.
Every text colour but the resting `○` and `○ IDLE` still reaches 4.5:1 contrast.

**There's too much motion.** Set `motion` to `off`.

**The counters look stale after an update.** Run `/st-code-display reset`. Stored state is always read
leniently, and state saved under an older schema is rewritten when a session starts.

## Credits

Derived from [Flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella, under the
MIT license. Flightdeck proved the idea and the event-to-reducer approach. Code Display is a rewrite with
its own panels, layouts and look. Both copyright notices are in [LICENSE](LICENSE).

Screenshots and the demo are captured from a real session; the capture scripts are kept outside the
plugin. The social preview card is [docs/media/social-preview.png](docs/media/social-preview.png).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Security: [SECURITY.md](SECURITY.md) · License:
[MIT](LICENSE)

---

Made by Sergio Jovanotti at [Sergio's Tech](https://www.sergios.tech).
