const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs'); // Ditambahkan untuk membaca folder rekaman
const app = express();

// 1. Middleware untuk file statis Dashboard (HTML, JS, CSS)
app.use(express.static(__dirname));

// 2. Middleware untuk akses file Video Rekaman agar bisa diputar di browser
// Contoh akses: http://localhost:8000/archive/cam1/2026-05-26_00-15.mp4
app.use('/archive', express.static(path.join(__dirname, 'Rekaman')));

/**
 * API: Mengambil daftar file rekaman berdasarkan ID kamera
 */
app.get('/api/recordings/:cam', (req, res) => {
    const cam = req.params.cam;
    const directoryPath = path.join(__dirname, 'Rekaman', cam);

    // Cek apakah folder kamera ada
    if (!fs.existsSync(directoryPath)) {
        return res.status(404).json({ message: `Folder rekaman untuk ${cam} tidak ditemukan.` });
    }

    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            console.error("Gagal membaca folder:", err);
            return res.status(500).json({ message: "Gagal membaca daftar file." });
        }

        // Filter hanya file .mp4 dan urutkan dari yang terbaru (reverse sort)
        const mp4Files = files
            .filter(file => file.endsWith('.mp4'))
            .sort()
            .reverse();

        res.json(mp4Files);
    });
});

/**
 * API: Memicu alarm fisik (ffplay)
 */
app.get('/trigger-alarm', (req, res) => {
    console.log("Instruksi diterima: Membunyikan alarm selama 5 detik...");
    const audioFile = "./Alarm.mpeg";
    const command = `ffplay -nodisp -autoexit -t 5 "${audioFile}"`;

    exec(command, (err) => {
        if (err) {
            console.error("Gagal memutar audio. Pastikan FFmpeg terinstall di PATH.");
        } else {
            console.log("Alarm selesai diputar.");
        }
    });

    res.json({ status: "Alarm dipicu selama 5 detik!" });
});

// Menjalankan server
const PORT = 8000;
app.listen(PORT, () => {
    console.log("---------------------------------------------------");
    console.log(`Server NVR Berjalan di http://localhost:${PORT}`);
    console.log("---------------------------------------------------");
});
