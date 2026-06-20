import os
import sys
import argparse
import time

import cv2
import numpy as np
from ultralytics import YOLO

parser = argparse.ArgumentParser()
parser.add_argument('--model', help='Path to YOLO model file (example: "runs/detect/train/weights/best.pt")',
                    required=True)
parser.add_argument('--source', help='RTSP URL (example: "rtsp://user:pass@host:port/stream")',
                    required=True)
parser.add_argument('--thresh', help='Minimum confidence threshold for displaying detected objects (example: "0.4")',
                    default=0.5)
parser.add_argument('--resolution', help='Resolution in WxH to display inference results at (example: "640x480"), \
                    otherwise, match source resolution',
                    default=None)
parser.add_argument('--crop', help='Crop region from source before inference in format "x,y,w,h" (example: "100,50,640,480")',
                    default=None)
parser.add_argument('--inference_size', help='Resize frame to this resolution for YOLO inference only (example: "320x240")',
                    default=None)
parser.add_argument('--record', help='Record results from RTSP and save it as "demo1.avi". Must specify --resolution argument to record.',
                    action='store_true')
parser.add_argument('--device', help='Specifies the device for inference (e.g., cpu, cuda:0 or 0).',
                    default=None)

args = parser.parse_args()

model_path = args.model
rtsp_url = args.source
min_thresh = args.thresh
user_res = args.resolution
user_crop = args.crop
inference_size = args.inference_size
record = args.record
device_dev = args.device

if not os.path.exists(model_path):
    print('ERROR: Model path is invalid or model was not found. Make sure the model filename was entered correctly.')
    sys.exit(0)

if not (rtsp_url.startswith('rtsp://') or rtsp_url.startswith('rtsps://')):
    print('ERROR: RTSP source must start with rtsp:// or rtsps://')
    sys.exit(0)

model = YOLO(model_path, task='detect')
labels = model.names

crop_frame = False
if user_crop:
    crop_frame = True
    try:
        crop_x, crop_y, crop_w, crop_h = map(int, user_crop.split(','))
        print(f'Cropping enabled: x={crop_x}, y={crop_y}, w={crop_w}, h={crop_h}')
    except ValueError:
        print('ERROR: Invalid crop format. Use "x,y,w,h" format (example: "100,50,640,480")')
        sys.exit(0)

inference_resize = False
if inference_size:
    inference_resize = True
    try:
        inf_w, inf_h = map(int, inference_size.split('x'))
        print(f'Inference resize enabled: {inf_w}x{inf_h}')
    except ValueError:
        print('ERROR: Invalid inference_size format. Use "WxH" format (example: "320x240")')
        sys.exit(0)

resize = False
if user_res:
    resize = True
    resW, resH = int(user_res.split('x')[0]), int(user_res.split('x')[1])

if record:
    if not user_res:
        print('Please specify resolution to record video at.')
        sys.exit(0)
    record_name = 'demo1.avi'
    record_fps = 30
    recorder = cv2.VideoWriter(record_name, cv2.VideoWriter_fourcc(*'MJPG'), record_fps, (resW, resH))

cap = cv2.VideoCapture(rtsp_url)
if not cap.isOpened():
    print(f'ERROR: Could not open RTSP stream {rtsp_url}')
    print('Check the URL, credentials, and network access to the camera/stream.')
    sys.exit(0)

bbox_colors = [(164, 120, 87), (68, 148, 228), (93, 97, 209), (178, 182, 133), (88, 159, 106),
               (96, 202, 231), (159, 124, 168), (169, 162, 241), (98, 118, 150), (172, 176, 184)]

avg_frame_rate = 0
frame_rate_buffer = []
fps_avg_len = 200

print('Starting inference on RTSP source...')

while True:
    t_start = time.perf_counter()

    ret, frame = cap.read()
    if (frame is None) or (not ret):
        print('Unable to read frames from RTSP stream. Reconnecting...')
        cap.release()
        time.sleep(0.5)
        cap = cv2.VideoCapture(rtsp_url)
        continue

    if crop_frame:
        frame_h, frame_w = frame.shape[:2]
        crop_x = max(0, min(crop_x, frame_w - 1))
        crop_y = max(0, min(crop_y, frame_h - 1))
        crop_w = min(crop_w, frame_w - crop_x)
        crop_h = min(crop_h, frame_h - crop_y)
        frame = frame[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]

    if inference_resize:
        inference_frame = cv2.resize(frame, (inf_w, inf_h))
        scale_x = frame.shape[1] / inf_w
        scale_y = frame.shape[0] / inf_h
    else:
        inference_frame = frame
        scale_x = scale_y = 1.0

    results = model.predict(inference_frame, verbose=False, device=device_dev)
    detections = results[0].boxes
    object_count = 0

    for i in range(len(detections)):
        xyxy_tensor = detections[i].xyxy.cpu()
        xyxy = xyxy_tensor.numpy().squeeze()
        xmin, ymin, xmax, ymax = xyxy.astype(int)

        if inference_resize:
            xmin = int(xmin * scale_x)
            ymin = int(ymin * scale_y)
            xmax = int(xmax * scale_x)
            ymax = int(ymax * scale_y)

        classidx = int(detections[i].cls.item())
        classname = labels[classidx]
        conf = detections[i].conf.item()

        if conf > float(min_thresh):
            color = bbox_colors[classidx % 10]
            cv2.rectangle(frame, (xmin, ymin), (xmax, ymax), color, 2)

            label = f'{classname}: {int(conf * 100)}%'
            labelSize, baseLine = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            label_ymin = max(ymin, labelSize[1] + 10)
            cv2.rectangle(frame, (xmin, label_ymin - labelSize[1] - 10),
                          (xmin + labelSize[0], label_ymin + baseLine - 10), color, cv2.FILLED)
            cv2.putText(frame, label, (xmin, label_ymin - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
            object_count += 1

    if resize:
        frame = cv2.resize(frame, (resW, resH))

    cv2.putText(frame, f'FPS: {avg_frame_rate:0.2f}', (10, 20), cv2.FONT_HERSHEY_SIMPLEX, .7, (0, 255, 255), 2)
    cv2.putText(frame, f'Number of objects: {object_count}', (10, 40), cv2.FONT_HERSHEY_SIMPLEX, .7, (0, 255, 255), 2)
    cv2.imshow('YOLO detection results', frame)
    if record:
        recorder.write(frame)

    key = cv2.waitKey(5)
    if key == ord('q') or key == ord('Q'):
        break
    elif key == ord('s') or key == ord('S'):
        cv2.waitKey()
    elif key == ord('p') or key == ord('P'):
        cv2.imwrite('capture.png', frame)

    t_stop = time.perf_counter()
    frame_rate_calc = float(1 / (t_stop - t_start))

    if len(frame_rate_buffer) >= fps_avg_len:
        frame_rate_buffer.pop(0)
    frame_rate_buffer.append(frame_rate_calc)
    avg_frame_rate = np.mean(frame_rate_buffer)

print(f'Average pipeline FPS: {avg_frame_rate:.2f}')
cap.release()
if record:
    recorder.release()
cv2.destroyAllWindows()
