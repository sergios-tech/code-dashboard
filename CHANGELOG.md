# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-23

The first release of `st-code`, a live, read-only session dashboard in the Sergio's Tech OLED style.
It is a ground-up rebuild of Flightdeck by Stephen Casella (MIT). Requires host version 2.1.300 or
newer.

### Added

- **Panels**, each hidden until it has something to show:
  - **VITALS**: effort gauge, permission mode, request count, context gauge with tokens/window and
    compactions, session cost, the first two rate-limit windows with reset countdowns, and the last
    request's `ttft` and `tok/s`.
  - **TURN**: a live clock with edits and errors while a turn runs, then a receipt with duration,
    agents spawned, edits, errors and cost added.
  - **AGENTS**: cards side by side up to `maxCards`, then swimlanes on one shared time axis. Keys
    `1` to `6` open an agent's full task, last 3 tool calls and the start of its answer.
  - **LOOPS**: model loops that no card claims, as `N seen · M active`.
  - **ARCHITECT**: advisor consults on a one-row timeline, with their timing, the inferred moment
    and the first line of the advice.
  - **TOOLS & FILES** (new): the busiest tools with calls, errors and `avg*` time per call, and the
    5 files touched most with reads and edits.
  - **TRENDS** (new): context fill and cumulative cost as sparklines across the session, with
    compaction marks.
  - **LOG**: prompts, spawns, completions, consults, edits, errors, denials and compactions, filtered
    to one agent while its transcript is viewed.
  - **Status line**: `ctx · agents · architect · denied`, each field only when it has something to
    say.
- **Denials**: a call refused by a permission rule or hook writes one red log line and counts toward
  `denied N`.
- **Layouts**: `compact` (one column), `wide` (two columns with the log underneath), `mini` (an inline
  summary of at most 8 rows) and `auto`, which chooses by placement and width.
- **OLED identity**: a crimson `SERGIO'S TECH · CODE` header bar and square frames with caps labels.
  The palette is fixed hex on pure black from the Sergio's Tech Code in Black theme, with every text
  colour at 4.5:1 or better and a glyph beside every state. The header dot pulses while work runs,
  and clocks tick without redrawing the pane.
- **Desktop and VS Code**: SVG drawings of the agents' time axis, the two TRENDS lines and the
  architect timeline, all on black.
- **`/st-code`** command: open, `close`, `reset` and `layout auto|compact|wide|mini`.
- **Configuration**: `architectPattern`, `matchDescriptions`, `architectLabel`, `panels`, `layout`,
  `maxCards`, `motion`, `moments`, `openOnStart` and `statusLine`, all read leniently.
- **Read-only and local**: every hook passes its event on unchanged. The plugin makes no network
  requests, runs no processes and touches no files. Credentials are masked before anything is
  stored, every stored list is capped, and stored state carries schema version 1.
- **Media scripts** in `scripts/capture/` that render real-session captures to PNG, GIF and a social
  preview card.

### Changed from Flightdeck

- The permission gate panel is gone (the per-check strip, verdict tallies, drill-downs and the
  `f`/`s`/`o` keys). Only denials remain.
- The `gateLabel` and `palette` options are gone, because the palette is fixed.
- The animated connector rails are gone. `motion` is now `on` or `off`, and it controls the header
  pulse.
