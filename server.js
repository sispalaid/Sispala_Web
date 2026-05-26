const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

// --- SETUP STATIC FILES ---
app.use(express.static(__dirname));

// --- API: Ambil Daftar Rekaman ---
app.get('/api/recordings/:cam', (req, res) => {
    const cam = req.params.cam;
    const dir = path.join(__dirname, 'Rekaman', cam);
    
    if (!fs.existsSync(dir)) return res.json([]);
    
    fs.readdir(dir, (err, files) => {
        if (err) return res.json([]);
        // Urutkan dari yang terbaru
        const sorted = files.filter(f => f.endsWith('.mp4')).sort().reverse();
        res.json(sorted);
    });
});

// --- API: Trigger Alarm (Mock) ---
app.get('/trigger-alarm', (req, res) => {
    console.log("Alarm dipicu oleh user!");
    // Tambahkan perintah eksekusi buzzer di sini jika ada
    res.json({ status: "Alarm Active" });
});

// --- SOCKET.IO: Jembatan Data AI ---
io.on('connection', (socket) => {
    console.log('Client/Detector terhubung ke Socket.io');

    // Menerima data koordinat dari detector.py
    socket.on('detection', (payload) => {
        // Payload diharapkan berisi: { cam: 'cam1', boxes: [[x1, y1, x2, y2, label], ...] }
        // Meneruskan ke semua browser yang sedang membuka dashboard
        io.emit('update-overlay', payload);
    });
});

// --- START SERVER ---
const PORT = 8000;
http.listen(PORT, () => {
    console.log(`CCTV Monitoring Server berjalan di http://localhost:${PORT}`);
});
