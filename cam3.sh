#!/bin/bash
echo -ne "\033]0;Cam3 - RC3\007"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit
export PYTHONUNBUFFERED=1
source ~/sispala-ai/bin/activate

# Load environment variables dynamically
set -a
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"
set +a

MODEL_PATH="${CAM3_MODEL_PATH:-/home/sispala/yolo26n.engine}"
DEVICE="${CAM3_DEVICE:-cuda:0}"
BITRATE="${CAM3_BITRATE:-1.5M}"
TIMEOUT="${CAM3_TIMEOUT:-15}"
RTSP_TRANSPORT="${CAM3_RTSP_TRANSPORT:-tcp}"
OUT_RES=""

# Detect local RTSP proxy (MediaMTX) or fallback to direct URL
if (timeout 1 bash -c '</dev/tcp/127.0.0.1/8554' 2>/dev/null); then
	RTSP_URL="rtsp://127.0.0.1:8554/cam3"
	echo "[cam3] Local RTSP proxy detected. Routing via proxy: $RTSP_URL"
else
	RTSP_URL="${CAM3_RTSP_URL:-rtsp://admin:password@192.168.0.x:554/stream1}"
	echo "[cam3] Local RTSP proxy not running. Routing directly: $RTSP_URL"
fi

AUDIO_FLAG=""
if [ "${CAM3_AUDIO:-off}" = "on" ]; then
	AUDIO_FLAG="--audio"
fi

while true; do
	RECORD_DIR=$("$SCRIPT_DIR/storage_select.sh")
	python "$SCRIPT_DIR/yolo_rtsp_hls.py" \
		--model "$MODEL_PATH" \
		--source "$RTSP_URL" \
		--cam "cam3" \
		--out-dir "$SCRIPT_DIR/Streams" \
		--record-dir "$RECORD_DIR" \
		--device "$DEVICE" \
		--thresh "0.5" \
		--resolution "${OUT_RES:-source}" \
		--inference-size "640x360" \
		--fps "source" \
		--hls-time "1" \
		--hls-list-size "3" \
		--segment-time "60" \
		--encoder "vaapi" \
		--hw-device "/dev/dri/by-path/pci-0000:00:02.0-render" \
		--hw-decode "on" \
		--decode-device "/dev/dri/by-path/pci-0000:00:02.0-render" \
		--rtsp-transport "$RTSP_TRANSPORT" \
		--bitrate "$BITRATE" \
		--timeout "$TIMEOUT" \
		$AUDIO_FLAG
	sleep 2
done
