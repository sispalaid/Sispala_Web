#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/active_storage.txt"
RECORDINGS_NAME="Recordings"
LOCAL_BASE="$SCRIPT_DIR/$RECORDINGS_NAME"

is_mounted() {
  local mount_point="$1"
  grep -qs " $mount_point " /proc/mounts
}

active_path=""
if [ -f "$STATE_FILE" ]; then
  active_path=$(cat "$STATE_FILE" | tr -d '[:space:]')
fi

# If active_path is set, verify it is still valid/mounted
selected_path=""
if [ -n "$active_path" ]; then
  # If the path starts with /mnt/ext, check if /mnt/ext is mounted
  if [[ "$active_path" == "/mnt/ext"* ]]; then
    if is_mounted "/mnt/ext"; then
      selected_path="$active_path"
    fi
  else
    # For other paths, assume they are valid if they are writeable
    selected_path="$active_path"
  fi
fi

# Ensure selected path is writeable
if [ -n "$selected_path" ] && mkdir -p "$selected_path" 2>/dev/null && [ -w "$selected_path" ]; then
  echo "$selected_path"
  exit 0
fi

# Fallback 1: Default to primary disk `/home/sispala/archive`
PRIMARY_DIR="/home/sispala/archive"
if mkdir -p "$PRIMARY_DIR" 2>/dev/null && [ -w "$PRIMARY_DIR" ]; then
  echo "$PRIMARY_DIR" > "$STATE_FILE"
  echo "$PRIMARY_DIR"
  exit 0
fi

# Fallback 2: Local directory
mkdir -p "$LOCAL_BASE"
echo "$LOCAL_BASE" > "$STATE_FILE"
echo "$LOCAL_BASE"
exit 0
