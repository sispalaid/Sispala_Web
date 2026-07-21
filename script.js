const streams = [
    { id: 1, name: 'Pak Ramelan' },
    { id: 2, name: 'Pak Yudho 1' },
    { id: 3, name: 'Pak Yudho 2' },
    { id: 4, name: 'Pak RT' }
  ];

  const LIVE_DELAY_SEC = 5;

  let recordingsIndex = [];
  let selectedRecording = null;
  let playbackQueue = [];
  let playbackIndex = -1;
  let continuousPlayback = false;
  let selectedNVRDate = ''; 
  let nvrFilesForDay = []; 
  const jumpState = {
    calendarYear: null,
    calendarMonth: null,
    selectedDate: null,
    availableDates: new Set(),
    mode: 'hour',
    hour: null,
    minute: null,
    second: null,
    meridiem: 'AM'
  };

(function () {
  var EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var COMPRESS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3"/></svg>';

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function requestFs(el) {
    try {
      if (el.requestFullscreen) return el.requestFullscreen();
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
      if (el.webkitRequestFullScreen) return el.webkitRequestFullScreen();
    } catch (e) {}
  }
  function exitFs() {
    try {
      if (document.exitFullscreen) return document.exitFullscreen();
      if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    } catch (e) {}
  }
  function toggleFs(cell) {
    if (fsElement() === cell) { exitFs(); } else { requestFs(cell); }
  }

  function makeButton(cell) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cam-fs-btn';
    btn.setAttribute('aria-label', 'Fullscreen kamera');
    btn.setAttribute('title', 'Fullscreen (ESC untuk keluar)');
    btn.innerHTML = EXPAND_SVG;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleFs(cell);
    });
    return btn;
  }

  function injectInto(cell) {
    if (!cell || cell.querySelector('.cam-fs-btn')) return;
    cell.appendChild(makeButton(cell));
  }

  function injectAll() {
    var cells = document.querySelectorAll('.cam-cell');
    for (var i = 0; i < cells.length; i++) injectInto(cells[i]);
  }

  function updateIcons() {
    var active = fsElement();
    var btns = document.querySelectorAll('.cam-fs-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var cell = btn.closest ? btn.closest('.cam-cell') : null;
      var on = cell && active === cell;
      btn.innerHTML = on ? COMPRESS_SVG : EXPAND_SVG;
      btn.setAttribute('title', on ? 'Keluar fullscreen (ESC)' : 'Fullscreen (ESC untuk keluar)');
    }
  }

  function start() {
    injectAll();
    var grid = document.getElementById('video-grid');
    if (grid && typeof MutationObserver !== 'undefined') {
      new MutationObserver(injectAll).observe(grid, { childList: true });
    }
    // Safety net in case cameras are rendered late by script.js
    var tries = 0;
    var iv = setInterval(function () {
      injectAll();
      if (++tries >= 12) clearInterval(iv);
    }, 700);
  }

  document.addEventListener('fullscreenchange', updateIcons);
  document.addEventListener('webkitfullscreenchange', updateIcons);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

  const grid = document.getElementById('video-grid');
  streams.forEach(stream => {
    grid.innerHTML += `
      <div class="cam-cell">
        <video id="video-${stream.id}" muted playsinline></video>
      </div>
    `;
  });

  let streamsInitialized = false;
  function initializeStreams() {
      if (streamsInitialized) return;
      streamsInitialized = true;

      streams.forEach(stream => {
        const video = document.getElementById(`video-${stream.id}`);
        const url = `./Streams/cam${stream.id}/index.m3u8`;
        if (Hls.isSupported()) {
          const hls = new Hls({
            lowLatencyMode: true,
            liveSyncDuration: LIVE_DELAY_SEC,
            liveMaxLatencyDuration: LIVE_DELAY_SEC + 3,
            backBufferLength: 0,
            maxLiveSyncPlaybackRate: 1.5
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => null);
            applyLiveDelay(video);
            setInterval(() => applyLiveDelay(video), 2000);
          });
        }
      });
  }

  const historyPlayer = document.getElementById('historyPlayer');
  const fileListDiv = document.getElementById('fileList');
  const playingNowSpan = document.getElementById('playing-now');


  // Fungsi Baru untuk Auto-Login sebagai Guest
  // Fungsi Auto-Login sebagai Guest yang Sudah Diperbaiki
async function loginAsGuest() {
    // Menyesuaikan dengan ID element pesan login bawaan di index.html Anda (error-message)
    const msgEl = document.getElementById('error-message') || document.getElementById('login-msg');
    
    if (msgEl) {
        msgEl.style.color = 'var(--accent-2)';
        msgEl.textContent = 'Menghubungkan sebagai Guest...';
    }

    try {
        // Menggunakan akun guest default (username: warga, password: sehatselalu)
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'warga', password: 'sehatselalu' })
        });
        const data = await res.json();

        if (data.success) {
            if (msgEl) {
                msgEl.style.color = 'var(--accent-1)';
                msgEl.textContent = 'Login Guest Berhasil! Memuat halaman...';
            }
            window.location.reload();
        } else {
            if (msgEl) {
                msgEl.style.color = 'var(--accent-3)';
                msgEl.textContent = data.error || 'Gagal login sebagai Guest.';
            }
        }
    } catch (e) {
        if (msgEl) {
            msgEl.style.color = 'var(--accent-3)';
            msgEl.textContent = 'Terjadi kesalahan jaringan.';
        }
    }
}

  async function fetchRecordings() {
    const cam = document.getElementById('camSelect').value;
    fileListDiv.innerHTML = '<div style="padding:10px;">Searching...</div>';

    if (selectedRecording && selectedRecording.cam !== cam) {
      selectedRecording = null;
      playbackIndex = -1;
    }

    try {
      const response = await fetch(`/api/recordings/${cam}`);
      const files = await response.json();
      recordingsIndex = files
        .map((file) => ({ name: file, timestampMs: parseRecordingTimestamp(file) }))
        .filter((file) => file.timestampMs !== null);
      
      recordingsIndex.sort((a, b) => a.timestampMs - b.timestampMs);

      if (recordingsIndex.length === 0) {
        fileListDiv.innerHTML = '<div style="padding:10px; color:orange;">Tidak ada rekaman ditemukan.</div>';
        selectedNVRDate = '';
        drawNVRTimeline();
        return;
      }

      if (!selectedNVRDate) {
        const latest = recordingsIndex[recordingsIndex.length - 1];
        const latestDate = new Date(latest.timestampMs);
        const yyyy = latestDate.getFullYear();
        const mm = String(latestDate.getMonth() + 1).padStart(2, '0');
        const dd = String(latestDate.getDate()).padStart(2, '0');
        selectedNVRDate = `${yyyy}-${mm}-${dd}`;
      }

      playbackQueue = recordingsIndex.filter(file => {
        const date = new Date(file.timestampMs);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}` === selectedNVRDate;
      });

      drawNVRTimeline();

      fileListDiv.innerHTML = '';
      if (playbackQueue.length === 0) {
        fileListDiv.innerHTML = '<div style="padding:10px; color:orange;">Tidak ada rekaman untuk tanggal ini.</div>';
        return;
      }

      playbackQueue.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.filename = file.name;
        
        const date = new Date(file.timestampMs);
        const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        item.innerText = `📁 ${timeStr} - ${file.name}`;
        
        if (selectedRecording && selectedRecording.name === file.name) {
          item.classList.add('selected');
        }
        item.onclick = () => selectRecording(cam, file.name);
        fileListDiv.appendChild(item);
      });

      if (!selectedRecording && playbackQueue.length > 0) {
        selectRecording(cam, playbackQueue[0].name, false);
      }
    } catch (err) {
      console.error(err);
      fileListDiv.innerHTML = '<div style="padding:10px; color:red;">Gagal memuat rekaman.</div>';
    }
  }

  // --- NVR Timeline Functions & State ---
  let isDraggingTimeline = false;
  let dragStartX = 0;
  let dragStartTrackX = 0;
  let currentTrackX = 0;
  let draggedTimeSeconds = 0;



  function alignTimelineToSeconds(seconds) {
    const timelineWrapper = document.getElementById('nvrTimelineWrapper');
    const track = document.getElementById('nvrTimelineTrack');
    if (!timelineWrapper || !track) return;
    
    const viewportWidth = timelineWrapper.clientWidth;
    const trackWidth = viewportWidth * 24; // 1 hour occupies exactly the viewport width (24 hours = 24 * viewportWidth)
    track.style.width = `${trackWidth}px`;

    const pct = seconds / 86400;
    const targetX = pct * trackWidth;
    currentTrackX = (viewportWidth / 2) - targetX;
    
    // Bounds clamping
    currentTrackX = Math.max(viewportWidth / 2 - trackWidth, Math.min(viewportWidth / 2, currentTrackX));
    
    track.style.transform = `translateX(${currentTrackX}px)`;
  }

  function drawNVRTimeline() {
    const track = document.getElementById('nvrTimelineTrack');
    const timelineWrapper = document.getElementById('nvrTimelineWrapper');
    if (!track || !timelineWrapper) return;

    const viewportWidth = timelineWrapper.clientWidth;
    const trackWidth = viewportWidth * 24;
    track.style.width = `${trackWidth}px`;

    track.innerHTML = '';

    // Render ticks every 15 minutes (1 hour = viewportWidth pixels)
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const tick = document.createElement('div');
        tick.className = 'nvr-tick';
        tick.style.left = `${((h + m/60) / 24) * 100}%`;
        tick.innerHTML = `<span>${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</span>`;
        track.appendChild(tick);
      }
    }
    // Final 24:00 tick
    const tick24 = document.createElement('div');
    tick24.className = 'nvr-tick';
    tick24.style.left = `100%`;
    tick24.innerHTML = `<span>24:00</span>`;
    track.appendChild(tick24);

    if (!selectedNVRDate) {
      const dateLabel = document.getElementById('nvr-timeline-date');
      if (dateLabel) dateLabel.textContent = 'Footage: -';
      return;
    }

    playbackQueue.forEach(file => {
      const fileDate = new Date(file.timestampMs);
      const secondsFromMidnight = fileDate.getHours() * 3600 + fileDate.getMinutes() * 60;
      
      const leftPx = (secondsFromMidnight / 86400) * trackWidth;
      const widthPx = (60 / 86400) * trackWidth; // 1 minute segment size

      const block = document.createElement('div');
      block.className = 'nvr-record-block';
      block.style.left = `${leftPx}px`;
      block.style.width = `${Math.max(widthPx, 2)}px`; // Keep it visible even if tiny
      
      const timeLabel = `${String(fileDate.getHours()).padStart(2, '0')}:${String(fileDate.getMinutes()).padStart(2, '0')}`;
      block.title = `${timeLabel} - ${file.name}`;
      
      track.appendChild(block);
    });

    const dateLabel = document.getElementById('nvr-timeline-date');
    if (dateLabel) {
      dateLabel.textContent = `Footage: ${selectedNVRDate}`;
    }

    // Sync track scroll position to current video playback time
    if (selectedRecording) {
      const file = playbackQueue.find(f => f.name === selectedRecording.name);
      if (file) {
        const currentMs = file.timestampMs + (historyPlayer.currentTime * 1000);
        updatePlayhead(currentMs);
      } else {
        alignTimelineToSeconds(0);
      }
    } else {
      alignTimelineToSeconds(0);
    }
  }

  function updatePlayhead(timestampMs) {
    const date = new Date(timestampMs);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    const secondsFromMidnight = hours * 3600 + minutes * 60 + seconds;
    
    // Slide track underneath center needle
    if (!isDraggingTimeline) {
      alignTimelineToSeconds(secondsFromMidnight);
    }
  }

  function handleTimelineSeek(e) {
    const timelineWrapper = document.getElementById('nvrTimelineWrapper');
    if (!timelineWrapper || !selectedNVRDate) return;

    const rect = timelineWrapper.getBoundingClientRect();
    let clientX = 0;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }
    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const pct = offsetX / rect.width;

    const totalSecInDay = 86400;
    const targetSeconds = pct * totalSecInDay;

    seekToTimeOfDay(targetSeconds);
  }

  function seekToTimeOfDay(secondsFromMidnight) {
    if (!selectedNVRDate) return;
    const [year, month, day] = selectedNVRDate.split('-').map(Number);
    const targetMs = new Date(year, month - 1, day, 0, 0, 0).getTime() + (secondsFromMidnight * 1000);

    const segmentDurationMs = 60000;
    let targetFile = playbackQueue.find(file => {
      return targetMs >= file.timestampMs && targetMs <= (file.timestampMs + segmentDurationMs);
    });

    if (targetFile) {
      const offsetSec = (targetMs - targetFile.timestampMs) / 1000;
      playFileAtOffset(targetFile.name, offsetSec);
    } else {
      let nextFile = null;
      let smallestDiff = Number.POSITIVE_INFINITY;
      playbackQueue.forEach(file => {
        const diff = file.timestampMs - targetMs;
        if (diff > 0 && diff < smallestDiff) {
          smallestDiff = diff;
          nextFile = file;
        }
      });

      if (nextFile) {
        playFileAtOffset(nextFile.name, 0);
      }
    }
  }

  function playFileAtOffset(filename, offsetSec) {
    const cam = document.getElementById('camSelect').value;
    
    if (!selectedRecording || selectedRecording.name !== filename) {
      selectedRecording = { cam, name: filename, timestampMs: parseRecordingTimestamp(filename) };
      playbackIndex = playbackQueue.findIndex((item) => item.name === filename);
      
      setRecordingsSource(cam, filename);
      updateSelectedUI(filename);
      
      playingNowSpan.innerText = `Playing: ${cam} - ${filename}`;
      playingNowSpan.style.color = '#9fd9ff';
      
      const onCanPlay = () => {
        historyPlayer.currentTime = offsetSec;
        historyPlayer.play().catch(() => {});
        historyPlayer.removeEventListener('canplay', onCanPlay);
      };
      historyPlayer.addEventListener('canplay', onCanPlay);
    } else {
      historyPlayer.currentTime = offsetSec;
      historyPlayer.play().catch(() => {});
    }
  }

  function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eye-icon');
    
    if (passwordInput.type === 'password') {
        // Ubah jadi teks biasa agar kelihatan
        passwordInput.type = 'text';
        
        // Ganti SVG ke ikon Mata Dicoret (Eye-off)
        eyeIcon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
    } else {
        // Kembalikan jadi password tersembunyi
        passwordInput.type = 'password';
        
        // Ganti kembali ke ikon Mata Terbuka
        eyeIcon.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
}

  function parseRecordingTimestamp(filename) {
    const match = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    return new Date(year, month, day, hour, minute).getTime();
  }

  async function openJumpModal() {
    await fetchRecordings();
    const modal = document.getElementById('jump-modal');
    if (modal) modal.style.display = 'flex';
    initCalendar();
    initClock();
  }

  function filterUserTable() {
    // Ambil teks yang diketik dan ubah ke huruf kecil semua (case-insensitive)
    const input = document.getElementById('search-username');
    const filter = input.value.toLowerCase();
    
    const tbody = document.getElementById('table-users-body');
    const rows = tbody.getElementsByTagName('tr');

    // Looping semua baris di dalam tbody
    for (let i = 0; i < rows.length; i++) {
        // Ambil kolom pertama (indeks 0) yang berisi Username
        const usernameCell = rows[i].getElementsByTagName('td')[0];
        
        if (usernameCell) {
            const usernameText = usernameCell.textContent || usernameCell.innerText;
            
            // Jika teks kecocokan ditemukan, tampilkan barisnya. Jika tidak, sembunyikan.
            if (usernameText.toLowerCase().indexOf(filter) > -1) {
                rows[i].style.display = "";
            } else {
                rows[i].style.display = "none";
            }
        }
    }
}

  function closeJumpModal() {
    const modal = document.getElementById('jump-modal');
    if (modal) modal.style.display = 'none';
  }

  function initCalendar() {
    jumpState.availableDates = new Set(
      recordingsIndex.map((file) => {
        const date = new Date(file.timestampMs);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      })
    );

    const now = new Date();
    jumpState.calendarYear = now.getFullYear();
    jumpState.calendarMonth = now.getMonth();
    jumpState.selectedDate = null;
    renderCalendar();
  }

  function renderCalendar() {
    const titleEl = document.getElementById('calendar-title');
    const gridEl = document.getElementById('calendar-grid');
    if (!gridEl) return;

    const year = jumpState.calendarYear;
    const month = jumpState.calendarMonth;
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = first.toLocaleString(undefined, { month: 'long' });
    if (titleEl) titleEl.textContent = `${monthName} ${year}`;

    gridEl.innerHTML = '';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day) => {
      const label = document.createElement('div');
      label.className = 'calendar-day';
      label.textContent = day;
      gridEl.appendChild(label);
    });

    const totalSlots = 42;
    for (let i = 0; i < totalSlots; i += 1) {
      const dateNum = i - startDay + 1;
      const cell = document.createElement('div');
      cell.className = 'calendar-date';

      if (dateNum < 1 || dateNum > daysInMonth) {
        cell.classList.add('disabled');
        gridEl.appendChild(cell);
        continue;
      }

      const mm = String(month + 1).padStart(2, '0');
      const dd = String(dateNum).padStart(2, '0');
      const key = `${year}-${mm}-${dd}`;
      cell.textContent = dateNum;

      if (jumpState.availableDates.has(key)) cell.classList.add('available');
      if (jumpState.selectedDate === key) cell.classList.add('selected');

      cell.onclick = () => {
        jumpState.selectedDate = key;
        jumpState.mode = 'hour';
        renderCalendar();
        renderClockNumbers();
        const hint = document.getElementById('jump-hint');
        if (hint) hint.textContent = 'Select hour.';
      };

      gridEl.appendChild(cell);
    }
  }

  function prevMonth() {
    if (jumpState.calendarMonth === 0) {
      jumpState.calendarMonth = 11;
      jumpState.calendarYear -= 1;
    } else {
      jumpState.calendarMonth -= 1;
    }
    renderCalendar();
  }

  function nextMonth() {
    if (jumpState.calendarMonth === 11) {
      jumpState.calendarMonth = 0;
      jumpState.calendarYear += 1;
    } else {
      jumpState.calendarMonth += 1;
    }
    renderCalendar();
  }

  function initClock() {
    jumpState.mode = 'hour';
    jumpState.hour = null;
    jumpState.minute = null;
    jumpState.second = null;
    jumpState.meridiem = 'AM';
    updateMeridiemButtons();
    renderClockNumbers();
    updateClockHands();
    updateTimeDisplay();
    updateTimeInputs();
  }

  function setMeridiem(value) {
    jumpState.meridiem = value;
    updateMeridiemButtons();
    updateTimeDisplay();
  }

  function updateMeridiemButtons() {
    const amBtn = document.getElementById('ampm-am');
    const pmBtn = document.getElementById('ampm-pm');
    if (amBtn) amBtn.classList.toggle('active', jumpState.meridiem === 'AM');
    if (pmBtn) pmBtn.classList.toggle('active', jumpState.meridiem === 'PM');
  }

  function renderClockNumbers() {
    const face = document.getElementById('clock-face');
    if (!face) return;
    const oldNumbers = face.querySelectorAll('.clock-number');
    oldNumbers.forEach((node) => node.remove());

    const values = jumpState.mode === 'hour' ? [12,1,2,3,4,5,6,7,8,9,10,11] : ['00','05','10','15','20','25','30','35','40','45','50','55'];

    values.forEach((value, index) => {
      const angle = (index / 12) * 2 * Math.PI - Math.PI / 2;
      const radius = 74;
      const x = 100 + Math.cos(angle) * radius;
      const y = 100 + Math.sin(angle) * radius;
      const btn = document.createElement('div');
      btn.className = 'clock-number';
      btn.textContent = value;
      btn.style.left = `${x - 14}px`;
      btn.style.top = `${y - 14}px`;

      btn.onclick = () => {
        if (!jumpState.selectedDate) {
          const hint = document.getElementById('jump-hint');
          if (hint) hint.textContent = 'Select a date first.';
          return;
        }

        if (jumpState.mode === 'hour') {
          jumpState.hour = Number(value);
          jumpState.mode = 'minute';
          renderClockNumbers();
          const hint = document.getElementById('jump-hint');
          if (hint) hint.textContent = 'Select minutes.';
        } else {
          jumpState.minute = Number(value);
          confirmJumpTime();
        }
        updateClockHands();
        updateTimeDisplay();
        updateTimeInputs();
      };

      face.appendChild(btn);
    });
  }

  function updateClockHands() {
    const hourHand = document.getElementById('clock-hour');
    const minuteHand = document.getElementById('clock-minute');
    const hour = jumpState.hour || 12;
    const minute = jumpState.minute || 0;
    const hourAngle = ((hour % 12) + minute / 60) * 30;
    const minuteAngle = minute * 6;
    if (hourHand) hourHand.style.transform = `translateY(-50%) rotate(${hourAngle - 90}deg)`;
    if (minuteHand) minuteHand.style.transform = `translateY(-50%) rotate(${minuteAngle - 90}deg)`;
  }

  function updateTimeDisplay() {
    const display = document.getElementById('time-display');
    const hour = jumpState.hour ? String(jumpState.hour).padStart(2, '0') : '--';
    const minute = jumpState.minute !== null ? String(jumpState.minute).padStart(2, '0') : '--';
    const second = jumpState.second !== null ? String(jumpState.second).padStart(2, '0') : '--';
    if (display) display.textContent = `${hour}:${minute}:${second} ${jumpState.meridiem}`;
  }

  function updateTimeInputs() {
    const hourInput = document.getElementById('time-hour');
    const minuteInput = document.getElementById('time-minute');
    const secondInput = document.getElementById('time-second');
    if (hourInput) hourInput.value = jumpState.hour ?? '';
    if (minuteInput) minuteInput.value = jumpState.minute ?? '';
    if (secondInput) secondInput.value = jumpState.second ?? '';
  }

  function handleTypedTime() {
    const hourInput = document.getElementById('time-hour');
    const minuteInput = document.getElementById('time-minute');
    const secondInput = document.getElementById('time-second');
    const hour = Number(hourInput?.value);
    const minute = Number(minuteInput?.value);
    const second = Number(secondInput?.value);

    jumpState.hour = Number.isInteger(hour) && hour >= 1 && hour <= 12 ? hour : null;
    jumpState.minute = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : null;
    jumpState.second = Number.isInteger(second) && second >= 0 && second <= 59 ? second : null;

    updateClockHands();
    updateTimeDisplay();
  }

  function applyTimeInputs() {
    if (!jumpState.selectedDate) {
      const hint = document.getElementById('jump-hint');
      if (hint) hint.textContent = 'Select a date first.';
      return;
    }

    const hourInput = document.getElementById('time-hour');
    const minuteInput = document.getElementById('time-minute');
    const secondInput = document.getElementById('time-second');
    const hour = Number(hourInput?.value);
    const minute = Number(minuteInput?.value);
    const second = Number(secondInput?.value || 0);

    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(second) || second < 0 || second > 59) {
      const hint = document.getElementById('jump-hint');
      if (hint) hint.textContent = 'Use HH 1-12, MM 00-59, SS 00-59.';
      return;
    }

    jumpState.hour = hour;
    jumpState.minute = minute;
    jumpState.second = second;
    jumpState.mode = 'minute';
    updateClockHands();
    updateTimeDisplay();
    renderClockNumbers();
    confirmJumpTime();
  }

  function updateSelectedUI(filename) {
    const items = fileListDiv.querySelectorAll('.file-item');
    items.forEach((item) => item.classList.remove('selected'));
    const target = fileListDiv.querySelector(`[data-filename="${filename}"]`);
    if (target) {
      target.classList.add('selected');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setRecordingsSource(cam, filename) {
    const videoPath = `/recordings/${cam}/${filename}`;
    historyPlayer.src = videoPath;
    historyPlayer.load();
  }

  function selectRecording(cam, filename, autoPlay = false) {
    selectedRecording = { cam, name: filename, timestampMs: parseRecordingTimestamp(filename) };
    playbackIndex = playbackQueue.findIndex((item) => item.name === filename);
    
    setRecordingsSource(cam, filename);
    updateSelectedUI(filename);

    playingNowSpan.innerText = `Ready: ${cam} - ${filename}`;
    playingNowSpan.style.color = '#9fd9ff';

    const onCanPlay = () => {
      historyPlayer.currentTime = 0;
      if (autoPlay) {
        historyPlayer.play().catch(() => {});
      } else {
        historyPlayer.pause();
      }
      historyPlayer.removeEventListener('canplay', onCanPlay);
    };
    historyPlayer.addEventListener('canplay', onCanPlay);
  }

  function confirmJumpTime() {
    if (!jumpState.selectedDate || jumpState.hour === null || jumpState.minute === null) return;
    const [year, month, day] = jumpState.selectedDate.split('-').map(Number);
    let hour = jumpState.hour % 12;
    if (jumpState.meridiem === 'PM') hour += 12;

    const targetMs = new Date(year, month - 1, day, hour, jumpState.minute, jumpState.second || 0).getTime();
    const closest = findClosestRecording(targetMs);
    if (closest) {
      selectedNVRDate = jumpState.selectedDate;
      const offsetSec = Math.max(0, (targetMs - closest.timestampMs) / 1000);
      
      fetchRecordings().then(() => {
        playFileAtOffset(closest.name, offsetSec);
      });
      closeJumpModal();
    } else {
      const hint = document.getElementById('jump-hint');
      if (hint) hint.textContent = 'No recording found for that time.';
    }
  }

  function findClosestRecording(targetMs) {
    let closest = null;
    let smallestDelta = Number.POSITIVE_INFINITY;
    recordingsIndex.forEach((file) => {
      const delta = Math.abs(file.timestampMs - targetMs);
      if (delta < smallestDelta) { smallestDelta = delta; closest = file; }
    });
    return closest;
  }

  function playNextInQueue() {
    if (playbackIndex < 0 || playbackIndex + 1 >= playbackQueue.length) return;
    const next = playbackQueue[playbackIndex + 1];
    playbackIndex += 1;
    playFileAtOffset(next.name, 0);
  }

  function toggleAlarm() {
  fetch('/api/trigger-alarm')
    .then(r => r.json())
    .then(data => {
      const btn = document.getElementById('alarmToggle');
      if (data.error) {
         alert(data.error);
         return;
      }
      btn.classList.add('active');
      btn.innerText = "ALARM AKTIF!";
      setTimeout(() => { 
        btn.classList.remove('active'); 
        btn.innerText = "BUNYIKAN ALARM (CH 1)"; 
      }, 5000);
    });
}

function toggleSirine() {
  fetch('/api/trigger-sirine')
    .then(r => r.json())
    .then(data => {
      const btn = document.getElementById('sirineToggle');
      if (data.error) {
         alert(data.error);
         return;
      }
      btn.classList.add('active');
      btn.innerText = "SIRINE AKTIF!";
      setTimeout(() => { 
        btn.classList.remove('active'); 
        btn.innerText = "BUNYIKAN SIRINE (CH 2)"; 
      }, 5000);
    });
}

  function playVideo(id) { document.getElementById(`video-${id}`).play(); }
  function pauseVideo(id) { document.getElementById(`video-${id}`).pause(); }
  function applyLiveDelay(video) {
    const target = video.duration - LIVE_DELAY_SEC;
    if (!Number.isFinite(target) || target <= 0) return;
    if (video.currentTime > target || video.currentTime < target - 1) { video.currentTime = target; }
  }

  function goLive(id) { 
    const v = document.getElementById(`video-${id}`); 
    const target = v.duration - LIVE_DELAY_SEC;
    if (Number.isFinite(target) && target > 0) { v.currentTime = target; }
    v.play(); 
  }

  const storageEls = {
    updated: document.getElementById('storage-updated'),
    bar: document.getElementById('storage-bar-fill'),
    warnings: document.getElementById('storage-warnings'),
    disks: document.getElementById('storage-disks'),
    filesystem: document.getElementById('stat-filesystem'),
    mount: document.getElementById('stat-mount'),
    capacity: document.getElementById('stat-capacity'),
    used: document.getElementById('stat-used'),
    free: document.getElementById('stat-free'),
    usedPercent: document.getElementById('stat-used-percent'),
    recordings: document.getElementById('stat-recordings'),
    rate: document.getElementById('stat-rate'),
    eta: document.getElementById('stat-eta')
  };

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) { value /= 1024; idx += 1; }
    return `${value.toFixed(2)} ${units[idx]}`;
  }

  function formatRate(bps) { if (!bps || bps <= 0) return '-'; return `${formatBytes(bps)}/s`; }

  function formatEta(seconds) {
    if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '-';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days}d ${hours}h ${mins}m ${secs}s`;
  }

  // Fungsi Baru untuk Menghapus Akun
async function deleteExistingAccount() {
    const username = document.getElementById('edit-username').value.trim();
    const msgEl = document.getElementById('modify-account-msg');

    if (!username) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = 'Silakan masukkan Target Username yang ingin dihapus!';
        return;
    }

    if (!confirm(`Apakah Anda yakin ingin menghapus akun "${username}"?`)) {
        return;
    }

    try {
        const res = await fetch('/api/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (data.success) {
            msgEl.style.color = 'var(--accent-1)';
            msgEl.textContent = data.message || 'Akun berhasil dihapus!';
            // Reset input form setelah berhasil dihapus
            document.getElementById('edit-username').value = '';
            document.getElementById('edit-password').value = '';
            document.getElementById('edit-role').value = '';
            // Perbarui daftar dropdown suggest
            if (typeof updateUsernameSuggestions === 'function') updateUsernameSuggestions();
        } else {
            msgEl.style.color = 'var(--accent-3)';
            msgEl.textContent = data.error || 'Gagal menghapus akun.';
        }
    } catch (e) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = 'Terjadi kesalahan sistem.';
    }
}

  // Fungsi mengambil daftar akun dan merendernya ke tabel
async function updateUsernameSuggestions() {
    const tbody = document.getElementById('table-users-body');
    if (!tbody) return;

    try {
        const res = await fetch('/api/users-list');
        const data = await res.json();
        
        if (data.success && data.users) {
            tbody.innerHTML = ''; // Reset baris lama

            data.users.forEach(user => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--stroke-1)';

                tr.innerHTML = `
                    <td style="padding: 6px 8px; font-weight: bold;">${user.username}</td>
                    <td style="padding: 6px 8px;"><span style="padding: 2px 5px; background: var(--stroke-2); border-radius: 4px; font-size: 10px;">${user.role}</span></td>
                    <td style="padding: 6px 8px; font-family: monospace; color: var(--ink-2);">${user.password}</td>
                    <td style="padding: 6px 8px; text-align: center; display: flex; gap: 4px; justify-content: center;">
                        <button onclick="actionChangePassword('${user.username}')" style="padding: 3px 6px; background: var(--accent-2); color: #000; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;">Edit Pwd</button>
                        <button onclick="actionDeleteAccount('${user.username}')" style="padding: 3px 6px; background: var(--accent-3); color: #fff; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Gagal memperbarui tabel user:", e);
    }
}

// Aksi Ganti Password Langsung dari Tabel
async function actionChangePassword(username) {
    const newPassword = prompt(`Masukkan password baru untuk user "${username}":`);
    if (newPassword === null) return;
    if (newPassword.trim() === "") {
        alert("Password tidak boleh kosong!");
        return;
    }

    try {
        const res = await fetch('/api/modify-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: newPassword })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Password untuk "${username}" berhasil diubah!`);
            updateUsernameSuggestions();
        } else {
            alert(data.error || "Gagal mengubah password.");
        }
    } catch (e) {
        alert("Terjadi kesalahan sistem.");
    }
}

// Aksi Hapus Akun Langsung dari Tabel
async function actionDeleteAccount(username) {
    if (!confirm(`Apakah Anda yakin ingin menghapus akun "${username}"?`)) {
        return;
    }

    try {
        const res = await fetch('/api/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (data.success) {
            alert("Akun berhasil dihapus.");
            updateUsernameSuggestions(); // Segarkan tabel secara instan
        } else {
            alert(data.error || "Gagal menghapus akun.");
        }
    } catch (e) {
        alert("Terjadi kesalahan sistem.");
    }
}

  async function fetchStorageStats() {
    try {
      const response = await fetch('/api/storage-stats');
      if (!response.ok) throw new Error('Bad response');
      const data = await response.json();
      storageEls.updated.textContent = `Updated: ${data.updatedAt}`;
      storageEls.bar.style.width = `${data.percentUsed || 0}%`;
      storageEls.filesystem.textContent = data.filesystem || '-';
      storageEls.mount.textContent = data.mountPoint || '-';
      storageEls.capacity.textContent = formatBytes(data.sizeBytes);
      storageEls.used.textContent = formatBytes(data.usedBytes);
      storageEls.free.textContent = formatBytes(data.availBytes);
      storageEls.usedPercent.textContent = `${data.percentUsed || 0}%`;
      storageEls.recordings.textContent = formatBytes(data.recordingsBytes);
      storageEls.rate.textContent = formatRate(data.writeRateBps);
      storageEls.eta.textContent = formatEta(data.etaSeconds);
      if (Array.isArray(data.missingMounts) && data.missingMounts.length > 0) { storageEls.warnings.textContent = `Missing mounts: ${data.missingMounts.join(', ')}`; } else { storageEls.warnings.textContent = ''; }
      storageEls.disks.innerHTML = '';
      if (Array.isArray(data.disks)) {
        data.disks.forEach((disk) => {
          const diskEl = document.createElement('div');
          diskEl.className = 'storage-disk';
          const title = disk.label || disk.mountPoint || 'Disk';
          const status = disk.isMounted === false ? 'Missing' : 'Mounted';
          diskEl.innerHTML = `
            <div class="storage-disk-title">${title}</div>
            <div class="storage-bar" style="height: 6px; margin: 4px 0 8px; background: #0b111b; border: 1px solid var(--stroke-2); border-radius: 999px; overflow: hidden; width: 100%;">
              <div class="storage-bar-fill" style="height: 100%; width: ${disk.percentUsed || 0}%; background: linear-gradient(90deg, #2ecc71, #f1c40f, #e74c3c); transition: width 0.6s ease;"></div>
            </div>
            <div class="storage-disk-row">Status: <span>${status}</span></div>
            <div class="storage-disk-row">Source: <span>${disk.source || '-'}</span></div>
            <div class="storage-disk-row">FS: <span>${disk.fsType || '-'}</span></div>
            <div class="storage-disk-row">Size: <span>${formatBytes(disk.sizeBytes)}</span></div>
            <div class="storage-disk-row">Used: <span>${formatBytes(disk.usedBytes)} (${disk.percentUsed || 0}%)</span></div>
            <div class="storage-disk-row">Free: <span>${formatBytes(disk.availBytes)}</span></div>
            <div class="storage-disk-row">Recordings: <span>${formatBytes(disk.recordingsBytes)}</span></div>
          `;
          storageEls.disks.appendChild(diskEl);
        });
      }
    } catch (err) { storageEls.updated.textContent = 'Storage data unavailable'; }
    fetchStorageCleanupLogs();
  }

  // --- AUDIO LIBRARY CONSOLE SCRIPT ---
  async function fetchAudioLibrary() {
    const tbody = document.getElementById('table-audio-body');
    const selectAlarm = document.getElementById('selectAlarmAudio');
    const selectSirine = document.getElementById('selectSirineAudio');
    if (!tbody) return;

    try {
      const res = await fetch('/api/audio/list');
      const data = await res.json();
      
      if (data.success && Array.isArray(data.files)) {
        tbody.innerHTML = '';
        
        // Save current selections
        const prevAlarm = selectAlarm ? selectAlarm.value : 'Alarm.mpeg';
        const prevSirine = selectSirine ? selectSirine.value : 'Alarm.mpeg';
        
        // Reset selectors
        if (selectAlarm) selectAlarm.innerHTML = '';
        if (selectSirine) selectSirine.innerHTML = '';

        if (data.files.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--ink-2); padding: 15px;">Belum ada file audio di library.</td></tr>';
          return;
        }

        data.files.forEach((file, index) => {
          // Populate selectors
          if (selectAlarm) {
            const opt = document.createElement('option');
            opt.value = file.filename;
            opt.textContent = file.filename + (file.isDefault ? ' (Default)' : '');
            selectAlarm.appendChild(opt);
          }
          if (selectSirine) {
            const opt = document.createElement('option');
            opt.value = file.filename;
            opt.textContent = file.filename + (file.isDefault ? ' (Default)' : '');
            selectSirine.appendChild(opt);
          }

          // Populate table row
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--stroke-1)';
          tr.innerHTML = `
            <td style="padding: 8px 6px; font-weight: bold; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${file.filename} ${file.isDefault ? '<span style="color:var(--accent-1); font-size:10px; margin-left: 5px;">(Default)</span>' : ''}
            </td>
            <td style="padding: 8px 6px; color: var(--ink-2);">${formatBytes(file.size)}</td>
            <td style="padding: 8px 6px;">
              <select id="channel-${index}" onchange="changeDefaultChannel('${file.filename}', this.value)" style="padding: 2px 4px; font-size: 11px; margin-bottom: 0; width: 100%;">
                <option value="stereo" ${file.defaultChannel === 'stereo' ? 'selected' : ''}>Stereo (CH 1 + CH 2)</option>
                <option value="left" ${file.defaultChannel === 'left' ? 'selected' : ''}>Left Only (CH 1)</option>
                <option value="right" ${file.defaultChannel === 'right' ? 'selected' : ''}>Right Only (CH 2)</option>
              </select>
            </td>
            <td style="padding: 8px 6px; text-align: center; display: flex; gap: 4px; justify-content: center;">
              <button onclick="playAudioOnSpeakers('${file.filename}', 'channel-${index}')" style="padding: 3px 6px; background: var(--accent-1); color: #000; font-weight: bold; border-radius: 4px; font-size: 11px; border: none; cursor: pointer;">Play 🔊</button>
              <button onclick="pauseAudioOnSpeakers()" style="padding: 3px 6px; background: var(--accent-2); color: #000; font-weight: bold; border-radius: 4px; font-size: 11px; border: none; cursor: pointer;">Pause ⏸️</button>
              <button onclick="resumeAudioOnSpeakers()" style="padding: 3px 6px; background: #9bc1ff; color: #000; font-weight: bold; border-radius: 4px; font-size: 11px; border: none; cursor: pointer;">Resume ▶️</button>
              <button onclick="stopAudioOnSpeakers()" style="padding: 3px 6px; background: var(--accent-3); color: #fff; font-weight: bold; border-radius: 4px; font-size: 11px; border: none; cursor: pointer;">Stop ⏹️</button>
            </td>
            <td style="padding: 8px 6px; text-align: center;">
              <button onclick="deleteAudioFile('${file.filename}')" ${file.isDefault ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''} style="padding: 3px 6px; background: transparent; border: 1px solid var(--accent-3); color: var(--accent-3); border-radius: 4px; font-size: 11px; cursor: pointer;">Delete 🗑️</button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        // Restore selections if still available in list
        if (selectAlarm) {
          const hasPrev = Array.from(selectAlarm.options).some(opt => opt.value === prevAlarm);
          selectAlarm.value = hasPrev ? prevAlarm : 'Alarm.mpeg';
        }
        if (selectSirine) {
          const hasPrev = Array.from(selectSirine.options).some(opt => opt.value === prevSirine);
          selectSirine.value = hasPrev ? prevSirine : 'Alarm.mpeg';
        }
      }
    } catch (e) {
      console.error("Gagal memuat audio library:", e);
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red; padding: 15px;">Gagal memuat library dari server.</td></tr>';
    }
  }

  async function fetchAudioConfig() {
    try {
      const res = await fetch('/api/audio/config');
      const data = await res.json();
      if (data.success && data.config) {
        const selectAlarm = document.getElementById('selectAlarmAudio');
        const selectSirine = document.getElementById('selectSirineAudio');
        const volumeSlider = document.getElementById('masterVolumeSlider');
        const volumeText = document.getElementById('volumePercentVal');

        if (selectAlarm && data.config.alarmFile) selectAlarm.value = data.config.alarmFile;
        if (selectSirine && data.config.sirineFile) selectSirine.value = data.config.sirineFile;
        if (volumeSlider && data.config.masterVolume !== undefined) {
          volumeSlider.value = data.config.masterVolume;
          if (volumeText) volumeText.textContent = `${data.config.masterVolume}%`;
        }
      }
    } catch (e) {
      console.error("Gagal mengambil konfigurasi audio:", e);
    }
  }

  async function updateAudioConfig() {
    const alarmFile = document.getElementById('selectAlarmAudio')?.value;
    const sirineFile = document.getElementById('selectSirineAudio')?.value;
    const masterVolume = document.getElementById('masterVolumeSlider')?.value;
    const volumeText = document.getElementById('volumePercentVal');
    
    if (volumeText && masterVolume !== undefined) {
      volumeText.textContent = `${masterVolume}%`;
    }

    try {
      await fetch('/api/audio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alarmFile, sirineFile, masterVolume })
      });
    } catch (e) {
      console.error("Gagal memperbarui konfigurasi audio:", e);
    }
  }

  async function uploadAudioFile() {
    const fileInput = document.getElementById('audioFileInput');
    const msgEl = document.getElementById('audio-upload-msg');
    const btn = document.getElementById('btnAudioUpload');
    if (!fileInput || !fileInput.files[0] || !msgEl) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('audioFile', file);

    msgEl.style.color = '#fff';
    msgEl.textContent = 'Mengunggah file audio...';
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/audio/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        msgEl.style.color = '#2ecc71';
        msgEl.textContent = data.message;
        fileInput.value = ''; // Clear file input
        fetchAudioLibrary();
      } else {
        msgEl.style.color = '#e74c3c';
        msgEl.textContent = data.error || 'Gagal mengunggah file.';
      }
    } catch (e) {
      msgEl.style.color = '#e74c3c';
      msgEl.textContent = 'Terjadi kesalahan saat mengunggah.';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function playAudioOnSpeakers(filename, selectId) {
    const channel = document.getElementById(selectId)?.value || 'stereo';
    const msgEl = document.getElementById('audio-console-msg');
    if (msgEl) {
      msgEl.style.color = 'var(--accent-1)';
      msgEl.textContent = `Broadcasting "${filename}" (${channel.toUpperCase()})...`;
    }
    try {
      const res = await fetch('/api/audio/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, channel })
      });
      const data = await res.json();
      if (!data.success && msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = data.error || 'Gagal memulai broadcast.';
      }
    } catch (e) {
      if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = 'Koneksi error ke audio server.';
      }
    }
  }

  async function pauseAudioOnSpeakers() {
    const msgEl = document.getElementById('audio-console-msg');
    try {
      const res = await fetch('/api/audio/pause', { method: 'POST' });
      const data = await res.json();
      if (data.success && msgEl) {
        msgEl.style.color = 'var(--accent-2)';
        msgEl.textContent = 'Broadcast di-pause.';
      } else if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = data.error || 'Gagal mem-pause broadcast.';
      }
    } catch (e) {
      if (msgEl) msgEl.textContent = 'Koneksi error.';
    }
  }

  async function resumeAudioOnSpeakers() {
    const msgEl = document.getElementById('audio-console-msg');
    try {
      const res = await fetch('/api/audio/resume', { method: 'POST' });
      const data = await res.json();
      if (data.success && msgEl) {
        msgEl.style.color = 'var(--accent-1)';
        msgEl.textContent = 'Melanjutkan broadcast...';
      } else if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = data.error || 'Gagal melanjutkan broadcast.';
      }
    } catch (e) {
      if (msgEl) msgEl.textContent = 'Koneksi error.';
    }
  }

  async function stopAudioOnSpeakers() {
    const msgEl = document.getElementById('audio-console-msg');
    try {
      const res = await fetch('/api/audio/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success && msgEl) {
        msgEl.style.color = 'var(--ink-2)';
        msgEl.textContent = 'Broadcast dihentikan.';
      } else if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = data.error || 'Gagal menghentikan broadcast.';
      }
    } catch (e) {
      if (msgEl) msgEl.textContent = 'Koneksi error.';
    }
  }

  async function deleteAudioFile(filename) {
    if (!confirm(`Apakah Anda yakin ingin menghapus file audio "${filename}"?`)) {
      return;
    }
    const msgEl = document.getElementById('audio-console-msg');
    try {
      const res = await fetch(`/api/audio/${filename}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        if (msgEl) {
          msgEl.style.color = 'var(--accent-1)';
          msgEl.textContent = data.message || 'File berhasil dihapus.';
        }
        fetchAudioLibrary();
      } else if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = data.error || 'Gagal menghapus file.';
      }
    } catch (e) {
      if (msgEl) msgEl.textContent = 'Koneksi error.';
    }
  }

  async function changeDefaultChannel(filename, channel) {
    const msgEl = document.getElementById('audio-console-msg');
    try {
      const res = await fetch('/api/audio/update-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, defaultChannel: channel })
      });
      const data = await res.json();
      if (data.success && msgEl) {
        msgEl.style.color = 'var(--accent-1)';
        msgEl.textContent = `Channel default untuk "${filename}" diubah ke ${channel.toUpperCase()}.`;
      } else if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = data.error || 'Gagal mengubah channel default.';
      }
    } catch (e) {
      if (msgEl) {
        msgEl.style.color = 'var(--accent-3)';
        msgEl.textContent = 'Koneksi error ke server.';
      }
    }
  }

  function applyPermissions(role) {
      document.getElementById('login-overlay').style.display = 'none';
      document.getElementById('main-content').style.display = 'block';
      
      // Initialize video streams only after logging in
      initializeStreams();

      const cleanupBlock = document.getElementById('auto-cleanup-block');
      const superadminPanel = document.getElementById('superadmin-panel');
      const systemLogsPanel = document.getElementById('system-logs-panel');
      
      const alarmContainer = document.getElementById('alarm-container');
      const playbackPanel = document.getElementById('playback-panel');
      const storagePanel = document.getElementById('storage-panel');

      if (role === 'guest') {
          if (alarmContainer) alarmContainer.style.display = 'none';
          if (playbackPanel) playbackPanel.style.display = 'none';
          if (storagePanel) storagePanel.style.display = 'none';
          if (superadminPanel) superadminPanel.style.display = 'none';
          if (systemLogsPanel) systemLogsPanel.style.display = 'none';
          if (cleanupBlock) cleanupBlock.style.display = 'none';
          toggleAutoRefreshLogs(false);
      } else if (role === 'admin') {
          if (alarmContainer) alarmContainer.style.display = 'flex';
          if (playbackPanel) playbackPanel.style.display = 'block';
          if (storagePanel) storagePanel.style.display = 'block';
          if (superadminPanel) superadminPanel.style.display = 'none';
          if (systemLogsPanel) systemLogsPanel.style.display = 'none';
          if (cleanupBlock) cleanupBlock.style.display = 'none';
          toggleAutoRefreshLogs(false);
      } else if (role === 'superadmin') {
          if (alarmContainer) alarmContainer.style.display = 'flex';
          if (playbackPanel) playbackPanel.style.display = 'block';
          if (storagePanel) storagePanel.style.display = 'block';
          if (superadminPanel) superadminPanel.style.display = 'block';
          if (systemLogsPanel) systemLogsPanel.style.display = 'block';
          if (cleanupBlock) cleanupBlock.style.display = 'block';
          fetchSuperadminLogs();
          fetchSystemLogs();
          fetchStorageCleanupLogs();
          updateUsernameSuggestions();
          fetchAudioLibrary();
          fetchAudioConfig();
      }
  }

  async function fetchSuperadminLogs() {
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        const tbody = document.getElementById('log-table-body');
        
        if (data.success && Array.isArray(data.logs)) {
            tbody.innerHTML = '';
            
            if (data.logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#aaa;">Belum ada log aktivitas.</td></tr>';
                return;
            }
            
            // PERUBAHAN DI SINI: Membalik urutan array agar data terbaru menjadi yang paling pertama
            const reversedLogs = data.logs.reverse();
            
            // Sekarang kita lakukan perulangan dari data yang sudah dibalik
            reversedLogs.forEach(log => {
                const badgeClass = log.action === 'LOGIN' ? 'badge-login' : 'badge-logout';
                tbody.innerHTML += `
                    <tr>
                        <td style="color:#aaa">${log.timestamp}</td>
                        <td style="font-weight:600; color:#fff">${log.username}</td>
                        <td><span style="color:var(--accent-2)">${log.role}</span></td>
                        <td><span class="${badgeClass}">${log.action}</span></td>
                    </tr>
                `;
            });
        } else {
            document.getElementById('log-table-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Gagal memuat log data.</td></tr>';
        }
    } catch (err) {
        document.getElementById('log-table-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Koneksi error.</td></tr>';
    }
}

  async function createNewAccount() {
    const userEl = document.getElementById('new-username');
    const passEl = document.getElementById('new-password');
    const roleEl = document.getElementById('new-role');
    const msgEl = document.getElementById('create-account-msg');

    try {
        const res = await fetch('/api/create-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                newUsername: userEl.value,
                newPassword: passEl.value,
                newRole: roleEl.value
            })
        });
        const data = await res.json();
        if (data.success) {
            msgEl.style.color = '#2ecc71';
            msgEl.innerText = data.message;
            
            // Bersihkan form input setelah sukses
            userEl.value = '';
            passEl.value = '';
            roleEl.value = '';

            // ========================================================
            // SEKARANG INI AKAN BERJALAN OTOMATIS TANPA REFRESH WEB
            // ========================================================
            updateUsernameSuggestions(); 
            
        } else {
            msgEl.style.color = '#e74c3c';
            msgEl.innerText = data.message;
        }
    } catch (err) {
        msgEl.style.color = '#e74c3c';
        msgEl.innerText = 'Gagal terhubung ke server.';
    }
}

  // BARU: Fungsi mengirim permintaan modifikasi password / role akun ke API Server
  async function modifyExistingAccount() {
      const userEl = document.getElementById('edit-username');
      const passEl = document.getElementById('edit-password');
      const roleEl = document.getElementById('edit-role');
      const msgEl = document.getElementById('modify-account-msg');

      try {
        
          const res = await fetch('/api/modify-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  username: userEl.value,
                  newPassword: passEl.value || null, // Kirim null jika tidak diganti
                  newRole: roleEl.value || null      // Kirim null jika tidak diganti
              })
          });
          // BARU: API untuk Mengambil Daftar Username saja untuk Fitur Suggest Dropdown (Hanya untuk Superadmin)

          // Fungsi Baru untuk Mengisi Dropdown Suggest Username

          const data = await res.json();
          if (data.success) {
              msgEl.style.color = '#2ecc71';
              msgEl.innerText = data.message;
              userEl.value = '';
              passEl.value = '';
              roleEl.value = '';
          } else {
              msgEl.style.color = '#e74c3c';
              msgEl.innerText = data.message;
          }
      } catch (err) {
          msgEl.style.color = '#e74c3c';
          msgEl.innerText = 'Gagal terhubung ke server.';
      }
  }

  window.onload = () => {
    fetchRecordings();
    fetchStorageStats();
    setInterval(fetchStorageStats, 5000);
    const hourInput = document.getElementById('time-hour');
    const minuteInput = document.getElementById('time-minute');
    const secondInput = document.getElementById('time-second');
    if (hourInput) hourInput.addEventListener('input', handleTypedTime);
    if (minuteInput) minuteInput.addEventListener('input', handleTypedTime);
    if (secondInput) secondInput.addEventListener('input', handleTypedTime);

    const timelineWrapper = document.getElementById('nvrTimelineWrapper');
    const track = document.getElementById('nvrTimelineTrack');
    if (timelineWrapper && track) {
      timelineWrapper.addEventListener('mousedown', (e) => {
        isDraggingTimeline = true;
        track.style.transition = 'none';
        dragStartX = e.clientX;
        dragStartTrackX = currentTrackX;
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDraggingTimeline) return;
        const dx = e.clientX - dragStartX;
        let newX = dragStartTrackX + dx;
        
        const viewportWidth = timelineWrapper.clientWidth;
        const trackWidth = viewportWidth * 24;
        newX = Math.max(viewportWidth / 2 - trackWidth, Math.min(viewportWidth / 2, newX));
        
        currentTrackX = newX;
        track.style.transform = `translateX(${newX}px)`;

        const pct = (viewportWidth / 2 - newX) / trackWidth;
        draggedTimeSeconds = Math.max(0, Math.min(86399, pct * 86400));
      });

      window.addEventListener('mouseup', () => {
        if (!isDraggingTimeline) return;
        isDraggingTimeline = false;
        track.style.transition = 'transform 0.1s ease-out';
        seekToTimeOfDay(draggedTimeSeconds);
      });

      timelineWrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 0) return;
        isDraggingTimeline = true;
        track.style.transition = 'none';
        dragStartX = e.touches[0].clientX;
        dragStartTrackX = currentTrackX;
      });

      timelineWrapper.addEventListener('touchmove', (e) => {
        if (!isDraggingTimeline || e.touches.length === 0) return;
        const dx = e.touches[0].clientX - dragStartX;
        let newX = dragStartTrackX + dx;
        
        const viewportWidth = timelineWrapper.clientWidth;
        const trackWidth = viewportWidth * 24;
        newX = Math.max(viewportWidth / 2 - trackWidth, Math.min(viewportWidth / 2, newX));
        
        currentTrackX = newX;
        track.style.transform = `translateX(${newX}px)`;

        const pct = (viewportWidth / 2 - newX) / trackWidth;
        draggedTimeSeconds = Math.max(0, Math.min(86399, pct * 86400));
      }, { passive: true });

      timelineWrapper.addEventListener('touchend', () => {
        if (!isDraggingTimeline) return;
        isDraggingTimeline = false;
        track.style.transition = 'transform 0.1s ease-out';
        seekToTimeOfDay(draggedTimeSeconds);
      });
    }
  };

  historyPlayer.addEventListener('play', () => {
    continuousPlayback = true;
    if (selectedRecording) { playingNowSpan.innerText = `Playing: ${selectedRecording.cam} - ${selectedRecording.name}`; playingNowSpan.style.color = '#3498db'; }
  });
  historyPlayer.addEventListener('pause', () => {
    if (!historyPlayer.ended) {
      continuousPlayback = false;
    }
  });
  historyPlayer.addEventListener('ended', () => {
    if (continuousPlayback) {
      playNextInQueue();
    }
  });
  historyPlayer.addEventListener('timeupdate', () => {
    if (selectedRecording) {
      const ts = selectedRecording.timestampMs || parseRecordingTimestamp(selectedRecording.name);
      if (ts) {
        const currentMs = ts + (historyPlayer.currentTime * 1000);
        updatePlayhead(currentMs);
      }
    }
  });

  async function handleLogin() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });

    const data = await res.json();
    if (data.success) {
        applyPermissions(data.role);
    } else {
        document.getElementById('login-error').innerText = data.message;
    }
  }

  let logsIntervalId = null;

  async function fetchSystemLogs() {
      const sourceSelect = document.getElementById('logSourceSelect');
      const limitSelect = document.getElementById('logLimitSelect');
      const contentEl = document.getElementById('system-logs-content');
      if (!sourceSelect || !limitSelect || !contentEl) return;
      
      const source = sourceSelect.value;
      const limit = limitSelect.value;

      // Selalu tampilkan rentang tanggal untuk semua log source
      const dateRangeContainer = document.getElementById('logDateRangeContainer');
      if (dateRangeContainer) {
          dateRangeContainer.style.display = 'flex';
      }

      let url = `/api/system-logs?source=${source}&limit=${limit}`;
      const sinceEl = document.getElementById('logSinceDate');
      const untilEl = document.getElementById('logUntilDate');
      if (sinceEl && sinceEl.value) url += `&since=${sinceEl.value}`;
      if (untilEl && untilEl.value) url += `&until=${untilEl.value}`;

      try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.success) {
              let logs = data.logs || 'No logs available.';
              if (parseInt(limit) > 5000) {
                  logs = `[INFO: Tampilan layar dibatasi maks. 5.000 baris agar browser Anda tidak lag/freeze. Gunakan tombol 'Export Log' di sebelah kanan untuk mengunduh versi lengkap ${parseInt(limit).toLocaleString()} baris!]\n\n` + logs;
              }
              contentEl.textContent = logs;
              contentEl.scrollTop = contentEl.scrollHeight;
          } else {
              contentEl.textContent = `Error loading logs: ${data.error || 'Unknown error'}`;
          }
      } catch (err) {
          contentEl.textContent = 'Failed to connect to log server.';
      }
  }

  function downloadCurrentLog() {
      const sourceSelect = document.getElementById('logSourceSelect');
      const limitSelect = document.getElementById('logLimitSelect');
      if (!sourceSelect || !limitSelect) return;
      const source = sourceSelect.value;
      const limit = limitSelect.value;
      let url = `/api/system-logs?source=${source}&limit=${limit}&download=true`;
      const sinceEl = document.getElementById('logSinceDate');
      const untilEl = document.getElementById('logUntilDate');
      if (sinceEl && sinceEl.value) url += `&since=${sinceEl.value}`;
      if (untilEl && untilEl.value) url += `&until=${untilEl.value}`;
      window.open(url, '_blank');
  }

  function toggleAutoRefreshLogs(forceState) {
      const checkbox = document.getElementById('autoRefreshLogs');
      const shouldEnable = forceState !== undefined ? forceState : (checkbox && checkbox.checked);
      
      if (checkbox && forceState !== undefined) {
          checkbox.checked = forceState;
      }

      if (logsIntervalId) {
          clearInterval(logsIntervalId);
          logsIntervalId = null;
      }

      if (shouldEnable) {
          logsIntervalId = setInterval(fetchSystemLogs, 5000);
      }
  }

  async function fetchStorageCleanupLogs() {
      const el = document.getElementById('storage-cleanup-log-container');
      if (!el) return;
      try {
          const res = await fetch('/api/cleanup-log');
          const data = await res.json();
          if (data.success) {
              const logsText = data.logs || '';
              if (!logsText.trim()) {
                  el.innerHTML = '<div style="color: #6272a4; text-align: center; padding: 20px 0; font-style: italic;">Belum ada aktivitas pembersihan.</div>';
                  return;
              }
              
              const lines = logsText.split('\n');
              let html = '';
              lines.forEach(line => {
                  if (!line.trim()) return;
                  
                  // Parse timestamp: [YYYY-MM-DD HH:MM:SS]
                  const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
                  if (match) {
                      const timeStr = match[1];
                      const message = match[2];
                      
                      let cardStyle = "padding: 8px 12px; border-radius: 8px; font-size: 11px; display: flex; flex-direction: column; gap: 4px; border: 1px solid ";
                      let titleStyle = "font-weight: 600; display: flex; align-items: center; gap: 6px;";
                      let typeLabel = "";
                      let typeColor = "";
                      let borderColor = "";
                      let bgColor = "";
                      let iconSvg = "";
                      
                      if (message.includes("Storage Alert")) {
                          typeLabel = "STORAGE ALERT";
                          typeColor = "#ff5555";
                          borderColor = "rgba(255, 85, 85, 0.25)";
                          bgColor = "rgba(255, 85, 85, 0.05)";
                          iconSvg = `
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${typeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                  <line x1="12" y1="9" x2="12" y2="13"></line>
                                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                              </svg>
                          `;
                      } else if (message.includes("Deleted old recording")) {
                          typeLabel = "CLEANUP";
                          typeColor = "#60a5fa";
                          borderColor = "rgba(96, 165, 250, 0.2)";
                          bgColor = "rgba(96, 165, 250, 0.03)";
                          iconSvg = `
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${typeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                  <polyline points="3 6 5 6 21 6"></polyline>
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                  <line x1="10" y1="11" x2="10" y2="17"></line>
                                  <line x1="14" y1="11" x2="14" y2="17"></line>
                              </svg>
                          `;
                      } else if (message.includes("Auto-cleanup complete") || message.includes("cleanup complete")) {
                          typeLabel = "CLEANUP COMPLETE";
                          typeColor = "#50fa7b";
                          borderColor = "rgba(80, 250, 123, 0.25)";
                          bgColor = "rgba(80, 250, 123, 0.05)";
                          iconSvg = `
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${typeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                              </svg>
                          `;
                      } else {
                          typeLabel = "SYSTEM INFO";
                          typeColor = "#bd93f9";
                          borderColor = "rgba(189, 147, 249, 0.2)";
                          bgColor = "rgba(189, 147, 249, 0.03)";
                          iconSvg = `
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${typeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <line x1="12" y1="16" x2="12" y2="12"></line>
                                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                              </svg>
                          `;
                      }
                      
                      let formattedMsg = message;
                      if (message.includes("Deleted old recording:")) {
                          const fileMatch = message.match(/Deleted old recording:\s*(\S+)\s*\(([^)]+)\)/);
                          if (fileMatch) {
                              const filename = fileMatch[1];
                              const sizeFreed = fileMatch[2];
                              formattedMsg = `Deleted <span style="color: #f1fa8c; font-family: monospace;">${filename}</span> <span style="background: rgba(96, 165, 250, 0.15); color: #9fd9ff; padding: 1px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; font-weight: 500;">${sizeFreed}</span>`;
                          }
                      } else if (message.includes("Auto-cleanup complete")) {
                          const spaceMatch = message.match(/Successfully freed\s*(\S+\s*[a-zA-Z]+)\s*by deleting\s*(\d+)\s*file\(s\)/);
                          if (spaceMatch) {
                              const freedSpace = spaceMatch[1];
                              const numFiles = spaceMatch[2];
                              formattedMsg = `Cleanup finished. Freed <span style="color: #50fa7b; font-weight: 600;">${freedSpace}</span> by removing <span style="color: #f1fa8c;">${numFiles} file(s)</span>.`;
                          }
                      }
                      
                      html += `
                          <div style="${cardStyle} ${borderColor}; background: ${bgColor}; color: #f8f8f2;">
                              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px;">
                                  <div style="${titleStyle} color: ${typeColor}; letter-spacing: 0.5px;">
                                      ${iconSvg}
                                      <span>${typeLabel}</span>
                                  </div>
                                  <div style="color: #6272a4;">${timeStr}</div>
                              </div>
                              <div style="line-height: 1.4; color: #dbe7ff;">${formattedMsg}</div>
                          </div>
                      `;
                  } else {
                      html += `
                          <div style="padding: 6px 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; color: #a9b7c6; font-size: 11px;">
                              ${line}
                          </div>
                      `;
                  }
              });
              
              el.innerHTML = html;
              el.scrollTop = el.scrollHeight;
          }
      } catch (e) {
          console.error("Error fetching cleanup logs:", e);
      }
  }

  async function executeLogout() {
      const res = await fetch('/api/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
          window.location.reload(); 
      } else {
          alert('Gagal melakukan logout, silakan coba lagi.');
      }
  }

  window.addEventListener('DOMContentLoaded', async () => {
      const res = await fetch('/api/check-session');
      const data = await res.json();
      if (data.loggedIn) {
          applyPermissions(data.user.role);
      }
  });