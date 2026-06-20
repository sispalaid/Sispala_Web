#!/bin/bash
echo -ne "\033]0;Cam4 - RC4\007"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit
source ~/sispala-ai/bin/activate

MODEL_PATH="/home/sispala/yolo26n.engine"
DEVICE="cuda:0"
OUT_RES=""

while true; do
	RECORD_DIR=$("$SCRIPT_DIR/storage_select.sh")
	python "$SCRIPT_DIR/yolo_rtsp_hls.py" \
		--model "$MODEL_PATH" \
		--source "rtsp://admin:sispala-RC4@192.168.0.11:556/stream1" \
		--cam "cam4" \
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
		--rtsp-transport "tcp"
	sleep 2
done
