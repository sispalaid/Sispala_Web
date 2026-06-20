#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIN_FREE_GB="${MIN_FREE_GB:-5}"
MIN_FREE_BYTES=$((MIN_FREE_GB * 1024 * 1024 * 1024))

RECORDINGS_NAME="Recordings"
LOCAL_BASE="$SCRIPT_DIR/$RECORDINGS_NAME"

PRIMARY_DIR="/home/sispala/archive"
SECONDARY_MOUNT="/mnt/ext"

is_mounted() {
  local mount_point="$1"
  grep -qs " $mount_point " /proc/mounts
}

avail_bytes() {
  local path="$1"
  df -B1 --output=avail "$path" 2>/dev/null | tail -n 1 | tr -d ' '
}

best_write_path=""
best_avail_bytes=0

add_candidate() {
  local check_path="$1"
  local write_path="$2"

  # Ensure the directory exists/is writeable
  if mkdir -p "$write_path" 2>/dev/null && [ -w "$write_path" ]; then
    local avail
    avail="$(avail_bytes "$check_path")"
    if [[ -n "$avail" ]]; then
      # Select the path with the absolute most free storage space available
      if [[ "$avail" -gt "$best_avail_bytes" ]]; then
        best_avail_bytes="$avail"
        best_write_path="$write_path"
      fi
    fi
  fi
}

# 1. Primary candidate: /home/sispala/archive
add_candidate "$PRIMARY_DIR" "$PRIMARY_DIR"

# 2. Secondary candidate: /mnt/ext (only if mounted)
if is_mounted "$SECONDARY_MOUNT"; then
  add_candidate "$SECONDARY_MOUNT" "$SECONDARY_MOUNT/$RECORDINGS_NAME"
fi

# 3. Tertiary candidates: Any other mounted disk under /mnt, /media, /run/media
while read -r mount_point; do
  if [[ "$mount_point" != "$SECONDARY_MOUNT" ]]; then
    add_candidate "$mount_point" "$mount_point/$RECORDINGS_NAME"
  fi
done < <(awk '{print $2}' /proc/mounts | grep -E '^/mnt/|^/media/|^/run/media/')

# 4. Fallback candidate: Local directory (Sispala_Web/Recordings)
add_candidate "$SCRIPT_DIR" "$LOCAL_BASE"

# Output the best path found
if [[ -n "$best_write_path" ]]; then
  echo "$best_write_path"
  exit 0
else
  # Ultimate fail-safe fallback
  mkdir -p "$LOCAL_BASE"
  echo "$LOCAL_BASE"
  exit 0
fi
