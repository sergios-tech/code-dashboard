# Contributing

Thanks for helping with Sergio's Tech · Code Display. Bug reports, fixes and small focused improvements are
all welcome. Before you start a larger change, please open an issue so the approach can be agreed
first.

## Setup

You need Claude Code 2.1.300 or later to run the plugin, and Node.js only to run the type check. The
plugin has no npm dependencies.

```sh
git clone https://github.com/sergios-tech/code-display
cd code-display
claude --plugin-dir .
```

The first load writes `.claude-plugin/types/`, the host's type declarations. That directory is
git-ignored, and `tsconfig.json` extends the config inside it. Edits to the hooks reload in the
running session. A new client module only loads after you restart the session.

## Gates

Run all three from the repo root before you open a pull request:

```sh
claude plugin validate .
claude plugin test .
npx -y -p typescript@7.0.2 tsc -p .
```

If `node` and `npx` aren't on your `PATH`, load a Node version first, for example with nvm:

```sh
source ~/.nvm/nvm.sh && nvm use 24
```

`tsc` needs `.claude-plugin/types/`, so load the plugin once with `claude --plugin-dir .` before you
run it.

If you change the media scripts, also run their tests:

```sh
python3 -I -m unittest discover -s scripts/capture
```

## Layout

| Path | Holds |
| --- | --- |
| `.claude-plugin/` | `plugin.json` (name, version, options) and `marketplace.json` |
| `hooks/hooks.json` | names the one hooks module, `register.tsx` |
| `hooks/register.tsx` | the atoms, every helper that reads or writes state or calls `$`, and every hook, written inline in the `on(...)` call that registers it |
| `hooks/config.ts` | `parseConfig`: options read leniently, with a default for anything malformed |
| `hooks/state/` | `schema.ts`: defaults, normalizers, the schema version and the snapshot a frame is drawn from |
| `hooks/domain/` | pure reducers: the main model's vitals, the turn tally (kept for the architect's moments), agents and loops, architect, activity (tools and files), log |
| `hooks/format/` | pure text helpers: model names, durations, tokens, USD, gauges, and `redact()` |
| `hooks/view/` | palette, frame, header, the panels' arrangement under it, layout math, the view model, the mini layout, the cell layout and pictures for the desktop app and VS Code, and the time-axis SVG; `panels/` has one renderer per panel |
| `hooks/client/` | client modules: the ticking clock, the header pulse and the AGENTS sweep |
| `types/index.d.ts` | the `PluginState['st-code-display']` declaration |
| `tests/` | one test file per module group, plus shared helpers in `kit.ts` |
| `scripts/capture/` | the media pipeline: tmux capture, ANSI to SVG, PNG, GIF and social card |
| `docs/media/` | the screenshots, demo GIF and social preview that the README uses |

A frame is drawn in three steps. The `ui.render` handler loads one state snapshot, and
`buildViewModel` turns it into a view model as a pure function. Each panel renderer then gets its
slice of the model. Renderers never read state.

## Ground rules

- **Real data only.** Every number on screen comes from a session event or a host reading. Anything
  inferred carries a label (`(inferred)`, `avg*`). Screenshots and the demo come from a real session,
  never a mock-up.
- **Watch, don't act.** Every hook passes its event on unchanged. Nothing denies, rewrites or blocks
  an event. There are no network requests, no processes and no file access.
- **Behaviour lives in pure modules with tests.** `domain/`, `format/`, `view/layout.ts` and
  `view/model.ts` never touch `$`. `register.tsx` wires the events to them and the panels draw. A
  change in behaviour comes with a test.
- **Check 40, 64 and 120 columns.** Every panel draws cleanly at all three widths, with no row wider
  than the pane and no wrapped borders. The mini layout never goes past 8 rows.
- **Everything stored goes through `redact()`.** Prompts, tasks, answers, advice, tool summaries and
  paths are all masked before they reach state.
- **Every text colour reaches 4.5:1 on black.** `faint` and `frame` never carry text, and a state
  always has a glyph beside its colour.
- **Reads tolerate old or broken state.** Every stored value goes through its normalizer, so missing,
  older-shaped or junk state still draws.
- **Storage stays bounded.** Each stored list has a cap, so a new list needs one too.
- **Comments explain why**, not what.

## Host rules worth knowing

- Every `read` and `update` call lives in `hooks/register.tsx`, beside the atoms. The host's scan
  only lists calls on atoms declared in the same file, so `view/` gets state only from the snapshot.
- Write each hook inline, as `on(event, async ($, e, next) => { ... })` on a line of its own in
  `register.tsx`, and pass the event on as `next(e)`. Hand `$` whole to a top-level `function` of
  that file, or to `read` and `update`, and never to an imported function.
- Call each `$.noun.method(...)` the module uses directly in a hook at least once, so
  `claude plugin validate .` lists none of them as `(via ...)` a helper. Spell the command, pane and
  matcher names as literals (`'st-code-display'`) so the scan can read them.
- A plugin hooks `session.start` only once. Put any start-of-session work inside that one handler.
- A client module's `module` path is a string literal relative to the file that draws it.

## Pull requests

- Keep each pull request to one concern, and say what changed and why.
- Run the three gates and paste the test count.
- For a visual change, attach a capture at the widths it affects.
- Commit messages describe the work in the imperative ("Add the ARCHITECT panel").
