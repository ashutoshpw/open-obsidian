#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_BIN="$ROOT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG_FILE="${TMPDIR:-/tmp}/openobsidian-electron.log"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron binary is missing; run bun install first." >&2
  exit 1
fi

pkill -f -- "$ELECTRON_BIN" >/dev/null 2>&1 || true
bun run compile

launch() {
  "$ELECTRON_BIN" "$ROOT_DIR"
}

launch_background() {
  : >"$LOG_FILE"
  nohup "$ELECTRON_BIN" "$ROOT_DIR" >"$LOG_FILE" 2>&1 </dev/null &
  LAUNCHED_PID=$!
}

case "$MODE" in
  run)
    launch
    ;;
  --debug|debug)
    lldb -- "$ELECTRON_BIN" "$ROOT_DIR"
    ;;
  --logs|logs)
    launch_background
    /usr/bin/log stream --info --style compact --predicate 'process == "Electron"'
    ;;
  --telemetry|telemetry)
    launch_background
    /usr/bin/log stream --info --style compact --predicate 'process == "Electron" AND eventMessage CONTAINS[c] "OpenObsidian"'
    ;;
  --verify|verify)
    launch_background
    sleep 2
    kill -0 "$LAUNCHED_PID"
    echo "OpenObsidian Electron process is running (pid $LAUNCHED_PID)."
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
