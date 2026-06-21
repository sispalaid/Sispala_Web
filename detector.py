import cv2
import numpy as np
import onnxruntime as ort
import socketio

# Setup Koneksi ke Server Node.js
sio = socketio.Client()
sio.connect('http://localhost:3000') # Sesuaikan port server kamu

# Load Model ONNX
model_path = "path/ke/model/yolov8n.onnx" # ISI PATH MODEL DI SINI
session = ort.InferenceSession(model_path)

import os

# Buka Stream RTSP
rtsp_url = os.environ.get("CAM1_RTSP_URL", "rtsp://admin:password@192.168.0.x:554/stream1")
cap = cv2.VideoCapture(rtsp_url)

def preprocess(frame):
    # Sesuaikan dengan input model (biasanya 640x640)
    img = cv2.resize(frame, (640, 640))
    img = img.transpose((2, 0, 1)) / 255.0
    return np.expand_dims(img, axis=0).astype(np.float32)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret: break

    # Inference
    input_tensor = preprocess(frame)
    outputs = session.run(None, {session.get_inputs()[0].name: input_tensor})
    
    # [LOGIKA POST-PROCESSING DISINI]
    # Filter hasil deteksi (x1, y1, x2, y2, confidence, class)
    detections = [] 
    
    # Kirim ke Node.js
    sio.emit('detection', {'cam': 'cam1', 'data': detections})

cap.release()
