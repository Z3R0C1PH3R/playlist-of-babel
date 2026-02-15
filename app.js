// ═══════════════════════════════════════════════════════════════
// Playlist of Babel — Every possible 1-second sound exists here
// ═══════════════════════════════════════════════════════════════
// No server. Audio is generated from the address.
// Address = base64url of 8000 raw bytes (8-bit unsigned, 8kHz, mono, 1s)
// Total tracks = 2^64000
// ═══════════════════════════════════════════════════════════════

(() => {
    'use strict';

    // ─── Config ──────────────────────────────────────────────
    const SAMPLE_RATE    = 8000;
    const DURATION       = 1;
    const NUM_SAMPLES    = SAMPLE_RATE * DURATION;
    const B64            = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const ADDRESS_LENGTH = Math.ceil(NUM_SAMPLES * 4 / 3); // 10667
    const TRACKS_PER_PAGE = 8;
    const ACCENT         = '#d7263d';
    const BG_DARK        = '#02182b';

    // ─── State ───────────────────────────────────────────────
    let currentAddress = '', currentPrefix = '';
    let audioCtx = null, analyserNode = null, currentSource = null;
    let isPlaying = false, isRecording = false;
    let mediaRecorder = null, recStream = null;
    let animFrameId = null, progressTimer = null, playStartTime = 0;
    let portalAnimId = null, recTimerInterval = null;

    // Mutation history
    let mutationHistory = [];  // [{label, address}]

    // Region selector state
    let regionAudioBuffer = null;   // full decoded AudioBuffer from record/upload
    let regionStart = 0;            // in seconds
    let regionDragType = null;      // 'move' | 'left' | 'right'
    let regionDragStartX = 0, regionDragStartLeft = 0, regionDragStartRight = 0;

    // ─── Base64URL ───────────────────────────────────────────
    const B64_LOOKUP = new Uint8Array(128);
    B64_LOOKUP.fill(0);
    for (let i = 0; i < 64; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

    function bytesToBase64url(bytes) {
        const p = []; const len = bytes.length;
        for (let i = 0; i < len; i += 3) {
            const b0 = bytes[i], b1 = (i+1<len)?bytes[i+1]:0, b2 = (i+2<len)?bytes[i+2]:0;
            p.push(B64[b0 >> 2]);
            p.push(B64[((b0 & 3) << 4) | (b1 >> 4)]);
            if (i+1 < len) p.push(B64[((b1 & 0xF) << 2) | (b2 >> 6)]);
            if (i+2 < len) p.push(B64[b2 & 0x3F]);
        }
        return p.join('');
    }

    function base64urlToBytes(str) {
        const bytes = new Uint8Array(NUM_SAMPLES); let bi = 0;
        for (let i = 0; i < str.length && bi < NUM_SAMPLES; i += 4) {
            const c0 = B64_LOOKUP[str.charCodeAt(i)]||0;
            const c1 = (i+1<str.length)?(B64_LOOKUP[str.charCodeAt(i+1)]||0):0;
            const c2 = (i+2<str.length)?(B64_LOOKUP[str.charCodeAt(i+2)]||0):0;
            const c3 = (i+3<str.length)?(B64_LOOKUP[str.charCodeAt(i+3)]||0):0;
            if (bi < NUM_SAMPLES) bytes[bi++] = (c0 << 2) | (c1 >> 4);
            if (bi < NUM_SAMPLES) bytes[bi++] = ((c1 & 0xF) << 4) | (c2 >> 2);
            if (bi < NUM_SAMPLES) bytes[bi++] = ((c2 & 3) << 6) | c3;
        }
        return bytes;
    }

    // ─── Utilities ───────────────────────────────────────────
    function randomChar() { return B64[Math.floor(Math.random() * 64)]; }

    function randomAddress(prefix) {
        prefix = prefix || '';
        const parts = [prefix];
        for (let i = 0; i < ADDRESS_LENGTH - prefix.length; i++) parts.push(randomChar());
        return parts.join('').substring(0, ADDRESS_LENGTH);
    }

    function isValidB64Char(ch) { return B64.indexOf(ch) !== -1; }
    function isValidPrefix(str) { for (let i = 0; i < str.length; i++) if (!isValidB64Char(str[i])) return false; return true; }

    function truncAddr(addr, max) {
        max = max || 60;
        if (addr.length <= max) return addr;
        const h = Math.floor(max / 2) - 1;
        return addr.substring(0, h) + '…' + addr.substring(addr.length - h);
    }

    // ─── Audio Context ───────────────────────────────────────
    function getAudioCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 2048;
            analyserNode.smoothingTimeConstant = 0.8;
            analyserNode.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    // ─── Playback ────────────────────────────────────────────
    function playTrack(address) {
        stopPlayback();
        const ctx = getAudioCtx();
        const bytes = base64urlToBytes(address);
        const buffer = ctx.createBuffer(1, NUM_SAMPLES, SAMPLE_RATE);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < NUM_SAMPLES; i++) data[i] = (bytes[i] - 128) / 128;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(analyserNode);
        source.start();

        currentSource = source; currentAddress = address;
        isPlaying = true; playStartTime = ctx.currentTime;

        source.onended = () => {
            isPlaying = false; currentSource = null;
            updatePlayButtons(false); stopProgressTimer(); updateProgress(1);
        };

        updatePlayButtons(true); startProgressTimer(); showPlayerBar();
        drawStaticWaveform(document.getElementById('play-waveform'), bytes);
        startRealtimeViz();

        const barAddr = document.getElementById('bar-address');
        if (barAddr) barAddr.textContent = truncAddr(address, 50);

        document.querySelectorAll('.track-item').forEach(el => {
            el.classList.toggle('active', el.dataset.address === address);
        });
    }

    function stopPlayback() {
        if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource = null; }
        isPlaying = false; updatePlayButtons(false); stopProgressTimer(); cancelRealtimeViz();
    }

    function togglePlayback() {
        if (isPlaying) stopPlayback();
        else if (currentAddress) playTrack(currentAddress);
    }

    // ─── Progress ────────────────────────────────────────────
    function startProgressTimer() {
        stopProgressTimer();
        progressTimer = setInterval(() => {
            if (!isPlaying || !audioCtx) return;
            const pct = Math.min((audioCtx.currentTime - playStartTime) / DURATION, 1);
            updateProgress(pct);
        }, 50);
    }
    function stopProgressTimer() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }

    function updateProgress(pct) {
        ['player-progress-fill', 'bar-progress-fill'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.width = (pct * 100) + '%';
        });
        const t = document.getElementById('player-time-current');
        if (t) t.textContent = '0:' + String(Math.min(Math.floor(pct * DURATION), DURATION)).padStart(2, '0');
    }

    function updatePlayButtons(playing) {
        const m = document.getElementById('btn-play-main');
        const b = document.getElementById('bar-play-btn');
        if (m) { m.querySelector('.play-icon').textContent = playing ? '⏸' : '▶'; m.classList.toggle('playing', playing); }
        if (b) b.textContent = playing ? '⏸' : '▶';
    }

    // ─── Visualization ──────────────────────────────────────
    function drawStaticWaveform(canvas, bytes) {
        if (!canvas) return;
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, mid = h / 2;
        c.fillStyle = BG_DARK; c.fillRect(0, 0, w, h);
        // center line
        c.strokeStyle = 'rgba(215, 38, 61, 0.12)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(0, mid); c.lineTo(w, mid); c.stroke();
        // waveform
        c.strokeStyle = ACCENT; c.lineWidth = 1.2; c.beginPath();
        for (let x = 0; x < w; x++) {
            const idx = Math.floor(x * bytes.length / w);
            const y = mid - ((bytes[idx] - 128) / 128) * (mid - 6);
            x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
    }

    function drawMiniWaveform(canvas, bytes) {
        if (!canvas) return;
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, mid = h / 2;
        c.clearRect(0, 0, w, h);
        c.strokeStyle = 'rgba(215, 38, 61, 0.5)'; c.lineWidth = 1; c.beginPath();
        const step = Math.max(1, Math.floor(bytes.length / w));
        for (let x = 0; x < w; x++) {
            const idx = x * step; if (idx >= bytes.length) break;
            const y = mid - ((bytes[idx] - 128) / 128) * (mid - 2);
            x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
    }

    function startRealtimeViz() {
        cancelRealtimeViz();
        const barViz = document.getElementById('bar-viz');
        const specCanvas = document.getElementById('play-spectrum');
        if (!analyserNode) return;
        const bufLen = analyserNode.frequencyBinCount;
        const freqData = new Uint8Array(bufLen);

        function draw() {
            animFrameId = requestAnimationFrame(draw);
            if (!isPlaying) { cancelRealtimeViz(); return; }
            analyserNode.getByteFrequencyData(freqData);

            if (barViz) {
                const c = barViz.getContext('2d'), w = barViz.width, h = barViz.height;
                c.fillStyle = 'rgba(2, 24, 43, 0.85)'; c.fillRect(0, 0, w, h);
                const bars = 16, bw = w / bars, step = Math.floor(bufLen / bars);
                for (let i = 0; i < bars; i++) {
                    const val = freqData[i * step] / 255;
                    const bh = val * h;
                    const alpha = 0.4 + val * 0.5;
                    c.fillStyle = `rgba(215, 38, 61, ${alpha})`;
                    c.fillRect(i * bw + 1, h - bh, bw - 2, bh);
                }
            }

            if (specCanvas) {
                const c = specCanvas.getContext('2d'), w = specCanvas.width, h = specCanvas.height;
                c.fillStyle = 'rgba(2, 24, 43, 0.9)'; c.fillRect(0, 0, w, h);
                const bars = 48, bw = w / bars, step = Math.floor(bufLen / bars);
                for (let i = 0; i < bars; i++) {
                    const val = freqData[i * step] / 255;
                    const bh = val * h;
                    const alpha = 0.3 + val * 0.5;
                    c.fillStyle = `rgba(215, 38, 61, ${alpha})`;
                    c.fillRect(i * bw + 0.5, h - bh, bw - 1, bh);
                }
            }
        }
        draw();
    }

    function cancelRealtimeViz() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    }

    // Portal wave
    function startPortalAnimation() {
        const canvas = document.getElementById('portal-wave');
        if (!canvas) return;
        const c = canvas.getContext('2d');
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
        const w = canvas.width, h = canvas.height, mid = h / 2;
        let t = 0;

        function draw() {
            portalAnimId = requestAnimationFrame(draw);
            t += 0.012;
            c.fillStyle = 'rgba(1, 17, 31, 0.1)'; c.fillRect(0, 0, w, h);

            const waves = [
                { a: 0.25, freq: 0.007, amp: 35, speed: 0.9, y: 0 },
                { a: 0.15, freq: 0.011, amp: 25, speed: 1.2, y: 8 },
                { a: 0.10, freq: 0.005, amp: 45, speed: 0.6, y: -8 },
            ];
            waves.forEach(wv => {
                c.strokeStyle = `rgba(215, 38, 61, ${wv.a})`;
                c.lineWidth = 1.5; c.beginPath();
                for (let x = 0; x < w; x++) {
                    const y = mid + wv.y + Math.sin(x * wv.freq + t * wv.speed) * wv.amp * Math.sin(x * 0.002 + t * 0.25);
                    x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
                }
                c.stroke();
            });
        }
        draw();
    }
    function stopPortalAnimation() { if (portalAnimId) { cancelAnimationFrame(portalAnimId); portalAnimId = null; } }

    // ─── Recording ───────────────────────────────────────────
    async function startRecording() {
        try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch(e) { showToast('Microphone access denied'); return; }

        const chunks = [];
        mediaRecorder = new MediaRecorder(recStream);
        mediaRecorder.ondataavailable = e => chunks.push(e.data);

        let recStartTime = Date.now();

        mediaRecorder.onstop = async () => {
            recStream.getTracks().forEach(t => t.stop()); recStream = null;
            isRecording = false; updateRecordingUI(false);
            clearInterval(recTimerInterval); recTimerInterval = null;

            showToast('Processing…');
            try {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                const ctx = getAudioCtx();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                openRegionSelector(audioBuffer);
            } catch(e) { showToast('Failed to process: ' + e.message); }
        };

        mediaRecorder.start();
        isRecording = true;
        updateRecordingUI(true);

        // Timer display
        recTimerInterval = setInterval(() => {
            const elapsed = ((Date.now() - recStartTime) / 1000).toFixed(1);
            const el = document.getElementById('rec-timer');
            if (el) el.textContent = elapsed + 's';
        }, 100);
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }

    function updateRecordingUI(recording) {
        const btn = document.getElementById('btn-record');
        const status = document.getElementById('recording-status');
        if (recording) {
            btn.innerHTML = '<span class="record-dot" style="background:' + ACCENT + '"></span> Recording…';
            btn.disabled = true; btn.style.opacity = '0.5';
            status.classList.remove('hidden');
            drawRecWave();
        } else {
            btn.innerHTML = '<span class="record-dot"></span> Start Recording';
            btn.disabled = false; btn.style.opacity = '1';
            status.classList.add('hidden');
        }
    }

    function drawRecWave() {
        if (!isRecording) return;
        const canvas = document.getElementById('rec-wave');
        if (!canvas) return;
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        function draw() {
            if (!isRecording) return;
            requestAnimationFrame(draw);
            c.fillStyle = 'rgba(2, 24, 43, 0.4)'; c.fillRect(0, 0, w, h);
            c.strokeStyle = 'rgba(215, 38, 61, 0.6)'; c.lineWidth = 1.5; c.beginPath();
            const mid = h / 2;
            for (let x = 0; x < w; x++) {
                const y = mid + (Math.random() - 0.5) * h * 0.5;
                x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
            }
            c.stroke();
        }
        draw();
    }

    // ─── Region Selector ─────────────────────────────────────
    function openRegionSelector(audioBuffer) {
        regionAudioBuffer = audioBuffer;
        regionStart = 0;
        showView('region');
        drawRegionWaveform();
        updateRegionUI();
    }

    function drawRegionWaveform() {
        const canvas = document.getElementById('region-waveform');
        if (!canvas || !regionAudioBuffer) return;
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height, mid = h / 2;
        const data = regionAudioBuffer.getChannelData(0);

        c.fillStyle = BG_DARK; c.fillRect(0, 0, w, h);
        // center line
        c.strokeStyle = 'rgba(215, 38, 61, 0.1)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(0, mid); c.lineTo(w, mid); c.stroke();
        // waveform
        c.strokeStyle = 'rgba(226, 232, 238, 0.5)'; c.lineWidth = 1; c.beginPath();
        for (let x = 0; x < w; x++) {
            const idx = Math.floor(x * data.length / w);
            const y = mid - (data[idx] || 0) * (mid - 4);
            x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
    }

    function updateRegionUI() {
        if (!regionAudioBuffer) return;
        const totalDur = regionAudioBuffer.duration;
        const selDur = Math.min(1, totalDur);

        // Clamp regionStart
        regionStart = Math.max(0, Math.min(regionStart, totalDur - selDur));

        const wrap = document.getElementById('region-wrap');
        const wrapW = wrap.clientWidth;
        const leftPct = regionStart / totalDur;
        const rightPct = (regionStart + selDur) / totalDur;

        const sel = document.getElementById('region-selector');
        const oLeft = document.getElementById('region-overlay-left');
        const oRight = document.getElementById('region-overlay-right');

        sel.style.left = (leftPct * 100) + '%';
        sel.style.width = ((rightPct - leftPct) * 100) + '%';
        oLeft.style.width = (leftPct * 100) + '%';
        oRight.style.width = ((1 - rightPct) * 100) + '%';

        const tEl = document.getElementById('region-time');
        if (tEl) tEl.textContent = regionStart.toFixed(2) + 's – ' + (regionStart + selDur).toFixed(2) + 's';

        const dLabel = document.getElementById('region-duration-label');
        if (dLabel) dLabel.textContent = '(total: ' + totalDur.toFixed(2) + 's)';
    }

    function regionMouseDown(e) {
        if (!regionAudioBuffer) return;
        const target = e.target;
        if (target.id === 'region-handle-left') regionDragType = 'left';
        else if (target.id === 'region-handle-right') regionDragType = 'right';
        else regionDragType = 'move';

        regionDragStartX = e.clientX || (e.touches && e.touches[0].clientX);
        regionDragStartLeft = regionStart;
        e.preventDefault();

        document.addEventListener('mousemove', regionMouseMove);
        document.addEventListener('mouseup', regionMouseUp);
        document.addEventListener('touchmove', regionMouseMove, { passive: false });
        document.addEventListener('touchend', regionMouseUp);
    }

    function regionMouseMove(e) {
        if (!regionDragType || !regionAudioBuffer) return;
        e.preventDefault();
        const wrap = document.getElementById('region-wrap');
        const wrapW = wrap.clientWidth;
        const totalDur = regionAudioBuffer.duration;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const dx = clientX - regionDragStartX;
        const dtSec = (dx / wrapW) * totalDur;

        if (regionDragType === 'move') {
            regionStart = regionDragStartLeft + dtSec;
        }
        // For left/right handle, just move the whole region (since fixed 1s)
        else {
            regionStart = regionDragStartLeft + dtSec;
        }

        updateRegionUI();
    }

    function regionMouseUp() {
        regionDragType = null;
        document.removeEventListener('mousemove', regionMouseMove);
        document.removeEventListener('mouseup', regionMouseUp);
        document.removeEventListener('touchmove', regionMouseMove);
        document.removeEventListener('touchend', regionMouseUp);
    }

    async function useRegionSelection() {
        if (!regionAudioBuffer) return;
        const totalDur = regionAudioBuffer.duration;
        const selDur = Math.min(1, totalDur);
        const startSample = Math.floor(regionStart * regionAudioBuffer.sampleRate);
        const endSample = Math.floor((regionStart + selDur) * regionAudioBuffer.sampleRate);

        // Extract the selected region into a new buffer
        const numFrames = endSample - startSample;
        const ctx = getAudioCtx();
        const newBuf = ctx.createBuffer(1, numFrames, regionAudioBuffer.sampleRate);
        const srcData = regionAudioBuffer.getChannelData(0);
        const dstData = newBuf.getChannelData(0);
        for (let i = 0; i < numFrames; i++) {
            dstData[i] = srcData[startSample + i] || 0;
        }

        const address = await processAudioBuffer(newBuf);
        regionAudioBuffer = null;
        navigateToTrack(address);
    }

    function previewRegion() {
        if (!regionAudioBuffer) return;
        const ctx = getAudioCtx();
        const totalDur = regionAudioBuffer.duration;
        const selDur = Math.min(1, totalDur);

        const source = ctx.createBufferSource();
        source.buffer = regionAudioBuffer;
        source.connect(ctx.destination);
        source.start(0, regionStart, selDur);
    }

    // ─── Audio Processing ────────────────────────────────────
    async function processAudioBuffer(audioBuffer) {
        const offlineCtx = new OfflineAudioContext(1, NUM_SAMPLES, SAMPLE_RATE);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        const rendered = await offlineCtx.startRendering();
        const float32 = rendered.getChannelData(0);
        const bytes = new Uint8Array(NUM_SAMPLES);
        for (let i = 0; i < NUM_SAMPLES; i++) {
            bytes[i] = Math.round((Math.max(-1, Math.min(1, float32[i] || 0)) + 1) * 127.5);
        }
        return bytesToBase64url(bytes);
    }

    // ─── File Upload ─────────────────────────────────────────
    async function handleFileUpload(file) {
        if (!file) return;
        const statusEl = document.getElementById('upload-status');
        statusEl.classList.remove('hidden'); statusEl.textContent = 'Processing…';
        try {
            const arrayBuffer = await file.arrayBuffer();
            const ctx = getAudioCtx();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            statusEl.classList.add('hidden');
            openRegionSelector(audioBuffer);
        } catch(e) {
            statusEl.textContent = 'Error: ' + e.message;
            setTimeout(() => statusEl.classList.add('hidden'), 3000);
        }
    }

    // ─── WAV Download ────────────────────────────────────────
    function downloadWAV(address) {
        const bytes = base64urlToBytes(address);
        const wavLen = 44 + NUM_SAMPLES;
        const buf = new ArrayBuffer(wavLen);
        const v = new DataView(buf);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, 'RIFF'); v.setUint32(4, wavLen - 8, true);
        ws(8, 'WAVE'); ws(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, SAMPLE_RATE, true);
        v.setUint16(32, 1, true); v.setUint16(34, 8, true);
        ws(36, 'data'); v.setUint32(40, NUM_SAMPLES, true);
        for (let i = 0; i < NUM_SAMPLES; i++) v.setUint8(44 + i, bytes[i]);

        const blob = new Blob([buf], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'babel_' + address.substring(0, 16) + '.wav';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ─── Browse ──────────────────────────────────────────────
    function updateBrowseUI() {
        const prefixChars = document.getElementById('prefix-chars');
        if (currentPrefix.length === 0) {
            prefixChars.innerHTML = '<span class="prefix-root">∅ Root</span>';
        } else {
            prefixChars.innerHTML = currentPrefix.split('').map((ch, i) =>
                `<span class="prefix-char" data-idx="${i}">${ch}</span>`
            ).join('');
        }

        const infoEl = document.getElementById('prefix-info');
        const remaining = ADDRESS_LENGTH - currentPrefix.length;
        if (currentPrefix.length === 0) {
            infoEl.innerHTML = 'You are at the root. All 2<sup>64,000</sup> tracks are below you.';
        } else {
            const bits = remaining * 6; // each b64 char ≈ 6 bits
            infoEl.innerHTML = `Depth: <strong>${currentPrefix.length}</strong> / ${ADDRESS_LENGTH}. ` +
                `≈ 2<sup>${bits.toLocaleString()}</sup> tracks in this section.`;
        }

        document.getElementById('prefix-input').value = currentPrefix;
        generateTrackList();
        if (window.location.hash !== '#/browse/' + currentPrefix)
            history.replaceState(null, '', '#/browse/' + currentPrefix);
    }

    function browseAddChar(ch) {
        if (currentPrefix.length >= ADDRESS_LENGTH || !isValidB64Char(ch)) return;
        currentPrefix += ch; updateBrowseUI();
    }
    function browseBack() { if (!currentPrefix.length) return; currentPrefix = currentPrefix.slice(0, -1); updateBrowseUI(); }
    function browseReset() { currentPrefix = ''; updateBrowseUI(); }
    function browseTruncateTo(idx) { currentPrefix = currentPrefix.substring(0, idx + 1); updateBrowseUI(); }
    function browseSetPrefix(p) {
        if (!isValidPrefix(p)) { showToast('Invalid characters'); return; }
        currentPrefix = p.substring(0, ADDRESS_LENGTH); updateBrowseUI();
    }

    function generateTrackList() {
        const container = document.getElementById('track-list'); container.innerHTML = '';
        for (let i = 0; i < TRACKS_PER_PAGE; i++) container.appendChild(createTrackItem(randomAddress(currentPrefix)));
    }

    function createTrackItem(addr) {
        const div = document.createElement('div');
        div.className = 'track-item'; div.dataset.address = addr;

        const playBtn = document.createElement('button');
        playBtn.className = 'track-play-btn'; playBtn.textContent = '▶';
        playBtn.addEventListener('click', e => { e.stopPropagation(); navigateToTrack(addr); });

        const addrSpan = document.createElement('span');
        addrSpan.className = 'track-address'; addrSpan.textContent = truncAddr(addr, 70);

        const miniCanvas = document.createElement('canvas');
        miniCanvas.className = 'track-mini-wave'; miniCanvas.width = 60; miniCanvas.height = 22;
        drawMiniWaveform(miniCanvas, base64urlToBytes(addr));

        div.appendChild(playBtn); div.appendChild(addrSpan); div.appendChild(miniCanvas);
        div.addEventListener('click', () => navigateToTrack(addr));
        return div;
    }

    // ─── Audio Mutations ─────────────────────────────────────
    const MUTATIONS = [
        {
            name: 'Reversed',
            fn: bytes => { const out = new Uint8Array(NUM_SAMPLES); for (let i = 0; i < NUM_SAMPLES; i++) out[i] = bytes[NUM_SAMPLES - 1 - i]; return out; }
        },
        {
            name: 'Inverted',
            fn: bytes => { const out = new Uint8Array(NUM_SAMPLES); for (let i = 0; i < NUM_SAMPLES; i++) out[i] = 255 - bytes[i]; return out; }
        },
        {
            name: 'Louder',
            fn: bytes => {
                const out = new Uint8Array(NUM_SAMPLES);
                for (let i = 0; i < NUM_SAMPLES; i++) {
                    const v = (bytes[i] - 128) * 1.8;
                    out[i] = Math.max(0, Math.min(255, Math.round(v + 128)));
                }
                return out;
            }
        },
        {
            name: 'Quieter',
            fn: bytes => {
                const out = new Uint8Array(NUM_SAMPLES);
                for (let i = 0; i < NUM_SAMPLES; i++) {
                    const v = (bytes[i] - 128) * 0.35;
                    out[i] = Math.round(v + 128);
                }
                return out;
            }
        },
        {
            name: 'Half-speed',
            fn: bytes => {
                const out = new Uint8Array(NUM_SAMPLES);
                for (let i = 0; i < NUM_SAMPLES; i++) out[i] = bytes[Math.floor(i / 2)];
                return out;
            }
        },
        {
            name: 'Double-speed',
            fn: bytes => {
                const out = new Uint8Array(NUM_SAMPLES);
                const half = Math.floor(NUM_SAMPLES / 2);
                for (let i = 0; i < half; i++) out[i] = bytes[i * 2];
                for (let i = half; i < NUM_SAMPLES; i++) out[i] = 128; // silence
                return out;
            }
        },
        {
            name: 'Bit-crushed',
            fn: bytes => { const out = new Uint8Array(NUM_SAMPLES); for (let i = 0; i < NUM_SAMPLES; i++) out[i] = bytes[i] & 0xE0; return out; }
        },
        {
            name: 'Echo',
            fn: bytes => {
                const out = new Uint8Array(NUM_SAMPLES);
                const delay = 1600; // 200ms at 8kHz
                for (let i = 0; i < NUM_SAMPLES; i++) {
                    const dry = bytes[i] - 128;
                    const wet = i >= delay ? (bytes[i - delay] - 128) * 0.45 : 0;
                    out[i] = Math.max(0, Math.min(255, Math.round(dry + wet + 128)));
                }
                return out;
            }
        },
    ];

    // Seeded RNG so the same address always produces the same corruption pattern
    function seededRNG(address, pct) {
        let h = 0x811c9dc5;
        const tag = address.substring(0, 32) + ':' + pct;
        for (let i = 0; i < tag.length; i++) {
            h ^= tag.charCodeAt(i); h = Math.imul(h, 0x01000193);
        }
        return function() {
            h ^= h << 13; h ^= h >> 17; h ^= h << 5;
            return (h >>> 0) / 0x100000000;
        };
    }

    function makeCorruptionMutation(pct) {
        return {
            name: pct + '% match',
            fn: (bytes, address) => {
                const out = new Uint8Array(NUM_SAMPLES);
                const rng = seededRNG(address, pct);
                const corruptFraction = 1 - pct / 100;
                for (let i = 0; i < NUM_SAMPLES; i++) {
                    if (rng() < corruptFraction) {
                        // Replace with random byte (seeded)
                        out[i] = Math.floor(rng() * 256);
                    } else {
                        out[i] = bytes[i];
                    }
                }
                return out;
            }
        };
    }

    const SIMILARITY_MUTATIONS = [95, 90, 80, 70, 50, 25].map(makeCorruptionMutation);

    function generateNeighbors(address) {
        const container = document.getElementById('neighbor-list');
        if (!container) return; container.innerHTML = '';
        const bytes = base64urlToBytes(address);
        MUTATIONS.forEach(mut => {
            const mutatedBytes = mut.fn(bytes, address);
            const mutAddr = bytesToBase64url(mutatedBytes);
            container.appendChild(createVariationItem(mutAddr, mut.name, mutatedBytes));
        });
        SIMILARITY_MUTATIONS.forEach(mut => {
            const mutatedBytes = mut.fn(bytes, address);
            const mutAddr = bytesToBase64url(mutatedBytes);
            container.appendChild(createVariationItem(mutAddr, mut.name, mutatedBytes));
        });
    }

    function createVariationItem(addr, label, bytes) {
        const div = document.createElement('div');
        div.className = 'track-item'; div.dataset.address = addr;

        const playBtn = document.createElement('button');
        playBtn.className = 'track-play-btn'; playBtn.textContent = '▶';
        playBtn.addEventListener('click', e => { e.stopPropagation(); navigateVariation(addr, label); });

        const tag = document.createElement('span');
        tag.className = 'variation-label';
        if (label.includes('%')) tag.classList.add('similarity');
        tag.textContent = label;

        const addrSpan = document.createElement('span');
        addrSpan.className = 'track-address'; addrSpan.textContent = truncAddr(addr, 50);

        const miniCanvas = document.createElement('canvas');
        miniCanvas.className = 'track-mini-wave'; miniCanvas.width = 60; miniCanvas.height = 22;
        drawMiniWaveform(miniCanvas, bytes);

        div.appendChild(playBtn); div.appendChild(tag); div.appendChild(addrSpan); div.appendChild(miniCanvas);
        div.addEventListener('click', () => navigateVariation(addr, label));
        return div;
    }

    // ─── Player Bar ──────────────────────────────────────────
    function showPlayerBar() {
        const bar = document.getElementById('player-bar');
        if (bar) bar.classList.remove('hidden');
    }

    // ─── Toast ───────────────────────────────────────────────
    function showToast(msg) {
        const t = document.getElementById('toast'); if (!t) return;
        t.textContent = msg; t.classList.remove('hidden'); t.classList.add('show');
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 250); }, 2000);
    }

    // ─── Router ──────────────────────────────────────────────
    function navigateToTrack(address) {
        mutationHistory = [];
        currentAddress = address;
        window.location.hash = '#/play/' + address;
    }

    function navigateVariation(address, label) {
        mutationHistory.push({ label: label, address: currentAddress });
        currentAddress = address;
        window.location.hash = '#/play/' + address;
    }

    function showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = document.getElementById('view-' + viewId);
        if (view) view.classList.add('active');

        // Nav visibility
        const nav = document.getElementById('main-nav');
        const main = document.getElementById('main-content');
        if (viewId === 'portal') {
            nav.classList.add('nav-hidden');
            main.classList.remove('has-nav');
        } else {
            nav.classList.remove('nav-hidden');
            main.classList.add('has-nav');
        }

        // Nav active state
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        const navLink = document.querySelector(`.nav-links a[data-view="${viewId}"]`);
        if (navLink) navLink.classList.add('active');

        if (viewId === 'portal') startPortalAnimation(); else stopPortalAnimation();
    }

    function route() {
        const hash = window.location.hash || '#/';
        const parts = hash.substring(2).split('/');
        const view = parts[0] || '';

        document.querySelector('.nav-links')?.classList.remove('open');

        switch (view) {
            case '':
                showView('portal'); break;
            case 'browse':
                showView('browse');
                const prefix = parts.slice(1).join('/');
                if (prefix && isValidPrefix(prefix)) currentPrefix = prefix;
                updateBrowseUI(); break;
            case 'search':
                showView('search'); break;
            case 'region':
                showView('region'); break;
            case 'play': {
                const addr = parts.slice(1).join('/');
                showView('play');
                if (addr && addr.length > 0) {
                    let full = addr;
                    if (full.length < ADDRESS_LENGTH) full = randomAddress(full);
                    currentAddress = full.substring(0, ADDRESS_LENGTH);
                    showTrackView(currentAddress);
                }
                break;
            }
            case 'about':
                showView('about'); break;
            default:
                showView('portal');
        }
    }

    function showTrackView(address) {
        const bytes = base64urlToBytes(address);
        drawStaticWaveform(document.getElementById('play-waveform'), bytes);

        const specCanvas = document.getElementById('play-spectrum');
        if (specCanvas) {
            const c = specCanvas.getContext('2d');
            c.fillStyle = BG_DARK; c.fillRect(0, 0, specCanvas.width, specCanvas.height);
        }

        const addrBox = document.getElementById('address-box');
        if (addrBox) addrBox.textContent = address;
        const addrLen = document.getElementById('address-len');
        if (addrLen) addrLen.textContent = `(${address.length.toLocaleString()} chars)`;

        updateProgress(0); updatePlayButtons(false);
        playTrack(address);
        generateNeighbors(address);
        renderMutationHistory();
    }

    function renderMutationHistory() {
        const panel = document.getElementById('history-panel');
        if (!panel) return;
        if (mutationHistory.length === 0) {
            panel.classList.add('hidden'); return;
        }
        panel.classList.remove('hidden');
        const list = document.getElementById('history-list');
        list.innerHTML = '';

        // Origin entry
        const originLi = document.createElement('li');
        originLi.className = 'history-entry history-origin';
        originLi.innerHTML = '<span class="history-label">Origin</span>' +
            '<span class="history-addr">' + truncAddr(mutationHistory[0].address, 40) + '</span>';
        originLi.addEventListener('click', () => {
            const addr = mutationHistory[0].address;
            mutationHistory = [];
            currentAddress = addr;
            window.location.hash = '#/play/' + addr;
        });
        list.appendChild(originLi);

        // Each mutation step
        mutationHistory.forEach((step, idx) => {
            const li = document.createElement('li');
            li.className = 'history-entry';
            const isSimilarity = step.label.includes('%');
            li.innerHTML = '<span class="history-arrow">→</span>' +
                '<span class="history-mutation' + (isSimilarity ? ' similarity' : '') + '">' + step.label + '</span>';
            if (idx < mutationHistory.length - 1) {
                // Can click to go back to this intermediate step
                const targetAddr = mutationHistory[idx + 1].address;
                li.addEventListener('click', () => {
                    mutationHistory = mutationHistory.slice(0, idx + 1);
                    currentAddress = targetAddr;
                    window.location.hash = '#/play/' + targetAddr;
                });
            }
            list.appendChild(li);
        });

        // Current (final) entry
        const curLi = document.createElement('li');
        curLi.className = 'history-entry history-current';
        curLi.innerHTML = '<span class="history-arrow">→</span>' +
            '<span class="history-addr current">' + truncAddr(currentAddress, 40) + '</span>';
        list.appendChild(curLi);
    }

    // ─── Events ──────────────────────────────────────────────
    function bindEvents() {
        window.addEventListener('hashchange', route);

        document.getElementById('nav-hamburger')?.addEventListener('click', () => {
            document.querySelector('.nav-links')?.classList.toggle('open');
        });

        // Random
        document.querySelectorAll('[data-action="random"]').forEach(el => {
            el.addEventListener('click', e => { e.preventDefault(); navigateToTrack(randomAddress()); });
        });

        // Browse char grid
        const charGrid = document.getElementById('char-grid');
        if (charGrid) {
            B64.split('').forEach(ch => {
                const btn = document.createElement('button');
                btn.className = 'char-btn'; btn.textContent = ch;
                if (ch >= 'A' && ch <= 'Z') btn.dataset.type = 'upper';
                else if (ch >= 'a' && ch <= 'z') btn.dataset.type = 'lower';
                else if (ch >= '0' && ch <= '9') btn.dataset.type = 'digit';
                else btn.dataset.type = 'symbol';
                btn.addEventListener('click', () => browseAddChar(ch));
                charGrid.appendChild(btn);
            });
        }

        document.getElementById('btn-back')?.addEventListener('click', browseBack);
        document.getElementById('btn-reset')?.addEventListener('click', browseReset);

        document.getElementById('btn-go-prefix')?.addEventListener('click', () => {
            const inp = document.getElementById('prefix-input');
            if (inp) browseSetPrefix(inp.value.trim());
        });
        document.getElementById('prefix-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); browseSetPrefix(e.target.value.trim()); }
        });

        document.getElementById('prefix-chars')?.addEventListener('click', e => {
            const el = e.target.closest('.prefix-char');
            if (el) { const idx = parseInt(el.dataset.idx, 10); if (!isNaN(idx)) browseTruncateTo(idx); }
        });

        document.getElementById('btn-regenerate')?.addEventListener('click', generateTrackList);
        document.getElementById('btn-play-random-section')?.addEventListener('click', () => navigateToTrack(randomAddress(currentPrefix)));

        // Search: Record
        document.getElementById('btn-record')?.addEventListener('click', () => {
            if (isRecording) stopRecording(); else startRecording();
        });
        document.getElementById('btn-stop-record')?.addEventListener('click', stopRecording);

        // Search: Upload
        document.getElementById('file-upload')?.addEventListener('change', e => {
            if (e.target.files.length > 0) { handleFileUpload(e.target.files[0]); e.target.value = ''; }
        });

        // Search: Direct address
        document.getElementById('btn-go-address')?.addEventListener('click', () => {
            const inp = document.getElementById('address-input'); if (!inp) return;
            let addr = inp.value.trim().replace(/[^A-Za-z0-9\-_]/g, '');
            if (!addr.length) { showToast('Enter an address'); return; }
            if (addr.length < ADDRESS_LENGTH) { addr = randomAddress(addr); showToast('Padded to full length'); }
            navigateToTrack(addr.substring(0, ADDRESS_LENGTH));
        });

        // Region selector
        const regionSel = document.getElementById('region-selector');
        if (regionSel) {
            regionSel.addEventListener('mousedown', regionMouseDown);
            regionSel.addEventListener('touchstart', regionMouseDown, { passive: false });
        }
        document.getElementById('btn-use-region')?.addEventListener('click', useRegionSelection);
        document.getElementById('btn-play-region')?.addEventListener('click', previewRegion);
        document.getElementById('btn-cancel-region')?.addEventListener('click', () => {
            regionAudioBuffer = null; window.location.hash = '#/search';
        });

        // Player
        document.getElementById('btn-play-main')?.addEventListener('click', togglePlayback);
        document.getElementById('bar-play-btn')?.addEventListener('click', togglePlayback);

        document.getElementById('btn-copy-address')?.addEventListener('click', () => {
            if (currentAddress) navigator.clipboard.writeText(currentAddress).then(() => showToast('Copied')).catch(() => showToast('Failed'));
        });
        document.getElementById('btn-copy-link')?.addEventListener('click', () => {
            if (currentAddress) {
                const link = 'https://playlistofbabel.z3r0c1ph3r.com/#/play/' + currentAddress;
                navigator.clipboard.writeText(link).then(() => showToast('Link copied')).catch(() => showToast('Failed'));
            }
        });
        document.getElementById('btn-browse-section')?.addEventListener('click', () => {
            if (currentAddress) { currentPrefix = currentAddress.substring(0, 8); window.location.hash = '#/browse/' + currentPrefix; }
        });
        document.getElementById('btn-download')?.addEventListener('click', () => { if (currentAddress) downloadWAV(currentAddress); });
        document.getElementById('bar-view-btn')?.addEventListener('click', () => { if (currentAddress) window.location.hash = '#/play/' + currentAddress; });

        window.addEventListener('resize', () => {
            const c = document.getElementById('portal-wave');
            if (c && c.closest('.view.active')) { c.width = c.parentElement.clientWidth; c.height = c.parentElement.clientHeight; }
        });
    }

    // ─── Init ────────────────────────────────────────────────
    function init() { bindEvents(); route(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
