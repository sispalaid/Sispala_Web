const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Load environment variables from .env file manually
const dotenvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotenvPath)) {
    const envConfig = fs.readFileSync(dotenvPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const match = line.trim().match(/^([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            const key = match[1];
            let value = match[2] ? match[2].trim() : '';
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.substring(1, value.length - 1);
            } else if (value.startsWith("'") && value.endsWith("'")) {
                value = value.substring(1, value.length - 1);
            }
            process.env[key] = value;
        }
    });
}

const session = require('express-session');
const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'sispala-secret-key-fallback',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 30 * 60 * 1000 // Sesi dibatasi aktif selama 30 menit saja
    }
}));

// File penyimpanan data Akun secara permanen
const USERS_FILE = path.join(__dirname, 'users.json');

// Helper internal untuk membaca data users dari file JSON secara real-time
function readUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        const defaultUsers = [
            { 
                username: process.env.DEFAULT_ADMIN_USER || 'admin', 
                password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin_password_change_me', 
                role: 'superadmin' 
            }
        ];
        fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        return defaultUsers;
    }
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

// Letakkan di bagian atas server.js, setelah fungsi readUsers() bawaan Anda
function encryptPassword(password) {
    return Buffer.from(password).toString('base64');
}

function decryptPassword(encryptedPassword) {
    return Buffer.from(encryptedPassword, 'base64').toString('utf-8');
}

// Helper internal untuk menulis kembali/menyimpan data users ke file JSON
function saveUsers(usersData) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));
    } catch (err) {
        console.error("Gagal menyimpan data pengguna ke file users.json:", err.message);
    }
}

// File penyimpanan Log Aktivitas Login/Logout
const LOG_FILE = path.join(__dirname, 'login_logs.json');

// Helper internal untuk mencatat aktivitas login/logout ke JSON
function writeLog(username, role, action) {
    try {
        let logs = [];
        if (fs.existsSync(LOG_FILE)) {
            try { 
                logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); 
            } catch (e) { 
                logs = []; 
            }
        }
        
        // Format Waktu Jakarta/WIB
        const timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        
        // 1. DIUBAH: Pake 'unshift' supaya data terbaru langsung masuk ke urutan PALING ATAS
        logs.unshift({ username, role, action, timestamp });
        
        // 2. DITAMBAHKAN: Batasi maksimal hanya menyimpan 300 aktivitas terakhir
        if (logs.length > 300) {
            logs = logs.slice(0, 300); // Memotong dan membuang data lama setelah baris ke-300
        }
        
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
    } catch (err) {
        console.error("Gagal menulis log aktivitas login/logout:", err.message);
    }
}
// --- SETUP STATIC FILES ---
app.use(express.static(__dirname));

const recordingsDirName = 'Recordings';
const recordingsRoot = path.join(__dirname, recordingsDirName);

app.get('/recordings/:cam/:file', (req, res) => {
    const { cam, file } = req.params;
    const roots = getRecordingRoots();
    for (const root of roots) {
        if (root.isMounted) {
            const filePath = path.join(root.basePath, cam, file);
            if (fs.existsSync(filePath)) {
                if (req.query.download === 'true') {
                    return res.download(filePath, file);
                }
                return res.sendFile(filePath, (err) => {
                    if (err) {
                        if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
                            // Client disconnected, standard browser behavior
                            return;
                        }
                        console.error(`Gagal mengirim file rekaman (${file}): ${err.message}`);
                        if (!res.headersSent) {
                            res.status(err.status || 500).send('Gagal mengirim file rekaman.');
                        }
                    }
                });
            }
        }
    }
    res.status(404).send('File rekaman tidak ditemukan di drive manapun.');
});

// DIUBAH: Login sekarang membaca data akun dari file JSON lokal
// app.post('/api/login', (req, res) => {
//     const { username, password } = req.body;
    
//     // Mengambil data user terbaru dari database file JSON
//     const users = readUsers();
//     const user = users.find(u => u.username === username && u.password === password);
    
//     if (user) {
//         req.session.user = { username: user.username, role: user.role };
        
//         // CATAT LOG LOGIN
//         writeLog(user.username, user.role, 'LOGIN');
        
//         res.json({ success: true, role: user.role });
//     } else {
//         res.status(401).json({ success: false, message: 'Username atau Password salah' });
//     }
// });

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log(`[LOGIN TRY] Username: ${username}`);

    const users = readUsers();
    
    // 1. Cari user di database tanpa sensitif huruf besar/kecil
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (user) {
        let isValidPassword = false;

        // 2. BYPASS UNTUK AKUN GUEST (warga) YANG SUDAH TERENKRIPSI DI USERS.JSON
        if (user.username.toLowerCase() === 'warga') {
            // Ubah input 'sehatselalu' menjadi Base64 untuk dicocokkan dengan DB
            const encryptedInput = encryptPassword(password);
            isValidPassword = (user.password === encryptedInput);
        } else {
            // 3. LOGIKA UNTUK ADMIN & SUPERADMIN (Bisa membaca Base64 atau Teks Asli)
            const isBase64 = /^[a-zA-Z0-9+/]+={0,2}$/.test(user.password) && (user.password.length % 4 === 0);

            if (isBase64) {
                try {
                    const decrypted = decryptPassword(user.password);
                    isValidPassword = (decrypted === password);
                } catch (e) {
                    isValidPassword = (user.password === password);
                }
            } else {
                // Jika password superadmin lama berupa teks asli
                isValidPassword = (user.password === password);
            }
        }

        // 4. JIKA PASSWORD VALID, BERIKAN AKSES LOGIN
        if (isValidPassword) {
            req.session.user = { username: user.username, role: user.role };
            writeLog(user.username, user.role, 'LOGIN');
            console.log(`[LOGIN SUCCESS] ${username} berhasil masuk.`);
            return res.json({ success: true, role: user.role });
        } else {
            console.log(`[LOGIN FAILED] Password salah untuk user: ${username}`);
        }
    } else {
        console.log(`[LOGIN FAILED] Username tidak ditemukan di database: ${username}`);
    }

    res.status(401).json({ success: false, message: 'Username atau Password salah' });
});

app.get('/api/check-session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// DIUBAH: Logout sekarang mencatat Log Aktivitas sebelum session dihapus
app.post('/api/logout', (req, res) => {
    if (req.session && req.session.user) {
        // CATAT LOG LOGOUT
        writeLog(req.session.user.username, req.session.user.role, 'LOGOUT');
    }
    req.session.destroy();
    res.json({ success: true });
});

// BARU: API untuk Membuat Akun Baru (Hanya untuk Superadmin) -> Disimpan ke JSON
app.post('/api/create-account', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized: Hanya Superadmin yang dapat membuat akun.' });
    }

    const { newUsername, newPassword, newRole } = req.body;

    if (!newUsername || !newPassword || !newRole) {
        return res.json({ success: false, message: 'Data tidak lengkap.' });
    }

    if (!['admin', 'guest'].includes(newRole)) {
        return res.json({ success: false, message: 'Role tidak valid! Harus admin atau guest.' });
    }

    const users = readUsers();

    if (users.find(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
        return res.json({ success: false, message: 'Username sudah terdaftar!' });
    }

    const encryptedPassword = encryptPassword(newPassword);

    // Dorong data yang sudah terenkripsi ke file database
    users.push({ 
        username: newUsername, 
        password: encryptedPassword, // <-- Menggunakan password yang sudah di-encrypt (Base64)
        role: newRole 
    });
    
    saveUsers(users);

    res.json({ success: true, message: `Akun ${newUsername} dengan role [${newRole}] berhasil dibuat!` });
});

// BARU: API untuk Memodifikasi/Mengubah Password dan Role Akun yang Sudah Ada (Hanya untuk Superadmin) -> Diperbarui ke JSON
// BARU: API untuk Mengambil Daftar Username saja untuk Fitur Suggest Dropdown (Hanya untuk Superadmin)

app.get('/api/users-list', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const users = readUsers();
        const currentUsername = req.session.user.username;

        // Filter dan Dekripsi password khusus untuk ditampilkan ke Superadmin di tabel
        const filteredUsers = users
            .filter(u => u.username !== currentUsername) // Sesuai permintaan: sesama superadmin tidak saling lihat
            .map(u => {
                let plainPassword = u.password;
                try {
                    // Coba dekripsi password acak menjadi teks asli untuk ditampilkan di tabel
                    plainPassword = decryptPassword(u.password);
                } catch (e) {
                    // Jika gagal/password bawaan lama belum terenkripsi, biarkan teks asli
                    plainPassword = u.password;
                }
                
                return {
                    username: u.username,
                    role: u.role,
                    password: plainPassword // Teks asli yang dikirim ke tabel HTML Anda
                };
            });

        res.json({ success: true, users: filteredUsers });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Gagal mengambil daftar pengguna' });
    }
});

app.post('/api/modify-account', (req, res) => {
    // Validasi hak akses khusus superadmin
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized: Akses ditolak!' });
    }

    const { username, newPassword, newRole } = req.body;

    if (!username) {
        return res.json({ success: false, message: 'Target username harus diisi.' });
    }

    // Ambil data users saat ini dari file JSON
    const users = readUsers();

    // Cari akun berdasarkan username target
    const targetUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!targetUser) {
        return res.json({ success: false, message: `Akun dengan username "${username}" tidak ditemukan.` });
    }

    // Jika password baru diisi, perbarui password akun target
    if (newPassword && newPassword.trim() !== "") {
        targetUser.password = newPassword;
    }

    // Jika role baru dipilih/diisi, perbarui role akun target
    if (newRole && newRole.trim() !== "") {
        if (!['superadmin', 'admin', 'guest'].includes(newRole)) {
            return res.json({ success: false, message: 'Role tidak valid!' });
        }
        targetUser.role = newRole;
    }

    // Simpan seluruh perubahan kembali ke file users.json secara aman
    saveUsers(users);

    res.json({ 
        success: true, 
        message: `Akun "${targetUser.username}" berhasil dimodifikasi secara permanen!` 
    });
});

// API BARU: Menghapus Akun Terdaftar (Hanya bisa diakses oleh Superadmin)
app.post('/api/delete-account', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, error: 'Username tidak boleh kosong' });
    }

    // Mencegah superadmin menghapus akun dirinya sendiri secara tidak sengaja
    if (username === req.session.user.username) {
        return res.status(400).json({ success: false, error: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif!' });
    }

    try {
        let users = readUsers();
        const userIndex = users.findIndex(u => u.username === username);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'Akun tidak ditemukan' });
        }

        // Hapus user dari array data
        users.splice(userIndex, 1);
        
        // Simpan kembali ke file users.json
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 4));

        res.json({ success: true, message: `Akun "${username}" berhasil dihapus.` });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Gagal memproses penghapusan akun di server' });
    }
});

// API: Mengambil Daftar Pengguna yang Sudah Difilter (Sesama Superadmin tidak saling melihat)
app.get('/api/users-list', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const users = readUsers();
        const currentUsername = req.session.user.username;

        // FILTER: Tampilkan semua user, KECUALI akun superadmin lain
        const filteredUsers = users.filter(u => {
            if (u.role === 'superadmin' && u.username !== currentUsername) {
                return false; // Jangan masukkan superadmin lain
            }
            return true;
        });

        res.json({ success: true, users: filteredUsers });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Gagal mengambil daftar pengguna' });
    }
});

// BARU: API untuk Mengambil Log Login/Logout (Hanya untuk Superadmin)
app.get('/api/logs', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized: Hanya Superadmin yang dapat mengakses log.' });
    }

    let logs = [];
    if (fs.existsSync(LOG_FILE)) {
        try {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        } catch (e) {
            logs = [];
        }
    }
    // Mengembalikan log terbalik agar aktivitas terbaru berada di paling atas
    res.json({ success: true, logs: logs.reverse() });
});

// Helper internal untuk memfilter baris log berdasarkan rentang tanggal sejak/sampai
function filterLinesByDate(lines, since, until) {
    const sinceDate = since ? new Date(since + 'T00:00:00') : null;
    const untilDate = until ? new Date(until + 'T23:59:59') : null;
    
    if (!sinceDate && !untilDate) return lines;
    
    let lastKeep = true;
    const filtered = [];
    const dateRegex = /(\d{4})-(\d{2})-(\d{2})/;
    
    for (const line of lines) {
        const match = line.match(dateRegex);
        if (match) {
            const lineDateStr = `${match[1]}-${match[2]}-${match[3]}`;
            const lineDate = new Date(lineDateStr + 'T12:00:00'); // set ke siang hari untuk menghindari pergeseran zona waktu
            
            let keep = true;
            if (sinceDate && lineDate < sinceDate) keep = false;
            if (untilDate && lineDate > untilDate) keep = false;
            
            lastKeep = keep;
        }
        if (lastKeep) {
            filtered.push(line);
        }
    }
    return filtered;
}

// BARU: API untuk Mengambil Log System/Proses (Hanya untuk Superadmin)
app.get('/api/system-logs', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized: Hanya Superadmin yang dapat mengakses log sistem.' });
    }

    const source = req.query.source || 'journalctl';
    const isDownload = req.query.download === 'true';
    
    // Batasi baris log untuk mencegah load berlebih:
    // - UI dibatasi max 5.000 baris agar browser tidak lag/freeze saat merender
    // - Download dibatasi max 500.000 baris (default 100.000) agar log sejarah yang diunduh lengkap
    const UI_MAX_LIMIT = 5000;
    const DOWNLOAD_MAX_LIMIT = 500000;
    const limit = isDownload 
        ? Math.min(parseInt(req.query.limit) || 100000, DOWNLOAD_MAX_LIMIT)
        : Math.min(parseInt(req.query.limit) || 500, UI_MAX_LIMIT);
    
    const since = req.query.since;
    const until = req.query.until;
    
    if (source === 'journalctl') {
        const lineCount = limit;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        let cmd = 'journalctl -u sispala-stack.service';
        if (since && dateRegex.test(since)) {
            cmd += ` --since "${since}"`;
        }
        if (until && dateRegex.test(until)) {
            cmd += ` --until "${until}"`;
        }
        cmd += ` -n ${lineCount} --no-pager`;

        exec(cmd, { maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
            if (err) {
                // Fallback jika journalctl gagal / tidak tersedia
                try {
                    const serverLogPath = path.join(__dirname, 'server.log');
                    if (fs.existsSync(serverLogPath)) {
                        let lines = fs.readFileSync(serverLogPath, 'utf8').split('\n');
                        lines = filterLinesByDate(lines, since, until);
                        const lastLines = lines.slice(-limit).join('\n');
                        if (isDownload) {
                            res.setHeader('Content-Disposition', 'attachment; filename=server_fallback.log');
                            res.setHeader('Content-Type', 'text/plain');
                            return res.send(lastLines);
                        } else {
                            return res.json({ 
                                success: true, 
                                logs: `[Fallback server.log karena journalctl gagal: ${err.message}]\n\n` + lastLines 
                            });
                        }
                    }
                } catch (e) {}
                return res.status(500).json({ success: false, error: err.message, stderr });
            }
            if (isDownload) {
                res.setHeader('Content-Disposition', 'attachment; filename=journalctl_sispala_stack.log');
                res.setHeader('Content-Type', 'text/plain');
                res.send(stdout);
            } else {
                res.json({ success: true, logs: stdout });
            }
        });
    } else {
        let logFile = '';
        if (source === 'server') {
            logFile = 'server.log';
        } else if (source === 'cleanup') {
            logFile = 'cleanup.log';
        } else if (source === 'cam1') {
            logFile = 'cam1.log';
        } else if (source === 'cam2') {
            logFile = 'cam2.log';
        } else if (source === 'cam3') {
            logFile = 'cam3.log';
        } else if (source === 'cam4') {
            logFile = 'cam4.log';
        } else {
            return res.status(400).json({ success: false, message: 'Source log tidak valid.' });
        }

        const logPath = path.join(__dirname, logFile);
        if (!fs.existsSync(logPath)) {
            if (isDownload) {
                return res.status(404).send(`File log ${logFile} tidak ditemukan.`);
            }
            return res.json({ success: true, logs: `File log ${logFile} belum ada atau masih kosong.` });
        }

        fs.readFile(logPath, 'utf8', (err, data) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            let lines = data.split('\n');
            
            // Filter data log berdasarkan rentang tanggal
            lines = filterLinesByDate(lines, since, until);
            
            // Batasi baris log yang akan dikirim ke client
            const lastLines = lines.slice(-limit).join('\n');
            
            if (isDownload) {
                res.setHeader('Content-Disposition', `attachment; filename=filtered_${logFile}`);
                res.setHeader('Content-Type', 'text/plain');
                res.send(lastLines);
            } else {
                res.json({ success: true, logs: lastLines });
            }
        });
    }
});

// BARU: API untuk Mengambil Log Auto-Cleanup untuk Storage Panel (Terbuka untuk memantau kapasitas)
app.get('/api/cleanup-log', (req, res) => {
    const logPath = path.join(__dirname, 'cleanup.log');
    if (!fs.existsSync(logPath)) {
        return res.json({ success: true, logs: 'Belum ada aktivitas pembersihan otomatis.' });
    }
    fs.readFile(logPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        const lines = data.trim().split('\n');
        const lastLines = lines.slice(-20).join('\n');
        res.json({ success: true, logs: lastLines });
    });
});

// --- API: Ambil Daftar Rekaman ---
app.get('/api/recordings/:cam', (req, res) => {
    const cam = req.params.cam;
    const roots = getRecordingRoots();
    const allFiles = new Set();

    roots.forEach((root) => {
        if (root.isMounted) {
            const dir = path.join(root.basePath, cam);
            if (fs.existsSync(dir)) {
                try {
                    const files = fs.readdirSync(dir);
                    files.forEach((file) => {
                        if (file.endsWith('.mp4')) {
                            allFiles.add(file);
                        }
                    });
                } catch (err) {
                    console.error(`Gagal membaca rekaman dari ${dir}:`, err);
                }
            }
        }
    });

    const sorted = Array.from(allFiles).sort().reverse();
    res.json(sorted);
});

const preferredMounts = ['/home/sispala/archive', '/mnt/ext'];
let cachedStorageStats = null;
let storageHistory = [];
const MAX_HISTORY = 12; // 12 samples * 10 seconds = 120 seconds (2 minutes) window
let cachedRecordingsBytes = {};
let lastDuTime = {};

function readMounts() {
    const data = fs.readFileSync('/proc/mounts', 'utf8');
    return data
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const parts = line.split(' ');
            return {
                source: parts[0],
                mountPoint: parts[1],
                fsType: parts[2]
            };
        });
}

function isEligibleMount(mount) {
    const badTypes = new Set([
        'tmpfs',
        'devtmpfs',
        'proc',
        'sysfs',
        'cgroup',
        'cgroup2',
        'overlay',
        'squashfs',
        'tracefs',
        'fusectl',
        'debugfs'
    ]);
    if (!mount.mountPoint.startsWith('/mnt/') && !mount.mountPoint.startsWith('/media/') && !mount.mountPoint.startsWith('/run/media/')) return false;
    if (!mount.source.startsWith('/dev/')) return false;
    if (badTypes.has(mount.fsType)) return false;
    return true;
}

function makeRootId(mountPoint) {
    return `mnt-${mountPoint.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function getRecordingRoots() {
    const roots = [];
    const mounts = readMounts();
    const mountMap = new Map(mounts.map((m) => [m.mountPoint, m]));

    const localBase = recordingsRoot;
    roots.push({
        id: 'local',
        label: 'Recordings',
        basePath: localBase,
        mountPoint: localBase,
        source: 'local',
        fsType: 'dir',
        isPreferred: true,
        isMounted: true
    });

    preferredMounts.forEach((mountPoint) => {
        let info = mountMap.get(mountPoint);
        let isMounted = Boolean(info);

        // Special check for /home/sispala/archive directory presence on /dev/sda2
        if (mountPoint === '/home/sispala/archive') {
            const exists = fs.existsSync(mountPoint);
            isMounted = exists;
            if (exists) {
                // Find parent mount to get correct partition info (usually / or /home)
                info = mountMap.get('/') || mountMap.get('/home') || { source: '/dev/sda2', fsType: 'ext4' };
            }
        }

        roots.push({
            id: makeRootId(mountPoint),
            label: mountPoint.startsWith('/mnt/') ? mountPoint.replace('/mnt/', 'mnt/') : (mountPoint.startsWith('/run/media/') ? mountPoint.replace('/run/media/', 'run/media/') : mountPoint),
            basePath: mountPoint === '/home/sispala/archive' ? mountPoint : path.join(mountPoint, recordingsDirName),
            mountPoint,
            source: info ? info.source : 'unknown',
            fsType: info ? info.fsType : 'unknown',
            isPreferred: true,
            isMounted: isMounted
        });
    });

    mounts
        .filter(isEligibleMount)
        .forEach((mount) => {
            if (preferredMounts.includes(mount.mountPoint)) return;
            roots.push({
                id: makeRootId(mount.mountPoint),
                label: mount.mountPoint.replace('/mnt/', 'mnt/').replace('/media/', 'media/').replace('/run/media/', 'run/media/'),
                basePath: path.join(mount.mountPoint, recordingsDirName),
                mountPoint: mount.mountPoint,
                source: mount.source,
                fsType: mount.fsType,
                isPreferred: false,
                isMounted: true
            });
        });

    return roots;
}

function execCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
            if (err) return reject(err);
            if (stderr) return reject(new Error(stderr));
            resolve(stdout);
        });
    });
}

function parseDfOutput(output) {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return null;
    const dataLine = lines[1].trim();
    const parts = dataLine.split(/\s+/);
    if (parts.length < 7) return null;

    const source = parts[0];
    const fsType = parts[1];
    const sizeBytes = Number(parts[2]);
    const usedBytes = Number(parts[3]);
    const availBytes = Number(parts[4]);
    const percentUsed = Number(parts[5].replace('%', ''));
    const mountPoint = parts[6];

    if ([sizeBytes, usedBytes, availBytes, percentUsed].some(n => Number.isNaN(n))) return null;
    return { source, fsType, sizeBytes, usedBytes, availBytes, percentUsed, mountPoint };
}

async function getDiskStatsForRoot(root) {
    const recordingsPath = root.basePath;
    const mountPath = root.mountPoint || recordingsPath;
    const hasMount = root.isMounted || root.id === 'local';
    const hasRecordings = fs.existsSync(recordingsPath);

    let df = null;
    if (hasMount) {
        const dfCmd = `df -B1 --output=source,fstype,size,used,avail,pcent,target "${mountPath}"`;
        try {
            const dfRaw = await execCommand(dfCmd);
            df = parseDfOutput(dfRaw);
        } catch (err) {
            console.error(`Failed to run df for ${mountPath}:`, err.message);
        }
    }

    let recSizeBytes = cachedRecordingsBytes[root.id] || 0;
    const now = Date.now();
    const shouldRunDu = !lastDuTime[root.id] || (now - lastDuTime[root.id] > 30000); // 30 seconds cache

    if (hasRecordings && shouldRunDu) {
        const duCmd = `du -sb "${recordingsPath}"`;
        try {
            const duRaw = await execCommand(duCmd);
            const duParts = duRaw.trim().split(/\s+/);
            recSizeBytes = Number(duParts[0]);
            if (Number.isNaN(recSizeBytes)) recSizeBytes = 0;
            cachedRecordingsBytes[root.id] = recSizeBytes;
            lastDuTime[root.id] = now;
        } catch (err) {
            console.error(`Failed to run du for ${recordingsPath}:`, err.message);
        }
    }

    return {
        id: root.id,
        label: root.label,
        recordingsPath,
        mountPoint: root.mountPoint,
        source: df ? df.source : root.source,
        fsType: df ? df.fsType : root.fsType,
        sizeBytes: df ? df.sizeBytes : 0,
        usedBytes: df ? df.usedBytes : 0,
        availBytes: df ? df.availBytes : 0,
        percentUsed: df ? df.percentUsed : 0,
        recordingsBytes: recSizeBytes,
        isMounted: hasMount,
        isPreferred: root.isPreferred
    };
}

async function getStorageStats() {
    const roots = getRecordingRoots();
    const disks = await Promise.all(roots.map((root) => getDiskStatsForRoot(root)));

    const totals = { sizeBytes: 0, usedBytes: 0, availBytes: 0, recordingsBytes: 0 };
    const seenSources = new Set();

    for (const disk of disks) {
        totals.recordingsBytes += disk.recordingsBytes;

        const source = disk.source;
        if (disk.isMounted && source && source !== 'unknown' && source !== 'local') {
            if (!seenSources.has(source)) {
                seenSources.add(source);
                totals.sizeBytes += disk.sizeBytes;
                totals.usedBytes += disk.usedBytes;
                totals.availBytes += disk.availBytes;
            }
        } else if (source === 'local') {
            if (!seenSources.has(source)) {
                seenSources.add(source);
                totals.sizeBytes += disk.sizeBytes;
                totals.usedBytes += disk.usedBytes;
                totals.availBytes += disk.availBytes;
            }
        }
    }

    const nowMs = Date.now();
    const currentRecordingsBytes = totals.recordingsBytes;

    storageHistory.push({ timestamp: nowMs, recordingsBytes: currentRecordingsBytes });
    if (storageHistory.length > MAX_HISTORY) {
        storageHistory.shift();
    }

    let writeRateBps = 0;
    if (storageHistory.length > 1) {
        let totalPositiveBytes = 0;
        let totalPositiveSeconds = 0;
        for (let i = 1; i < storageHistory.length; i++) {
            const deltaBytes = storageHistory[i].recordingsBytes - storageHistory[i - 1].recordingsBytes;
            const deltaSeconds = (storageHistory[i].timestamp - storageHistory[i - 1].timestamp) / 1000;
            if (deltaSeconds > 0) {
                if (deltaBytes >= 0) {
                    totalPositiveBytes += deltaBytes;
                    totalPositiveSeconds += deltaSeconds;
                }
            }
        }
        if (totalPositiveSeconds > 0) {
            writeRateBps = totalPositiveBytes / totalPositiveSeconds;
        }
    }

    let etaSeconds = null;
    if (writeRateBps && writeRateBps > 0 && totals.availBytes > 0) {
        etaSeconds = totals.availBytes / writeRateBps;
    }

    const percentUsed = totals.sizeBytes > 0
        ? Math.round((totals.usedBytes / totals.sizeBytes) * 100)
        : 0;

    const missingMounts = disks
        .filter((disk) => disk.isPreferred && !disk.isMounted)
        .map((disk) => disk.mountPoint);

    return {
        filesystem: disks.length === 1 ? disks[0].source : 'Multiple',
        mountPoint: disks.length === 1 ? disks[0].mountPoint : 'Multiple',
        sizeBytes: totals.sizeBytes,
        usedBytes: totals.usedBytes,
        availBytes: totals.availBytes,
        percentUsed,
        recordingsBytes: totals.recordingsBytes,
        writeRateBps,
        etaSeconds,
        disks,
        missingMounts,
        updatedAt: new Date(nowMs).toLocaleString()
    };
}

async function updateStorageStats() {
    try {
        cachedStorageStats = await getStorageStats();
    } catch (err) {
        console.error('Failed to update storage stats in background:', err.message);
    }
}

function startStorageMonitor() {
    // Run initial update immediately
    updateStorageStats();
    // Schedule background updates every 10 seconds
    setInterval(updateStorageStats, 10000);
}

// --- API: Storage Stats (Capacity + Throughput + ETA) ---
app.get('/api/storage-stats', async (req, res) => {
    try {
        if (!cachedStorageStats) {
            await updateStorageStats();
        }
        res.json(cachedStorageStats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read storage stats' });
    }
});

// --- AUDIO LIBRARY CONFIGURATION ---
const AUDIO_DIR = '/home/sispala/audio';
if (!fs.existsSync(AUDIO_DIR)) {
    try {
        fs.mkdirSync(AUDIO_DIR, { recursive: true });
    } catch (err) {
        console.error(`Failed to create directory ${AUDIO_DIR}:`, err.message);
        // Fallback locally if we can't write to /home/sispala/audio (e.g. Windows debugging)
        const localAudioDir = path.join(__dirname, 'audio_library');
        fs.mkdirSync(localAudioDir, { recursive: true });
        global.AUDIO_DIR_PATH = localAudioDir;
    }
}
const AUDIO_DIR_PATH = global.AUDIO_DIR_PATH || AUDIO_DIR;

const AUDIO_CONFIG_FILE = path.join(__dirname, 'audio_config.json');
function readAudioConfig() {
    if (!fs.existsSync(AUDIO_CONFIG_FILE)) {
        const defaultConfig = {
            alarmFile: 'Alarm.mpeg',
            sirineFile: 'Alarm.mpeg',
            masterVolume: 100
        };
        fs.writeFileSync(AUDIO_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }
    try {
        return JSON.parse(fs.readFileSync(AUDIO_CONFIG_FILE, 'utf8'));
    } catch (e) {
        return {
            alarmFile: 'Alarm.mpeg',
            sirineFile: 'Alarm.mpeg',
            masterVolume: 100
        };
    }
}

function saveAudioConfig(config) {
    try {
        fs.writeFileSync(AUDIO_CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error("Gagal menyimpan konfigurasi audio ke file audio_config.json:", err.message);
    }
}

function setSystemVolume(vol) {
    // Try pactl (PulseAudio/PipeWire) first
    exec(`pactl set-sink-volume @DEFAULT_SINK@ ${vol}%`, (err) => {
        if (err) {
            // Fallback to amixer targeting PCH card Master channel directly
            exec(`amixer -c PCH sset Master ${vol}%`, (err2) => {
                if (err2) {
                    // Fallback to amixer targeting default card Master channel
                    exec(`amixer sset Master ${vol}%`, (err3) => {
                        if (err3) {
                            console.error(`[Volume Sync Error]: Failed to set system volume: ${err3.message}`);
                        }
                    });
                }
            });
        }
    });
}

// Multer Storage Configuration
const multer = require('multer');
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, AUDIO_DIR_PATH);
    },
    filename: (req, file, cb) => {
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${Date.now()}-${cleanName}`);
    }
});
const audioUpload = multer({
    storage: audioStorage,
    fileFilter: (req, file, cb) => {
        const allowedExtensions = ['.mp3', '.wav', '.mpeg', '.ogg', '.m4a', '.mp4'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Format file audio tidak didukung. Gunakan .mp3, .wav, .mpeg, .ogg, atau .m4a.'));
        }
    },
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

function requireSuperadmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'superadmin') {
        next();
    } else {
        res.status(403).json({ error: 'Unauthorized: Akses dibatasi untuk Superadmin saja.' });
    }
}

// Helper to resolve the correct path for a configured audio file
function getAudioFilePath(filename) {
    if (!filename) return null;
    if (filename === 'Alarm.mpeg' && fs.existsSync(path.join(__dirname, 'Alarm.mpeg'))) {
        return path.join(__dirname, 'Alarm.mpeg');
    }
    const pathInLib = path.join(AUDIO_DIR_PATH, filename);
    if (fs.existsSync(pathInLib)) {
        return pathInLib;
    }
    // Fallback to Alarm.mpeg locally if not found
    if (fs.existsSync(path.join(__dirname, 'Alarm.mpeg'))) {
        return path.join(__dirname, 'Alarm.mpeg');
    }
    return null;
}

// --- AUDIO LIBRARY API ENDPOINTS (SUPERADMIN ONLY) ---

// 1. Get current audio config
app.get('/api/audio/config', requireSuperadmin, (req, res) => {
    res.json({ success: true, config: readAudioConfig() });
});

// 2. Update audio config
app.post('/api/audio/config', requireSuperadmin, (req, res) => {
    const { alarmFile, sirineFile, masterVolume } = req.body;
    const config = readAudioConfig();
    if (alarmFile !== undefined) config.alarmFile = alarmFile;
    if (sirineFile !== undefined) config.sirineFile = sirineFile;
    if (masterVolume !== undefined) {
        const vol = parseInt(masterVolume);
        if (!isNaN(vol) && vol >= 0 && vol <= 100) {
            config.masterVolume = vol;
            setSystemVolume(vol);
        }
    }
    saveAudioConfig(config);
    res.json({ success: true, message: 'Konfigurasi audio berhasil diperbarui!', config });
});

// 3. Upload audio file
app.post('/api/audio/upload', requireSuperadmin, (req, res) => {
    audioUpload.single('audioFile')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Silakan pilih file audio untuk diunggah!' });
        }
        res.json({ success: true, message: `File audio "${req.file.filename}" berhasil diunggah!`, filename: req.file.filename });
    });
});

// 4. List all audio files
app.get('/api/audio/list', requireSuperadmin, (req, res) => {
    try {
        const files = fs.readdirSync(AUDIO_DIR_PATH);
        const audioFiles = [];
        
        // Include default Alarm.mpeg in the list if it exists
        const localAlarmPath = path.join(__dirname, 'Alarm.mpeg');
        if (fs.existsSync(localAlarmPath)) {
            const stats = fs.statSync(localAlarmPath);
            audioFiles.push({
                filename: 'Alarm.mpeg',
                size: stats.size,
                mtime: stats.mtime,
                isDefault: true
            });
        }
        
        files.forEach(file => {
            if (file === 'Alarm.mpeg') return;
            const filePath = path.join(AUDIO_DIR_PATH, file);
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
                audioFiles.push({
                    filename: file,
                    size: stats.size,
                    mtime: stats.mtime,
                    isDefault: false
                });
            }
        });
        
        audioFiles.sort((a, b) => b.mtime - a.mtime);
        res.json({ success: true, files: audioFiles });
    } catch (e) {
        res.status(500).json({ error: 'Gagal membaca library audio: ' + e.message });
    }
});

// 5. Delete an audio file
app.delete('/api/audio/:filename', requireSuperadmin, (req, res) => {
    const filename = req.params.filename;
    if (filename === 'Alarm.mpeg') {
        return res.status(400).json({ error: 'File default Alarm.mpeg tidak dapat dihapus!' });
    }
    const filePath = path.join(AUDIO_DIR_PATH, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File audio tidak ditemukan.' });
    }
    try {
        fs.unlinkSync(filePath);
        res.json({ success: true, message: `File audio "${filename}" berhasil dihapus!` });
    } catch (e) {
        res.status(500).json({ error: 'Gagal menghapus file: ' + e.message });
    }
});

// Global state to track active speaker broadcast
let activeBroadcast = {
    proc: null,
    filename: null,
    isPaused: false
};

// Function to stop current broadcast and wait briefly to release audio resources
function stopActiveBroadcast() {
    return new Promise((resolve) => {
        if (activeBroadcast.proc) {
            try {
                activeBroadcast.proc.kill('SIGKILL');
            } catch (e) {}
            setTimeout(() => {
                activeBroadcast.proc = null;
                activeBroadcast.filename = null;
                activeBroadcast.isPaused = false;
                resolve();
            }, 250); // 250ms delay for OS to clean up process and release ALSA device
        } else {
            resolve();
        }
    });
}

// 6. Play broadcast on server speakers
app.post('/api/audio/play', requireSuperadmin, (req, res) => {
    const { filename, channel } = req.body;
    if (!filename) {
        return res.status(400).json({ error: 'Filename harus diisi.' });
    }

    const filePath = getAudioFilePath(filename);
    if (!filePath) {
        return res.status(404).json({ error: 'File audio tidak ditemukan di server.' });
    }

    const config = readAudioConfig();
    const volume = config.masterVolume || 100;
    
    // Choose channel filter: stereo, left, right
    let mpvArgs = `--no-video --volume=${volume}`;
    if (channel === 'left') {
        mpvArgs += ` --af=lavfi="[pan=stereo|c0=c0|c1=0*c0]"`;
    } else if (channel === 'right') {
        mpvArgs += ` --af=lavfi="[pan=stereo|c0=0*c0|c1=c0]"`;
    }

    const command = `mpv ${mpvArgs} "${filePath}"`;
    console.log(`Menjalankan broadcast: ${command}`);

    stopActiveBroadcast().then(() => {
        const proc = exec(command, (error) => {
            if (error && !proc.killed) {
                console.error(`[MPV Broadcast Error]: ${error.message}`);
            }
            if (activeBroadcast.proc === proc) {
                activeBroadcast.proc = null;
                activeBroadcast.filename = null;
                activeBroadcast.isPaused = false;
            }
        });

        activeBroadcast.proc = proc;
        activeBroadcast.filename = filename;
        activeBroadcast.isPaused = false;

        res.json({ success: true, message: `Memulai broadcast "${filename}"...`, filename });
    });
});

// 7. Pause broadcast (SIGSTOP)
app.post('/api/audio/pause', requireSuperadmin, (req, res) => {
    if (!activeBroadcast.proc) {
        return res.status(400).json({ error: 'Tidak ada broadcast yang sedang berjalan.' });
    }
    if (activeBroadcast.isPaused) {
        return res.status(400).json({ error: 'Broadcast sudah di-pause.' });
    }
    try {
        activeBroadcast.proc.kill('SIGSTOP');
        activeBroadcast.isPaused = true;
        res.json({ success: true, message: 'Broadcast di-pause.' });
    } catch (e) {
        res.status(500).json({ error: 'Gagal mem-pause broadcast: ' + e.message });
    }
});

// 8. Resume broadcast (SIGCONT)
app.post('/api/audio/resume', requireSuperadmin, (req, res) => {
    if (!activeBroadcast.proc) {
        return res.status(400).json({ error: 'Tidak ada broadcast yang sedang berjalan.' });
    }
    if (!activeBroadcast.isPaused) {
        return res.status(400).json({ error: 'Broadcast tidak sedang di-pause.' });
    }
    try {
        activeBroadcast.proc.kill('SIGCONT');
        activeBroadcast.isPaused = false;
        res.json({ success: true, message: 'Broadcast dilanjutkan.' });
    } catch (e) {
        res.status(500).json({ error: 'Gagal melanjutkan broadcast: ' + e.message });
    }
});

// 9. Stop broadcast
app.post('/api/audio/stop', requireSuperadmin, (req, res) => {
    if (!activeBroadcast.proc) {
        return res.json({ success: true, message: 'Tidak ada broadcast yang aktif.' });
    }
    try {
        activeBroadcast.proc.kill('SIGKILL');
        activeBroadcast.proc = null;
        activeBroadcast.filename = null;
        activeBroadcast.isPaused = false;
        res.json({ success: true, message: 'Broadcast dihentikan.' });
    } catch (e) {
        res.status(500).json({ error: 'Gagal menghentikan broadcast: ' + e.message });
    }
});

// --- API: Trigger Alarm (Mock) ---
app.get('/api/trigger-alarm', (req, res) => {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin')) {
        console.log(`Alarm CH1 dipicu oleh: ${req.session.user.username}`);

        const config = readAudioConfig();
        const alarmFile = getAudioFilePath(config.alarmFile);

        if (!alarmFile) {
            console.error("[MPV CH1 Error]: Audio file not found.");
            return res.status(404).json({ error: "File audio alarm tidak ditemukan." });
        }

        const volume = config.masterVolume || 100;
        const command = `mpv --no-video --volume=${volume} --af=lavfi="[pan=stereo|c0=c0|c1=0*c0]" "${alarmFile}"`;

        stopActiveBroadcast().then(() => {
            const proc = exec(command, (error) => {
                if (error && !proc.killed) {
                    console.error(`[MPV CH1 Error]: ${error.message}`);
                }
                if (activeBroadcast.proc === proc) {
                    activeBroadcast.proc = null;
                    activeBroadcast.filename = null;
                    activeBroadcast.isPaused = false;
                }
            });

            activeBroadcast.proc = proc;
            activeBroadcast.filename = config.alarmFile;
            activeBroadcast.isPaused = false;
        });

        res.json({ success: true, message: "Alarm (Channel 1) berhasil dibunyikan!" });
    } else {
        res.status(403).json({ error: "Unauthorized: Akses ditolak." });
    }
});

app.get('/api/trigger-sirine', (req, res) => {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin')) {
        console.log(`Sirine CH2 dipicu oleh: ${req.session.user.username}`);

        const config = readAudioConfig();
        const sirineFile = getAudioFilePath(config.sirineFile);

        if (!sirineFile) {
            console.error("[MPV CH2 Error]: Audio file not found.");
            return res.status(404).json({ error: "File audio sirine tidak ditemukan." });
        }

        const volume = config.masterVolume || 100;
        const command = `mpv --no-video --volume=${volume} --af=lavfi="[pan=stereo|c0=0*c0|c1=c0]" "${sirineFile}"`;

        stopActiveBroadcast().then(() => {
            const proc = exec(command, (error) => {
                if (error && !proc.killed) {
                    console.error(`[MPV CH2 Error]: ${error.message}`);
                }
                if (activeBroadcast.proc === proc) {
                    activeBroadcast.proc = null;
                    activeBroadcast.filename = null;
                    activeBroadcast.isPaused = false;
                }
            });

            activeBroadcast.proc = proc;
            activeBroadcast.filename = config.sirineFile;
            activeBroadcast.isPaused = false;
        });

        res.json({ success: true, message: "Sirine (Channel 2) berhasil dibunyikan!" });
    } else {
        res.status(403).json({ error: "Unauthorized: Akses ditolak." });
    }
});

// --- SOCKET.IO: Jembatan Data AI ---
io.on('connection', (socket) => {
    console.log('Client/Detector terhubung ke Socket.io');

    // Menerima data koordinat dari detector.py
    socket.on('detection', (payload) => {
        io.emit('update-overlay', payload);
    });
});

// --- START SERVER ---
const PORT = 8000;
startStorageMonitor();

// Initialize ALSA/PipeWire hardware volume from configuration on startup
try {
    const startupConfig = readAudioConfig();
    const startupVol = startupConfig.masterVolume !== undefined ? startupConfig.masterVolume : 100;
    setSystemVolume(startupVol);
} catch (e) {
    console.error(`Failed to initialize startup volume: ${e.message}`);
}

http.listen(PORT, () => {
    console.log(`CCTV Monitoring Server berjalan di http://localhost:${PORT}`);
});