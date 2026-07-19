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
  if [[ -n "${MEDIAMTX_PID:-}" ]]; then
    kill "$MEDIAMTX_PID" 2>/dev/null || true
  fi
  wait "$NODE_PID" $CAM_PIDS ${MEDIAMTX_PID:-} 2>/dev/null || true
}

trap cleanup INT TERM EXIT

# Generate MediaMTX configuration from .env variables
python "$SCRIPT_DIR/generate_mediamtx.py"

# Find mediamtx binary (system-wide command first, then local fallback)
if command -v mediamtx >/dev/null 2>&1; then
  MEDIAMTX_BIN="mediamtx"
elif [ -f "$SCRIPT_DIR/mediamtx" ]; then
  MEDIAMTX_BIN="$SCRIPT_DIR/mediamtx"
else
  MEDIAMTX_BIN=""
fi

# Start MediaMTX RTSP proxy
if [ -n "$MEDIAMTX_BIN" ]; then
  echo "[System] Starting MediaMTX RTSP proxy using: $MEDIAMTX_BIN"
  "$MEDIAMTX_BIN" "$SCRIPT_DIR/mediamtx.yml" &
  MEDIAMTX_PID=$!
  sleep 2
else
  echo "[Warning] mediamtx binary not found globally or locally. Running cameras directly."
  MEDIAMTX_PID=""
fi

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
