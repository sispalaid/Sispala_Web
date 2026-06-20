# SISPALA Web CCTV Alarm Monitoring & AI Detection System

SISPALA is a real-time, hybrid hardware-accelerated CCTV monitoring dashboard. It combines AI object detection (YOLO) with high-efficiency video decoding and encoding to stream live HLS video feeds and manage continuous recordings for home and community security.

This system is deployed at **Desa Jaten, Kecamatan Karanganyar**, aiming to optimize community security through adaptive technology.

---

## 1. System & Hardware Architecture

The system is designed to run on a hybrid, multi-GPU setup under **Arch Linux** to make the most of older hardware while offloading heavy operations:

*   **CPU:** **Intel Core i5-3470** (4 Cores, 4 Threads, Ivy Bridge architecture). Handles system orchestration, Node.js web server, and optimized in-memory color space conversions.
*   **Integrated GPU (Video Processing):** **Intel HD Graphics 2500** (mapped to `/dev/dri/by-path/pci-0000:00:02.0-render`). Handles **VAAPI hardware video decoding** of RTSP camera inputs and **VAAPI hardware H.264 video encoding** of HLS streams.
*   **Discrete GPU (AI Inference):** **NVIDIA GeForce GT 1030** (2 GB VRAM, Pascal architecture). Dedicated entirely to running real-time YOLO object detection via **CUDA** and **TensorRT** (`yolo26n.engine`).
*   **Storage Devices:** Dynamic storage selection between the primary internal disk (`/home/sispala/archive`) and secondary external mounts (like `/mnt/ext/Recordings` or USB drives).

---

## 2. The Complete Video Pipeline (Step-by-Step)

The video stream goes through an advanced pipeline to maximize hardware acceleration and minimize CPU usage:

```
[Camera RTSP] 
      │ (Compressed H.264 over Network)
      ▼
┌──────────────────────────────────────────────┐
│  FFmpeg Decoder Subprocess (VAAPI GPU)       │
│  - Decodes H.264 to NV12 in Intel GPU VRAM    │
│  - Downloads hardware surface to CPU RAM     │
│  - Pipes raw NV12 bytes (1.38 MB/frame)      │
└──────────────────┬───────────────────────────┘
                   │ (Pipes NV12 bytes, 50% data saving)
                   ▼
┌──────────────────────────────────────────────┐
│  Python Stream Controller (CPU & NVIDIA GPU) │
│  - Reads NV12 bytes, reshapes to array       │
│  - Converts NV12 to BGR24 using OpenCV SIMD  │
│  - Uploads BGR24 to NVIDIA GT 1030 VRAM      │
│  - Runs YOLO AI Inference (TensorRT engine)  │
│  - Draws bounding boxes on BGR24 in CPU RAM  │
│  - Converts BGR24 to YUV420p using OpenCV    │
│  - Pipes raw YUV420p bytes (1.38 MB/frame)   │
└──────────────────┬───────────────────────────┘
                   │ (Pipes YUV420p bytes, 50% data saving)
                   ▼
┌──────────────────────────────────────────────┐
│  FFmpeg Encoder Subprocess (VAAPI GPU)       │
│  - Receives raw YUV420p bytes                │
│  - Rearranges U/V planes to NV12 (0% CPU math)│
│  - Uploads NV12 to Intel HD 2500 GPU VRAM    │
│  - Encodes to H.264 and writes HLS segment   │
│    files (.ts) & recordings (.mp4)           │
└──────────────────┬───────────────────────────┘
                   │ (Writes to Disk)
                   ▼
┌──────────────────────────────────────────────┐
│  Node.js Express Backend & Web Dashboard     │
│  - Serves index.html, server.js, & REST APIs │
│  - Serves live cam streams on Port 8000      │
│  - Logs auto-cleanup details to cleanup.log │
└──────────────────────────────────────────────┘
```

### Detailed Pipeline Stages:

1.  **CCTV Feed Capture:**
    *   Cameras capture H.264 encoded streams and broadcast them over the local network via RTSP (e.g. `rtsp://admin:password@192.168.0.x:554/stream1`).
2.  **Decoder Process (`ffmpeg`):**
    *   Python spawns a background FFmpeg decoder command (`start_ffmpeg_decode`) which logs into the RTSP stream.
    *   Using `-hwaccel vaapi -hwaccel_device /dev/dri/... -hwaccel_output_format vaapi`, it decodes the video directly on the Intel GPU.
    *   The raw decoded frame format is **NV12** (planar Y, interleaved UV). It downloads the frame to system RAM (`hwdownload,format=nv12`) and pipes the raw NV12 bytes to Python's stdout.
3.  **AI Detection & Drawing (`python`):**
    *   Python reads the NV12 byte stream. Since NV12 is chroma-subsampled ($1.5$ bytes per pixel), it only reads `width * height * 1.5` bytes (e.g., $1.38\text{ MB}$ for 720p), reducing pipe bandwidth by 50%.
    *   Python converts the NV12 frame to BGR24 using OpenCV: `cv2.cvtColor(nv12, cv2.COLOR_YUV2BGR_NV12)`.
    *   It passes the BGR24 frame to YOLO (`model.predict()`), which uploads it to the NVIDIA GT 1030 for TensorRT detection.
    *   Bounding boxes are drawn onto the BGR24 frame using OpenCV on the CPU.
4.  **Encoder Process (`ffmpeg`):**
    *   Python converts the annotated BGR24 frame to YUV420p: `cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)`. This cuts the data size back to $1.5$ bytes per pixel.
    *   Python writes these YUV420p bytes to the stdin of the FFmpeg encoder.
    *   The FFmpeg encoder expects `-pix_fmt yuv420p`. Because the incoming video is already in the YUV color space, FFmpeg does **no color space multiplication math**. It simply rearranges the planes into NV12 (a fast, cheap memory copy) and uploads it to the Intel GPU (`hwupload`) to encode H.264 streams (`h264_vaapi`).
5.  **Output Generation:**
    *   FFmpeg writes the stream segments (`seg001.ts`, `seg002.ts`) and updates the HLS index playlist (`index.m3u8`) in `/Streams/cam[1-4]/`.
    *   Simultaneously, FFmpeg saves 1-minute segment recording files (`.mp4`) in `/Recordings/cam[1-4]/` using the local system time.

---

## 3. Key Optimizations Implemented

*   **Dual-Direction Color Space Offloading:** Shifting the color conversions from FFmpeg (which used software `libswscale` on the CPU) to OpenCV (which compiles with AVX/SIMD vector instruction support on Python) reduced the CPU usage of each FFmpeg process from **70%–90% down to less than 15%**.
*   **50% Pipe Bandwidth Reduction:** By piping `nv12` from the decoder to Python, and `yuv420p` from Python to the encoder, we reduced the system pipe copy overhead from $110.6\text{ MB/s}$ to $55.3\text{ MB/s}$ total across 4 streams.
*   **Dynamic Disk Selection:** Instead of prioritizing a fixed directory, `storage_select.sh` runs a `df` check on `/home/sispala/archive`, `/mnt/ext/Recordings`, and external USB mounts, automatically routing recordings to the disk partition with the **highest available free space**.
*   **Delayed HLS Loading:** Video streams are wrapped in `initializeStreams()` in the browser, preventing the web app from making background network requests and generating 404 logs while the login overlay is active.
*   **Dynamic Log Capping & Date Filters:** 
    *   **UI Viewing:** Capped at 5,000 lines to prevent browser rendering freezes.
    *   **Downloads/Export:** Supports up to 500,000 lines (defaulting to 100,000 lines) of clean, emoji-free text logs.
    *   **Universal Date Ranges:** Allows the "Since" and "Until" date picker to filter stack logs and file-based logs on the fly.
*   **Premium Auto-Cleanup Cards UI:** Converts raw text strings from `cleanup.log` into beautifully formatted card widgets with color-coded warning/info/success SVG badges.

---

## 4. File Structure & Responsibilities

*   `starts_all.sh` - Master startup script. Kills stale processes, cleans up temporary `Streams/` segments, pre-creates necessary folders, and starts the Node.js server.
*   `cam[1-4].sh` - Individual camera loops. They query `storage_select.sh` for the emptiest disk path, and launch `yolo_rtsp_hls.py` with camera-specific RTSP URLs and GPU devices.
*   `storage_select.sh` - Capacity-comparing shell script. Scans mounts in `/proc/mounts`, tests write permissions, and outputs the writeable path containing the most free bytes.
*   `yolo_rtsp_hls.py` - Core Python script. Handles subprocess pipes (`decode_proc` & `ffmpeg`), runs YOLO inference, draws bounding boxes, handles frame conversions, and contains the auto-cleanup logic.
*   `server.js` - Express/Node backend. Exposes dashboard login, serves streams, provides log querying APIs (`/api/system-logs`), tracks disk stats, and handles socket connections.
*   `index.html` - The web dashboard front-end. Built with clean CSS variables and Plyr.js. Handles user authentication, live multi-stream layout, logs card rendering, NVR recordings playback, and NVR time-jumping.

---

## 5. Setup & Installation Tutorial

### Step 1: Install System Dependencies (Arch Linux)
Ensure your user belongs to the `video` and `render` groups to access VAAPI acceleration:
```bash
sudo usermod -aG video,render $USER
```
Install necessary packages:
```bash
sudo pacman -Syu
sudo pacman -S ffmpeg nodejs npm python python-pip python-virtualenv intel-media-driver libva-utils
```
Verify VAAPI is working on the Intel iGPU:
```bash
vainfo
```

### Step 2: Set Up Python Virtual Environment
Create and activate a virtual environment in the project directory:
```bash
python -m venv venv
source venv/bin/activate
```
Install requirements:
```bash
pip install -r requirements.txt
```
*(Requirements should include: `opencv-python-headless`, `numpy`, `ultralytics`, `tensorrt`, and `pycuda` or `onnxruntime` depending on engine compilation)*.

### Step 3: Install Node.js Dependencies
Install backend dependencies:
```bash
npm install
```
*(Installs packages like `express`, `socket.io`, `body-parser`, `express-session`, etc.)*

### Step 4: Systemd Service Setup
To configure the system to run on startup, create a service file:
`/etc/systemd/system/sispala-stack.service`:
```ini
[Unit]
Description=SISPALA CCTV Stream & AI Monitor Service
After=network.target

[Service]
Type=simple
User=sispala
WorkingDirectory=/home/sispala/myversion/Sispala_Web
ExecStart=/bin/bash systemd/run_all.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable sispala-stack.service
sudo systemctl start sispala-stack.service
```

---

## 6. How to Run & Maintain

### Starting manually (without systemd):
If you want to run the stack manually in the terminal:
```bash
./starts_all.sh
```

### Monitoring Logs:
To check live service outputs and crashes:
```bash
journalctl -u sispala-stack.service -f
```

### Managing storage:
*   The python script checks the active disk partition every 60 seconds.
*   If the available space falls below **5 GB** (configurable via the `MIN_FREE_GB` environment variable), it triggers the **Auto-Cleanup** routine, which deletes the oldest `.mp4` video files until 5 GB of free space is restored.
*   Check the dashboard panel or read `cleanup.log` directly to inspect cleanup actions:
    ```bash
    cat cleanup.log
    ```
