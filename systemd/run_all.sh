#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR" || exit 1

export PYTHONUNBUFFERED=1

cleanup() {
  if [[ -n "${NODE_PID:-}" ]]; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
  if [[ -n "${CAM_PIDS:-}" ]]; then
    kill $CAM_PIDS 2>/dev/null || true
  fi
  wait "$NODE_PID" $CAM_PIDS 2>/dev/null || true
}

trap cleanup INT TERM EXIT

/usr/bin/node "$SCRIPT_DIR/server.js" &
NODE_PID=$!

"$SCRIPT_DIR/cam1.sh" &
CAM1_PID=$!
"$SCRIPT_DIR/cam2.sh" &
CAM2_PID=$!
"$SCRIPT_DIR/cam3.sh" &
CAM3_PID=$!
"$SCRIPT_DIR/cam4.sh" &
CAM4_PID=$!

CAM_PIDS="$CAM1_PID $CAM2_PID $CAM3_PID $CAM4_PID"

# Wait for any process to exit so systemd can restart the stack if any component crashes
wait -n
