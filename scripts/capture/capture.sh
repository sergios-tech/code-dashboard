#!/usr/bin/env bash
# Run Claude Code with this plugin in a detached tmux session and save
# ANSI snapshots of its screen. See README.md for the full sequence.
#
# It only sets CLAUDE_CONFIG_DIR so the session uses a clean demo profile.
# It never reads, copies or prints anything from that profile.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.st-code-demo}"
SESSION="${SESSION:-st-code-demo}"
OUT="${OUT:-${XDG_CACHE_HOME:-$HOME/.cache}/st-code-capture}"

# The host opens the dock at the width the plugin asks for (66) but never
# past 45% of the terminal. --wide asks for 120 in a throwaway copy of the
# plugin, which needs a terminal of at least 267 columns.
WIDE_COLUMNS=120
WIDE_COPY="$OUT/plugin-wide"

usage() {
  cat <<EOF
Usage: capture.sh <command> [args]

  start [--wide] [--dir PROJECT] [-x COLS] [-y ROWS]
                          open claude --plugin-dir in tmux (default 160x48;
                          --wide defaults to 280x50 and a 120-column dock)
  send "<text>"           type text and press Enter
  snap <name>             write the screen to \$OUT/<name>.ansi
  burst <name> <count> <interval>
                          snap <count> times, <interval> seconds apart, to
                          \$OUT/<name>-01.ansi, -02.ansi, ...
  resize <cols> <rows>    resize the session window
  stop                    end the session and remove the --wide copy

Environment:
  CLAUDE_CONFIG_DIR  demo profile (default \$HOME/.st-code-demo)
  OUT                snapshot directory (default ~/.cache/st-code-capture)
  SESSION            tmux session name (default st-code-demo)
  DEMO_DIR           project to open when --dir is not given
EOF
}

die() {
  echo "capture.sh: $*" >&2
  exit 1
}

need_session() {
  tmux has-session -t "$SESSION" 2>/dev/null || die "no session '$SESSION'; run start first"
}

need_number() {
  [[ "$2" =~ ^[0-9]+$ ]] || die "$1 must be a whole number, got '$2'"
}

need_name() {
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || die "snapshot name may only use letters, digits, . _ -"
}

# Copy the plugin (no history, deps or tests) and widen the dock request.
make_wide_copy() {
  local command_file="$WIDE_COPY/hooks/events/command.ts"
  rm -rf "$WIDE_COPY"
  mkdir -p "$WIDE_COPY"
  tar -C "$REPO" --exclude=.git --exclude=node_modules --exclude=tests --exclude=scripts \
    -cf - . | tar -C "$WIDE_COPY" -xf -
  sed "s/columns: 66,/columns: $WIDE_COLUMNS,/" "$command_file" >"$command_file.new"
  mv "$command_file.new" "$command_file"
  grep -q "columns: $WIDE_COLUMNS," "$command_file" || die "could not widen the dock in the plugin copy"
}

cmd_start() {
  local wide=0 cols="" rows="" dir="${DEMO_DIR:-}" plugin="$REPO"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --wide) wide=1 ;;
      --dir) dir="${2:?--dir needs a path}"; shift ;;
      -x) cols="${2:?-x needs a number}"; shift ;;
      -y) rows="${2:?-y needs a number}"; shift ;;
      *) die "unknown start option '$1'" ;;
    esac
    shift
  done
  if [[ $wide -eq 1 ]]; then
    : "${cols:=280}" "${rows:=50}"
  else
    : "${cols:=160}" "${rows:=48}"
  fi
  need_number -x "$cols"
  need_number -y "$rows"
  [[ -n "$dir" && -d "$dir" ]] || die "give the demo project with --dir or DEMO_DIR"
  [[ -d "$CLAUDE_CONFIG_DIR" ]] || die "no profile at $CLAUDE_CONFIG_DIR; log in once by hand: CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR claude"
  ! tmux has-session -t "$SESSION" 2>/dev/null || die "session '$SESSION' is already running; run stop first"

  mkdir -p "$OUT"
  if [[ $wide -eq 1 ]]; then
    make_wide_copy
    plugin="$WIDE_COPY"
  fi
  # COLORTERM makes the host draw 24-bit colour, so the palette hex survives the capture.
  tmux new-session -d -s "$SESSION" -x "$cols" -y "$rows" -c "$dir" \
    -e "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR" -e COLORTERM=truecolor \
    claude --plugin-dir "$plugin"
  echo "started '$SESSION' at ${cols}x${rows}"
}

cmd_send() {
  [[ $# -eq 1 ]] || die "usage: send \"<text>\""
  need_session
  tmux send-keys -t "$SESSION" -l -- "$1"
  sleep 0.3
  tmux send-keys -t "$SESSION" Enter
}

snap_to() {
  tmux capture-pane -t "$SESSION" -e -p >"$1"
  echo "$1"
}

cmd_snap() {
  [[ $# -eq 1 ]] || die "usage: snap <name>"
  need_name "$1"
  need_session
  mkdir -p "$OUT"
  snap_to "$OUT/$1.ansi"
}

cmd_burst() {
  [[ $# -eq 3 ]] || die "usage: burst <name> <count> <interval>"
  need_name "$1"
  need_number count "$2"
  [[ "$3" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "interval must be seconds, got '$3'"
  need_session
  mkdir -p "$OUT"
  local width=${#2} i
  [[ $width -ge 2 ]] || width=2
  for ((i = 1; i <= $2; i++)); do
    snap_to "$OUT/$(printf '%s-%0*d' "$1" "$width" "$i").ansi"
    [[ $i -eq $2 ]] || sleep "$3"
  done
}

cmd_resize() {
  [[ $# -eq 2 ]] || die "usage: resize <cols> <rows>"
  need_number cols "$1"
  need_number rows "$2"
  need_session
  tmux resize-window -t "$SESSION" -x "$1" -y "$2"
}

cmd_stop() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  rm -rf "$WIDE_COPY"
  echo "stopped '$SESSION'"
}

main() {
  local command="${1:-}"
  [[ $# -eq 0 ]] || shift
  case "$command" in
    start) cmd_start "$@" ;;
    send) cmd_send "$@" ;;
    snap) cmd_snap "$@" ;;
    burst) cmd_burst "$@" ;;
    resize) cmd_resize "$@" ;;
    stop) cmd_stop ;;
    -h | --help | help | "") usage ;;
    *) usage >&2; die "unknown command '$command'" ;;
  esac
}

main "$@"
