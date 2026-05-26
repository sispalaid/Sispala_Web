#!/bin/bash
export LIBVA_DRIVER_NAME=i965
echo -ne "\033]0;Cam2 - RC2\007"
cd "$(dirname "$0")" || exit
mkdir -p Streams/cam2 Rekaman/cam2
ffmpeg -hide_banner -y -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi \
-rtsp_transport tcp -i "rtsp://admin:sispala-RC2@192.168.0.11:554/stream1" \
-vf "scale_vaapi=w=640:h=360" -c:v h264_vaapi -qp 25 -g 60 \
-c:a aac -b:a 64k -ar 16000 -ac 1 \
-f hls -hls_time 2 -hls_list_size 10 -hls_flags delete_segments \
-hls_segment_filename "Streams/cam2/seg%03d.ts" "Streams/cam2/index.m3u8" \
-c:v copy -f segment -segment_time 60 -strftime 1 -reset_timestamps 1 "Rekaman/cam2/%Y-%m-%d_%H-%M.mp4"
sleep 5
exec "$0"
