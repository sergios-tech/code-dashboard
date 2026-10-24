# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-23

The first release of `st-code`, a live, read-only session dashboard in the Sergio's Tech OLED style.
It is a ground-up rebuild of Flightdeck by Stephen Casella (MIT). Requires host version 2.1.300 or
newer.

### Added

- **Panels**, each hidden until it has something to show (INFO and LOG show from the start):
  - **INFO**: a labelled table in three groups split by dividers. Effort, permission mode and
    request count; a context gauge with tokens/window and `↺` compactions, then each of the first two
    rate-limit windows with its reset countdown; the session cost and the last request's `ttft` and
    `tok/s`. Gauges are green, gold from 80% and coral from 90%.
  - **AGENTS**: one row per agent, running first, each with a status glyph, its hotkey digit, title,
    model tag, a status sweep (a block bouncing along the bar while the agent runs, the bar filled
    in its status colour once it ends) and a clock. Keys `1` to `6` open an agent inside the frame:
    its full task, facts, last 3 tool calls and the start of its answer. The last row counts the model
    loops that no agent claims, as `N seen · M active` with one dot each.
  - **ARCHITECT**: advisor consults on a one-row timeline, with their timing, the inferred moment and
    the first line of the advice. The frame is green while it advises.
  - **TOOLS & FILES**: the busiest tools as a table with a glyph per tool family, calls, errors and
    `avg*` time per call, and under a divider the 5 files touched most with reads and edits.
  - **TRENDS**: context fill and cumulative cost as sparklines across the session, with the context
    cells coloured by level, the cost line in a quiet grey, the change since the reading before and
    a `↺` where a compaction landed.
  - **LOG**: prompts, spawns, completions, consults, edits, errors, denials and compactions, with the
    main loop named by its model. Only the mark after a line carries a state colour. Filtered to one
    agent while its transcript is viewed.
  - **Status line**: `ctx · agents · architect · denied`, each field only when it has something to
    say, with `↺N` after the context figure.
- **Denials**: a call refused by a permission rule or hook ends its log line with a gold `· denied`
  and counts toward `denied N`.
- **Layouts**: `compact` (one column), `wide` (INFO, TRENDS and TOOLS & FILES on the left, AGENTS and
  ARCHITECT on the right, the log underneath), `mini` (an inline summary of at most 8 rows: the state
  and a digest, the context trend, up to five agents and a last row) and `auto`, which chooses by
  placement and width.
- **Signal identity**: the Signal OLED palette on a pure black fill, with every text colour at 4.5:1
  or better in its designed hex and in its checked 256-colour fallback, and a glyph beside every
  state. The header is one unfilled row: `▌SERGIO'S TECH · CODE`, the state dot, the model in its
  family colour and dim state words. Frames are square, with caps labels, dividers and a green border
  for running work. The header dot pulses while work runs, and clocks tick without redrawing the pane.
- **Desktop and VS Code**: each block of the pane is a picture of its terminal cells on black. The
  pulse and the sweep animate on both, the clocks show the time at the last redraw, and the agents'
  time axis stays under AGENTS.
- **`/st-code`** command: open, `close`, `reset` and `layout auto|compact|wide|mini`.
- **Configuration**: `architectPattern`, `matchDescriptions`, `architectLabel`, `panels`, `layout`,
  `motion`, `moments`, `openOnStart` and `statusLine`, all read leniently. `panels` defaults to
  `info,trends,agents,architect,tools,log`.
- **Read-only and local**: every hook passes its event on unchanged. The plugin makes no network
  requests, runs no processes and touches no files. Credentials are masked before anything is
  stored, every stored list is capped, and stored state carries schema version 2.
- **Media scripts** in `scripts/capture/` that render real-session captures to PNG, GIF and a social
  preview card.

### Changed from Flightdeck

- The permission gate panel is gone (the per-check strip, verdict tallies, drill-downs and the
  `f`/`s`/`o` keys). Only denials remain.
- The `gateLabel` and `palette` options are gone, because the palette is fixed.
- The animated connector rails are gone. `motion` is now `on` or `off`, and it controls the header
  pulse and the AGENTS sweep.
