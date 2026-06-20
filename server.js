const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const session = require('express-session');
const bodyParser = require('body-parser');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'sispala-secret-key',
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
        // Jika file belum ada, otomatis buat baru dengan akun default bawaan Anda
        const defaultUsers = [
            { username: 'superadmin', password: 'superpassword', role: 'superadmin' }, 
            { username: 'Sispala', password: 'rezacoli', role: 'admin' },
            { username: 'warga_admin', password: 'admin', role: 'admin' },
            { username: 'warga', password: 'sehatselalu', role: 'guest' }
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

// Helper internal untuk menulis kembali/menyimpan data users ke file JSON
function saveUsers(usersData) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));
}

// File penyimpanan Log Aktivitas Login/Logout
const LOG_FILE = path.join(__dirname, 'login_logs.json');

// Helper internal untuk mencatat aktivitas login/logout ke JSON
function writeLog(username, role, action) {
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
    
    logs.push({ username, role, action, timestamp });
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
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
                return res.sendFile(filePath);
            }
        }
    }
    res.status(404).send('File rekaman tidak ditemukan di drive manapun.');
});

// DIUBAH: Login sekarang membaca data akun dari file JSON lokal
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // Mengambil data user terbaru dari database file JSON
    const users = readUsers();
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
        req.session.user = { username: user.username, role: user.role };
        
        // CATAT LOG LOGIN
        writeLog(user.username, user.role, 'LOGIN');
        
        res.json({ success: true, role: user.role });
    } else {
        res.status(401).json({ success: false, message: 'Username atau Password salah' });
    }
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

    // Ambil data users saat ini
    const users = readUsers();

    if (users.find(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
        return res.json({ success: false, message: 'Username sudah terdaftar!' });
    }

    // Menambahkan akun baru dan menyimpannya secara permanen ke file JSON
    users.push({ username: newUsername, password: newPassword, role: newRole });
    saveUsers(users);

    res.json({ success: true, message: `Akun ${newUsername} dengan role [${newRole}] berhasil dibuat!` });
});

// BARU: API untuk Memodifikasi/Mengubah Password dan Role Akun yang Sudah Ada (Hanya untuk Superadmin) -> Diperbarui ke JSON
// BARU: API untuk Mengambil Daftar Username saja untuk Fitur Suggest Dropdown (Hanya untuk Superadmin)

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

// BARU: API untuk Mengambil Daftar Username saja untuk Fitur Suggest Dropdown (Hanya untuk Superadmin)
app.get('/api/users-list', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const users = readUsers();
        // Hanya mengambil properti username untuk alasan keamanan data
        const usernames = users.map(u => u.username);
        res.json({ success: true, usernames });
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

        exec(cmd, (err, stdout, stderr) => {
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
let lastRecSizeBytes = null;
let lastSampleMs = null;

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

    let recSizeBytes = 0;
    if (hasRecordings) {
        const duCmd = `du -sb "${recordingsPath}"`;
        try {
            const duRaw = await execCommand(duCmd);
            const duParts = duRaw.trim().split(/\s+/);
            recSizeBytes = Number(duParts[0]);
            if (Number.isNaN(recSizeBytes)) recSizeBytes = 0;
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

    const totals = disks.reduce(
        (acc, disk) => {
            acc.sizeBytes += disk.sizeBytes;
            acc.usedBytes += disk.usedBytes;
            acc.availBytes += disk.availBytes;
            acc.recordingsBytes += disk.recordingsBytes;
            return acc;
        },
        { sizeBytes: 0, usedBytes: 0, availBytes: 0, recordingsBytes: 0 }
    );

    const nowMs = Date.now();
    let writeRateBps = null;
    if (lastRecSizeBytes !== null && lastSampleMs !== null) {
        const deltaBytes = totals.recordingsBytes - lastRecSizeBytes;
        const deltaSeconds = Math.max((nowMs - lastSampleMs) / 1000, 1e-6);
        writeRateBps = Math.max(deltaBytes / deltaSeconds, 0);
    }

    lastRecSizeBytes = totals.recordingsBytes;
    lastSampleMs = nowMs;

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

// --- API: Storage Stats (Capacity + Throughput + ETA) ---
app.get('/api/storage-stats', async (req, res) => {
    try {
        const stats = await getStorageStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read storage stats' });
    }
});

// --- API: Trigger Alarm (Mock) ---
app.get('/trigger-alarm', (req, res) => {
    // DIUBAH: Mengikuti struktur role baru (Hanya role admin yang dapat memicu alarm, superadmin & guest ditolak)
    if (req.session.user && req.session.user.role === 'admin') {
        console.log(`Alarm dipicu oleh admin: ${req.session.user.username}`);
        res.json({ status: "Alarm Active" });
    } else {
        res.status(403).json({ error: "Unauthorized: Hanya admin yang bisa memicu alarm" });
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
http.listen(PORT, () => {
    console.log(`CCTV Monitoring Server berjalan di http://localhost:${PORT}`);
});