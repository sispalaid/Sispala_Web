import argparse
import json
import os
import shutil
import subprocess
import threading
import time

import cv2
import numpy as np
from ultralytics import YOLO


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, help='Path to YOLO model file')
    parser.add_argument('--source', required=True, help='RTSP URL')
    parser.add_argument('--cam', required=True, help='Camera name, e.g. cam1')
    parser.add_argument('--out-dir', required=True, help='Base output dir for Streams')
    parser.add_argument('--record-dir', required=True, help='Base output dir for Recordings')
    parser.add_argument('--device', required=True, help='Inference device, e.g. cpu or cuda:0')
    parser.add_argument('--thresh', required=True, type=float, help='Confidence threshold')
    parser.add_argument('--resolution', required=True, help='Output resolution WxH or source')
    parser.add_argument('--inference-size', required=True, help='Inference resize WxH or source')
    parser.add_argument('--fps', required=True, help='Output FPS or source')
    parser.add_argument('--hls-time', required=True, type=int, help='HLS segment duration (seconds)')
    parser.add_argument('--hls-list-size', required=True, type=int, help='HLS playlist size')
    parser.add_argument('--segment-time', required=True, type=int, help='Recording segment duration (seconds)')
    parser.add_argument('--encoder', required=True, choices=['vaapi', 'qsv'], help='Hardware encoder to use')
    parser.add_argument('--hw-device', required=True, help='Render device path')
    parser.add_argument('--hw-decode', required=True, choices=['on', 'off'], help='Enable hardware-accelerated decode')
    parser.add_argument('--decode-device', required=True, help='Decode render device path')
    parser.add_argument('--rtsp-transport', required=True, choices=['tcp', 'udp'], help='RTSP transport')
    return parser.parse_args()


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def parse_size(value):
    if not value:
        return None
    if value.lower() in ['source', 'native']:
        return None
    try:
        w, h = value.lower().split('x')
        return int(w), int(h)
    except ValueError:
        raise ValueError('Invalid size format, use WxH')


def parse_fps(value, fallback_fps):
    if not value or value.lower() == 'source':
        return fallback_fps
    try:
        return float(value)
    except ValueError:
        raise ValueError('Invalid fps format, use a number or source')


def log_startup(args, width, height, fps, out_size, inf_size, encode_fps):
    out_w, out_h = out_size if out_size else (width, height)
    inf_w, inf_h = inf_size if inf_size else (width, height)
    decode_state = 'on' if args.hw_decode == 'on' else 'off'

    print(
        'Startup info: '
        f'source={width}x{height} @ {fps:.2f}fps, '
        f'inference={inf_w}x{inf_h}, '
        f'output={out_w}x{out_h}, '
        f'encode_fps={encode_fps:.2f}, '
        f'encoder={args.encoder}, '
        f'encode_device={args.hw_device}, '
        f'decode={decode_state}, '
        f'decode_device={args.decode_device}, '
        f'rtsp_transport={args.rtsp_transport}, '
        f'device={args.device}, '
        f'thresh={args.thresh}'
    )


def probe_rtsp(source, rtsp_transport):
    cmd = [
        'ffprobe',
        '-hide_banner',
        '-loglevel', 'error',
        '-rtsp_transport', rtsp_transport,
        '-show_streams',
        '-print_format', 'json',
        source
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=10)
        data = json.loads(result.stdout)
        has_audio = any(stream.get('codec_type') == 'audio' for stream in data.get('streams', []))
        return has_audio
    except (subprocess.SubprocessError, FileNotFoundError, json.JSONDecodeError) as err:
        print(f'RTSP probe failed: {err}')
        return False


def cleanup_old_recordings(active_record_dir, min_free_bytes):
    # Check active recording directory, and other common/preferred locations
    dirs_to_check = [active_record_dir]
    
    possible_dirs = [
        "/home/sispala/archive",
        "/mnt/ext/Recordings",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "Recordings")
    ]
    for d in possible_dirs:
        norm_d = os.path.abspath(d)
        if os.path.exists(norm_d) and norm_d not in [os.path.abspath(x) for x in dirs_to_check]:
            dirs_to_check.append(norm_d)

    for record_dir in dirs_to_check:
        try:
            total, used, free = shutil.disk_usage(record_dir)
        except Exception:
            continue

        if free >= min_free_bytes:
            continue

        msg = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Storage Alert: Free space on '{record_dir}' is low ({free / (1024**3):.2f} GB remaining). Running auto-cleanup...\n"
        print(msg.strip())
        try:
            with open('cleanup.log', 'a') as f:
                f.write(msg)
        except Exception as e:
            print(f"Error writing to cleanup.log: {e}")

        mp4_files = []
        for root, dirs, files in os.walk(record_dir):
            for file in files:
                if file.endswith('.mp4'):
                    full_path = os.path.join(root, file)
                    mp4_files.append((file, full_path))

        # Sort by filename (timestamp YYYY-MM-DD_HH-MM.mp4)
        mp4_files.sort(key=lambda x: x[0])

        deleted_count = 0
        freed_bytes = 0
        for file_name, file_path in mp4_files:
            try:
                total, used, free = shutil.disk_usage(record_dir)
                if free >= min_free_bytes:
                    break
                file_size = os.path.getsize(file_path)
                os.remove(file_path)
                deleted_count += 1
                freed_bytes += file_size
                del_msg = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Deleted old recording: {file_name} ({file_size / (1024**2):.1f} MB freed)\n"
                print(del_msg.strip())
                with open('cleanup.log', 'a') as f:
                    f.write(del_msg)
            except Exception as e:
                print(f"Error deleting file {file_path}: {e}")

        if deleted_count > 0:
            done_msg = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Auto-cleanup complete. Successfully freed {freed_bytes / (1024**3):.2f} GB by deleting {deleted_count} file(s).\n"
            print(done_msg.strip())
            try:
                with open('cleanup.log', 'a') as f:
                    f.write(done_msg)
            except Exception:
                pass


def start_ffmpeg(
    width,
    height,
    fps,
    encode_fps,
    streams_dir,
    record_dir,
    hls_time,
    hls_list_size,
    segment_time,
    encoder,
    hw_device,
    source,
    rtsp_transport,
    has_audio
):
    hls_path = os.path.join(streams_dir, 'index.m3u8')
    segment_pattern = os.path.join(streams_dir, 'seg%03d.ts')
    record_pattern = os.path.join(record_dir, '%Y-%m-%d_%H-%M.mp4')

    gop = max(int(encode_fps), 10)

    cmd = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error']

    if encoder == 'qsv':
        cmd += [
            '-init_hw_device', f'qsv=hw:{hw_device}',
            '-filter_hw_device', 'hw'
        ]
    else:
        cmd += ['-vaapi_device', hw_device]

    # Input 0: Raw video frame input from stdin
    cmd += [
        '-f', 'rawvideo',
        '-pix_fmt', 'yuv420p',
        '-s', f'{width}x{height}',
        '-r', str(fps),
        '-i', '-',
    ]

    # Input 1: RTSP input stream for audio (only if available)
    if has_audio:
        cmd += [
            '-thread_queue_size', '1024',
            '-rtsp_transport', rtsp_transport,
            '-i', source
        ]

    # --- Output 1: Live HLS Stream (Hardware Encoding) ---
    cmd += ['-map', '0:v']
    if has_audio:
        cmd += ['-map', '1:a']

    if encoder == 'qsv':
        cmd += [
            '-vf', f'fps={encode_fps},format=nv12,hwupload=extra_hw_frames=64',
            '-c:v', 'h264_qsv',
        ]
    else:
        cmd += [
            '-vf', f'fps={encode_fps},format=nv12,hwupload',
            '-c:v', 'h264_vaapi',
        ]

    if has_audio:
        cmd += [
            '-af', 'aresample=async=1',
            '-c:a', 'aac',
        ]

    cmd += [
        '-g', str(gop),
        '-keyint_min', str(gop),
        '-sc_threshold', '0',
        '-f', 'hls',
        '-hls_time', str(hls_time),
        '-hls_list_size', str(hls_list_size),
        '-hls_flags', 'delete_segments+independent_segments',
        '-hls_segment_filename', segment_pattern,
        hls_path,
    ]

    # --- Output 2: MP4 recordings (Hardware Encoding) ---
    cmd += ['-map', '0:v']
    if has_audio:
        cmd += ['-map', '1:a']

    if encoder == 'qsv':
        cmd += [
            '-vf', f'fps={encode_fps},format=nv12,hwupload=extra_hw_frames=64',
            '-c:v', 'h264_qsv',
        ]
    else:
        cmd += [
            '-vf', f'fps={encode_fps},format=nv12,hwupload',
            '-c:v', 'h264_vaapi',
        ]

    if has_audio:
        cmd += [
            '-af', 'aresample=async=1',
            '-c:a', 'aac',
        ]

    cmd += [
        '-g', str(gop),
        '-keyint_min', str(gop),
        '-sc_threshold', '0',
        '-f', 'segment',
        '-segment_time', str(segment_time),
        '-strftime', '1',
        '-reset_timestamps', '1',
        record_pattern
    ]

    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def start_ffmpeg_decode(source, width, height, fps, decode_device, rtsp_transport):
    cmd = [
        'ffmpeg',
        '-nostdin',
        '-hide_banner',
        '-loglevel', 'error',
        '-rtsp_transport', rtsp_transport,
        # '-timeout', '15000000',
        '-hwaccel', 'vaapi',
        '-hwaccel_device', decode_device,
        '-hwaccel_output_format', 'vaapi',
        '-i', source,
        '-vf', 'hwdownload,format=nv12',
        '-f', 'rawvideo',
        '-pix_fmt', 'nv12',
        '-s', f'{width}x{height}',
        '-r', str(fps),
        '-'
    ]

    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)


def main():
    args = parse_args()

    if not (args.source.startswith('rtsp://') or args.source.startswith('rtsps://')):
        raise SystemExit('RTSP source must start with rtsp:// or rtsps://')

    # Start RTSP audio probing in a background thread to run in parallel with YOLO model loading
    has_audio_holder = [False]
    def run_probe():
        has_audio_holder[0] = probe_rtsp(args.source, args.rtsp_transport)
    probe_thread = threading.Thread(target=run_probe, daemon=True)
    probe_thread.start()

    model = YOLO(args.model, task='detect')
    labels = model.names

    streams_dir = os.path.join(args.out_dir, args.cam)
    record_dir = os.path.join(args.record_dir, args.cam)
    ensure_dir(streams_dir)
    ensure_dir(record_dir)

    out_size = parse_size(args.resolution)
    inf_size = parse_size(args.inference_size)

    while True:
        cap = cv2.VideoCapture(args.source)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            fps = parse_fps(args.fps, cap.get(cv2.CAP_PROP_FPS) or 15)
            if fps <= 0:
                fps = 15
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if width > 0 and height > 0:
                break
            
            ret, frame = cap.read()
            if ret and frame is not None:
                height, width = frame.shape[:2]
                if width > 0 and height > 0:
                    break

        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Warning: Could not open RTSP stream {args.source} or retrieve frame dimensions. Camera might be offline. Retrying in 10 seconds...")
        cap.release()
        time.sleep(10)


    decode_proc = None
    if args.hw_decode == 'on':
        cap.release()
        decode_proc = start_ffmpeg_decode(
            args.source,
            width,
            height,
            fps,
            args.decode_device,
            args.rtsp_transport
        )

    ffmpeg = None
    output_size = None
    encode_fps = min(fps, 15)

    log_startup(args, width, height, fps, out_size, inf_size, encode_fps)

    # Wait for background RTSP probe thread to finish (max 2 seconds)
    probe_thread.join(timeout=2.0)
    has_audio = has_audio_holder[0]
    print(f'RTSP stream audio status: {"Detected (recording audio)" if has_audio else "Not Detected (video-only)"}')

    consecutive_ffmpeg_crashes = 0
    last_cleanup_time = 0
    cleanup_interval = 60
    min_free_gb = int(os.environ.get('MIN_FREE_GB', 5))
    min_free_bytes = min_free_gb * 1024 * 1024 * 1024

    while True:
        now_time = time.time()
        if now_time - last_cleanup_time > cleanup_interval:
            last_cleanup_time = now_time
            cleanup_old_recordings(args.record_dir, min_free_bytes)
        if decode_proc:
            frame_bytes = int(width * height * 1.5)
            data = decode_proc.stdout.read(frame_bytes)
            if len(data) != frame_bytes:
                decode_proc.kill()
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Warning: Decoder process failed to read frame. Retrying in 5 seconds...")
                time.sleep(5.0)
                decode_proc = start_ffmpeg_decode(
                    args.source,
                    width,
                    height,
                    fps,
                    args.decode_device,
                    args.rtsp_transport
                )
                continue
            # Decode NV12 from raw bytes to BGR frame in Python using OpenCV's fast color conversion
            nv12_frame = np.frombuffer(data, dtype=np.uint8).reshape((height * 3 // 2, width))
            frame = cv2.cvtColor(nv12_frame, cv2.COLOR_YUV2BGR_NV12)
        else:
            ret, frame = cap.read()
            if not ret or frame is None:
                cap.release()
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Warning: Failed to read frame from OpenCV capture. Retrying in 5 seconds...")
                time.sleep(5.0)
                cap = cv2.VideoCapture(args.source)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue

        if inf_size:
            inf_w, inf_h = inf_size
            inference_frame = cv2.resize(frame, (inf_w, inf_h))
            scale_x = frame.shape[1] / inf_w
            scale_y = frame.shape[0] / inf_h
        else:
            inference_frame = frame
            scale_x = scale_y = 1.0

        results = model.predict(inference_frame, verbose=False, device=args.device)
        detections = results[0].boxes

        for i in range(len(detections)):
            xyxy = detections[i].xyxy.cpu().numpy().squeeze().astype(int)
            xmin, ymin, xmax, ymax = xyxy

            if inf_size:
                xmin = int(xmin * scale_x)
                ymin = int(ymin * scale_y)
                xmax = int(xmax * scale_x)
                ymax = int(ymax * scale_y)

            conf = float(detections[i].conf.item())
            if conf < args.thresh:
                continue

            classidx = int(detections[i].cls.item())
            classname = labels[classidx]
            label = f'{classname}: {int(conf * 100)}%'

            cv2.rectangle(frame, (xmin, ymin), (xmax, ymax), (68, 148, 228), 2)
            (text_w, text_h), base = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            y_label = max(ymin, text_h + 10)
            cv2.rectangle(
                frame,
                (xmin, y_label - text_h - 10),
                (xmin + text_w, y_label + base - 10),
                (68, 148, 228),
                cv2.FILLED
            )
            cv2.putText(frame, label, (xmin, y_label - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

        if out_size:
            out_w, out_h = out_size
            frame = cv2.resize(frame, (out_w, out_h))

        if output_size is None:
            output_size = (frame.shape[1], frame.shape[0])
            ffmpeg = start_ffmpeg(
                output_size[0],
                output_size[1],
                fps,
                encode_fps,
                streams_dir,
                record_dir,
                args.hls_time,
                args.hls_list_size,
                args.segment_time,
                args.encoder,
                args.hw_device,
                args.source,
                args.rtsp_transport,
                has_audio
            )

        try:
            if ffmpeg is None:
                raise BrokenPipeError
            # Convert BGR to YUV420p (I420) to optimize piping bandwidth and bypass FFmpeg CPU-heavy color math
            yuv_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
            ffmpeg.stdin.write(yuv_frame.tobytes())
            consecutive_ffmpeg_crashes = 0
        except (BrokenPipeError, AttributeError, OSError):
            consecutive_ffmpeg_crashes += 1
            print(f"FFmpeg stdin broken for {args.cam} (consecutive crashes: {consecutive_ffmpeg_crashes})")
            if consecutive_ffmpeg_crashes >= 3:
                if ffmpeg:
                    try:
                        ffmpeg.kill()
                    except Exception:
                        pass
                raise SystemExit(f"FFmpeg crashed repeatedly for {args.cam}. Exiting to allow storage re-selection.")
            
            if ffmpeg:
                try:
                    ffmpeg.kill()
                    ffmpeg.wait(timeout=1)
                except Exception:
                    pass
            
            ffmpeg = start_ffmpeg(
                output_size[0],
                output_size[1],
                fps,
                encode_fps,
                streams_dir,
                record_dir,
                args.hls_time,
                args.hls_list_size,
                args.segment_time,
                args.encoder,
                args.hw_device,
                args.source,
                args.rtsp_transport,
                has_audio
            )


if __name__ == '__main__':
    main()