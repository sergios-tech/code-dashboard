# Media capture

Scripts that turn a real session of the dashboard into the screenshots, GIF and
social preview in `docs/media/`. A tmux capture is plain text with ANSI colour, so
the pipeline is:

```
capture.sh  ->  frames/*.ansi  ->  render.py  ->  SVG / PNG / GIF / social card
```

| File | Role |
| --- | --- |
| `capture.sh` | Runs `claude --plugin-dir` in detached tmux and saves screen snapshots. |
| `ansi.py` | Parses a capture into a cell grid and writes SVG. Standard library only. |
| `render.py` | Draws a grid as PNG, GIF or a 1280x640 social card (needs Pillow). |
| `test_ansi.py` | Unit tests for `ansi.py`. |
| `fixtures/sample.ansi` | A small hand-made pane used by the tests and for smoke runs. |

## Setup

Needs `tmux`, Python 3.10 or newer and the DejaVu Sans Mono font
(`/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf`, package `fonts-dejavu-core`).

```sh
python3 -m venv .venv-capture
.venv-capture/bin/pip install -r scripts/capture/requirements.txt
```

Keep the venv, the frames and the outputs outside the repo. Run the tests from the
repo root:

```sh
python3 -I -m unittest discover -s scripts/capture
```

## Clean profile

Capture with a profile that has no memory files, hooks, other plugins, connectors or
custom status line. `capture.sh` uses `CLAUDE_CONFIG_DIR`, default
`$HOME/.st-code-demo`, and never reads, copies or prints anything in it.

Log in to that profile once, by hand, in your own terminal:

```sh
CLAUDE_CONFIG_DIR=$HOME/.st-code-demo claude
```

Then `/exit`. To keep the demo unattended, allow its tools in
`$HOME/.st-code-demo/settings.json` (`permissions.allow`) rather than using bypass mode.

## Capture sequence

Make a throwaway demo project with no private code, outside this repo. Then:

```sh
export DEMO_DIR=/path/to/demo-project
export OUT=$HOME/st-code-frames          # default: ~/.cache/st-code-capture
scripts/capture/capture.sh start         # 160x48, docked at 66 columns (compact layout)
scripts/capture/capture.sh send "/st-code"
scripts/capture/capture.sh send "<a prompt that fans out to a few subagents>"
scripts/capture/capture.sh burst run 8 1.5   # run-01.ansi ... run-08.ansi, for the GIF
scripts/capture/capture.sh snap docked
scripts/capture/capture.sh stop
```

Subcommands: `start`, `send "<text>"`, `snap <name>`, `burst <name> <count> <interval>`,
`resize <cols> <rows>` and `stop`. Run `capture.sh --help` for the options.

### Which layout you get

The layout follows the pane width, and the host caps the dock at 45% of the terminal.

| Shot | How |
| --- | --- |
| Compact (dock 66 columns) | `start` at 160x48. |
| Wide (dock 110 columns or more) | `start --wide`: runs a temporary copy of the plugin under `$OUT/plugin-wide` that asks for 120 columns, in a 280x50 terminal. `stop` deletes the copy. The repo is not touched. |
| Inline mini | `start -x 100 -y 40`. Under about 110 columns the pane goes inline in the conversation. |

The host applies `/st-code layout wide|compact` on top of this. A forced `wide` draws
two columns from a dock of 82 columns (the automatic wide layout starts at 110), so in
the stock 66-column dock it still draws compact.

`capture.sh` sets `COLORTERM=truecolor` so the host draws 24-bit colour. Without it
the palette is rounded to 256 colours (the crimson header comes out lighter).

## Render

```sh
R=.venv-capture/bin/python
$R scripts/capture/render.py $OUT/docked.ansi --png docked.png
$R scripts/capture/render.py $OUT/docked.ansi --pane --rows 1:40 --png pane.png
$R scripts/capture/render.py $OUT/docked.ansi --pane --rows 1:40 --social social.png
$R scripts/capture/render.py $OUT/run-*.ansi --gif demo.gif --ms 700
$R scripts/capture/render.py $OUT/docked.ansi --svg docked.svg
```

- `--pane` keeps everything right of the dock divider; `--cols A:B` and `--rows A:B`
  keep a range of columns or rows (Python slice rules, either side optional).
- PNG, SVG and the social card use the last frame given. A GIF uses every frame, in
  the order given (`burst` zero-pads its numbers, so a glob sorts correctly).
- The social card is 1280x640: the pane, with trailing blank rows dropped, centred on
  `#000000` above a crimson `#8a0000` bar.
- `render.py` stops with an error if a GIF is over 3 MB. Use fewer frames or crop.
- PNGs are drawn at 2x. Glyphs missing from DejaVu Sans Mono (emoji and icon glyphs in
  the host's own chrome) draw as an empty box; crop to the pane to avoid them.

## Privacy checklist

Open every image before committing it and confirm none of these is visible:

- a path outside the demo project (check the `~/...` line in the host banner, and crop
  the banner out of pane shots)
- a token or an email address
- unrelated prompt text
- the names of installed plugins or connectors
- custom status-line content

Re-capture anything that fails. Do not commit the `.ansi` frames.
