# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.5.5] - 2026-10-25

### Fixed

- **AGENTS in one column**: a model loop that no agent claims, such as a workflow's agents, now
  shows AGENTS with its `loops` row. Before, a docked pane under 110 columns showed nothing at all
  while only such loops ran; the wide layout and the inline summary already showed them.
- **Loops are activity**: a running loop that no agent claims counts as a running agent does. The
  header dot stays green and pulses, AGENTS is green and reads `only loops running`, and the frames
  no longer turn the idle dark red while a background workflow works. A loop counts as running for
  15 seconds after its last step, and the pane redraws then, so one that ends without saying so
  does not leave it green.
- **Durations**: the LOG's `done · 21s`, the architect's `took` and the averages past a minute now
  count whole seconds, as the running clock does, so an agent's row and its log line agree. A
  21.8-second agent read `0:21` in its row and `done · 22s` in the LOG.
- **Hand-backs in the LOG**: a message from an agent with a row is logged under that agent's
  title, such as `write tes…  agent message`, instead of `engine  agent message from a288e0e2`.
  One from an agent without a row stays an engine line.
- **Glyphs and counts**: the edits and errors columns put a space after `✎` and `✗` (`✎ 2`,
  `✗ 3`). Terminals whose font draws those glyphs wider than one cell overlapped them with the
  count. The errors column is a cell wider, so `✗ 120` still leaves a gap after the calls.
- **Pastes in the LOG**: a prompt's pasted text reads as `[pasted 69 lines]` after your own words,
  instead of the paste's wrapper and its first lines. A prompt that is only a paste is logged as
  yours, not as an engine line.

## [0.5.4] - 2026-10-25

### Changed

- **Plugin label**: `plugin.json` sets `displayName` to `Sergio's Tech · Code`, the label `/plugin`
  lists in place of `st-code`. The install name stays `st-code@sergios-tech`.

## [0.5.3] - 2026-10-25

### Fixed

- **Idle frames**: the idle dark red is now `#7f0000`, one step under the themes' `#800000`.
  Terminals drawn in 256 colours (tmux, VS Code, WSL in Windows Terminal) rounded `#800000` up to
  `#af0000`, barely darker than the normal frame red; they now draw `#870000`. In truecolor the two
  look the same. The README notes that WSL in Windows Terminal draws 256 colours unless
  `COLORTERM=truecolor` is set.

## [0.5.2] - 2026-10-25

### Changed

- **Idle frames**: while nothing runs, neither a turn nor a subagent, every panel frame and its
  dividers turn dark red (`#800000`, the dark red of the Sergio's Tech themes; `#af0000` in 256
  colours), and so do the `○` and `IDLE` of the header and the inline summary. A frame holding
  running work stays green, and INFO's `○ idle` stays dim. The resting `○ IDLE` is the one text
  below 4.5:1 contrast; its `○` shape says the same.

### Fixed

- **LOG**: a line now runs as far as the pane is wide. Prompts were cut to 70 characters, tool calls
  to 64 and advice to 60 when they were stored, so a wide LOG showed them cut short with room to
  spare. Each line now keeps its first 400 characters and is cut only to the pane's width.

## [0.5.1] - 2026-10-25

### Fixed

- **Wide layout**: AGENTS now shows in the right column from the start, reading `no agents yet`
  until the first agent. Before, the right half stayed blank and INFO and TOOLS & FILES took only
  the left half of the pane. When `panels` leaves one column with nothing to show, the other now
  takes the full width.

## [0.5.0] - 2026-10-25

### Added

- **INFO**: the effort gauge's lit cells turn red at `xhigh` and `max`. The word stays green, and the
  mini's effort summary is unchanged.

### Changed

- **INFO**: the frame meta reads `● working` in orange while the main loop runs. `○ idle` stays dim.
- **Gauge colours**: the context gauge is green, orange from 30% and red from 50%. Every rate-limit
  window (5h, 7d and any other) is green, orange from 80% and red from 90%. Each is judged by the
  printed figure, and the mini's figures follow the same rules. Gold is no longer a level colour; the
  `↺` compaction mark stays gold.
- **LOG**: docked with a known height, it takes every row the other panels leave, with no cap, and
  pads with blank rows so its frame ends on the pane's bottom edge. Inline, or when the height is
  unknown, it keeps at most 8 lines (4 to 8 when unknown).

### Fixed

- **Docked picture pane**: on the desktop app and VS Code, the agents' time axis is now counted in the
  pane's height, so a docked pane with agents no longer draws past its bottom edge. This was also
  the case in 0.4.0.

## [0.4.0] - 2026-10-25

### Removed

- **TRENDS**: the panel and its context and cost sparklines are gone. The mini summary loses its
  ctx trend row and shows up to six agents instead of five. Context, compactions and cost stay in
  INFO and in the mini's first row. `trends` is no longer a `panels` name: a list that names it
  shows the rest, and the wide layout's left column holds INFO and TOOLS & FILES.

## [0.3.3] - 2026-10-25

### Removed

- **Status line**: the plugin no longer writes `ctx · agents · architect · denied` under the prompt,
  and the `statusLine` option is gone. Context, agents and consults stay in the pane, and a denial
  still ends its log line with a gold `· denied`.

## [0.3.1] - 2026-10-25

### Fixed

- **Docked fill**: the black fill now covers every row of the docked pane, not only the rows the
  panels take. Under the `dark-ansi` theme the host paints the dock bright black, so the rows below
  the panels showed grey. The one-cell edge the host draws around the dock keeps the theme's colour.

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
