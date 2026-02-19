import { Camera } from './src/camera.js';
import { Tracker } from './src/tracker.js';
import { UIManager } from './src/ui.js';

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const overlay = document.getElementById('selection-overlay');
const fpsEl = document.getElementById('fps');
const statusEl = document.getElementById('status');
const camToggle = document.getElementById('camera-toggle');
const resetBtn = document.getElementById('reset-btn');

// Sensor State
let zoomScale = 1;
const panOffset = { x: 0.5, y: 0.5 };
let isIsolateMode = false;

// Multi-Target Tracker Array
let trackers = [];
let activeIndex = 0;
const MAX_TRACKERS = 5;

// Radar Auto-Acquisition State
let isRadarMode = false;
let radarPrevGray = null;
let radarMinArea = 200; // Controlled by SENS slider
const RADAR_STABLE_THRESHOLD = 5;

// Per-contact stability tracking for multi-target radar
// Map of contact key => { candidate, stableFrames }
let radarContacts = new Map();

let camera, ui;
let lastTime = 0;
let lastFpsUpdate = 0;
let frames = 0;
let fps = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function getActive() {
    return trackers[activeIndex] || null;
}

function cullLostTrackers() {
    trackers = trackers.filter(t => t.status !== 'LOST');
    if (activeIndex >= trackers.length) activeIndex = Math.max(0, trackers.length - 1);
}

function spawnTracker(frame, roi) {
    if (trackers.length >= MAX_TRACKERS) return null;
    const t = new Tracker();
    // Inherit settings from active tracker if one exists
    if (trackers.length > 0) {
        const src = getActive();
        t.levelMode = src.levelMode;
        t.exposure = src.exposure;
        t.contrast = src.contrast;
        t.levelCenter = src.levelCenter;
        t.levelWidth = src.levelWidth;
        t.intensityGate = src.intensityGate;
    }
    if (t.init(frame, roi)) {
        trackers.push(t);
        return t;
    }
    return null;
}

// Draw corner bracket box (compact tactical indicator)
function drawBrackets(x, y, w, h, color, lineWidth = 1, label = '') {
    const cLen = Math.min(12, w * 0.3, h * 0.3);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([]);
    // TL
    ctx.beginPath(); ctx.moveTo(x, y + cLen); ctx.lineTo(x, y); ctx.lineTo(x + cLen, y); ctx.stroke();
    // TR
    ctx.beginPath(); ctx.moveTo(x + w - cLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cLen); ctx.stroke();
    // BL
    ctx.beginPath(); ctx.moveTo(x, y + h - cLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cLen, y + h); ctx.stroke();
    // BR
    ctx.beginPath(); ctx.moveTo(x + w - cLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cLen); ctx.stroke();
    if (label) {
        ctx.fillStyle = color;
        ctx.font = '9px monospace';
        ctx.fillText(label, x + 2, y - 3);
    }
}

// ── Init ───────────────────────────────────────────────────────────────────

async function start() {
    if (typeof cv === 'undefined' || !cv.Mat) {
        setTimeout(start, 50);
        return;
    }

    camera = new Camera(video);
    ui = new UIManager(canvas, overlay);

    await camera.init();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Seed one tracker so settings sliders always have a target
    trackers = [new Tracker()];
    activeIndex = 0;

    // ── Controls ─────────────────────────────────────────────────────────

    camToggle.onclick = async () => {
        statusEl.innerText = 'STATUS: INITIALIZING CAM';
        await camera.switch();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    };

    resetBtn.onclick = () => {
        trackers.forEach(t => { if (t.prevGray) t.prevGray.delete(); });
        trackers = [new Tracker()];
        activeIndex = 0;
        radarContacts.clear();
        if (radarPrevGray) { radarPrevGray.delete(); radarPrevGray = null; }
    };

    // Cycle buttons
    document.getElementById('prev-btn').onclick = () => {
        if (trackers.length === 0) return;
        activeIndex = (activeIndex - 1 + trackers.length) % trackers.length;
    };
    document.getElementById('next-btn').onclick = () => {
        if (trackers.length === 0) return;
        activeIndex = (activeIndex + 1) % trackers.length;
    };

    // Radar toggle
    const radarBtn = document.getElementById('radar-btn');
    radarBtn.onclick = () => {
        isRadarMode = !isRadarMode;
        radarBtn.innerText = isRadarMode ? '📡 RDR' : 'RDR';
        radarBtn.style.color = isRadarMode ? 'var(--accent)' : 'var(--primary)';
        radarBtn.style.borderWidth = isRadarMode ? '2px' : '1px';
        radarBtn.style.boxShadow = isRadarMode ? '0 0 10px var(--accent)' : 'none';
        radarContacts.clear();
        if (radarPrevGray) { radarPrevGray.delete(); radarPrevGray = null; }
    };

    // Zoom
    const magEl = document.getElementById('mag-display');
    const updateZoom = (delta) => {
        const scales = [1, 2, 4, 8, 16];
        let idx = scales.indexOf(zoomScale);
        idx = Math.max(0, Math.min(scales.length - 1, idx + delta));
        zoomScale = scales[idx];
        magEl.innerText = `${zoomScale}X`;
    };
    document.getElementById('zoom-in').onclick = () => updateZoom(1);
    document.getElementById('zoom-out').onclick = () => updateZoom(-1);

    // Slew
    let slewInterval = null;
    const startSlew = (dx, dy) => {
        if (slewInterval) return;
        const slewStep = () => {
            const step = 0.02 / zoomScale;
            panOffset.x = Math.max(0, Math.min(1, panOffset.x + dx * step));
            panOffset.y = Math.max(0, Math.min(1, panOffset.y + dy * step));
        };
        slewStep();
        slewInterval = setInterval(slewStep, 50);
    };
    const stopSlew = () => { if (slewInterval) { clearInterval(slewInterval); slewInterval = null; } };
    const bindSlew = (id, dx, dy) => {
        const btn = document.getElementById(id);
        btn.addEventListener('mousedown', () => startSlew(dx, dy));
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startSlew(dx, dy); });
        window.addEventListener('mouseup', stopSlew);
        window.addEventListener('touchend', stopSlew);
    };
    bindSlew('slew-up', 0, -1);
    bindSlew('slew-down', 0, 1);
    bindSlew('slew-left', -1, 0);
    bindSlew('slew-right', 1, 0);

    // Contrast / Isolation Controls — apply to active tracker
    const gainBtn = document.getElementById('level-mode-btn');
    const isolateBtn = document.getElementById('isolate-btn');

    const updateControlVisibility = () => {
        const mode = getActive()?.levelMode || 'AUTO';
        const lvl = document.getElementById('lvl-ctrl');
        const wid = document.getElementById('wid-ctrl');
        const hue = document.getElementById('hue-ctrl');
        const sat = document.getElementById('sat-ctrl');
        const val = document.getElementById('val-ctrl-min');
        if (lvl) lvl.style.display = (mode === 'SLICE' || mode === 'SKY') ? 'block' : 'none';
        if (wid) wid.style.display = (mode === 'SLICE') ? 'block' : 'none';
        if (hue) hue.style.display = (mode === 'CHROMA') ? 'block' : 'none';
        if (sat) sat.style.display = (mode === 'CHROMA') ? 'block' : 'none';
        if (val) val.style.display = (mode === 'CHROMA') ? 'block' : 'none';
        if (lvl) { const label = lvl.querySelector('label'); label.innerText = mode === 'SKY' ? 'THR' : 'LVL'; }
        gainBtn.style.borderWidth = mode === 'AUTO' ? '1px' : '2px';
        gainBtn.style.boxShadow = mode === 'AUTO' ? 'none' : '0 0 10px var(--accent)';
    };

    gainBtn.onclick = () => {
        const t = getActive(); if (!t) return;
        const modes = ['AUTO', 'SLICE', 'CHROMA', 'SKY'];
        t.levelMode = modes[(modes.indexOf(t.levelMode) + 1) % modes.length];
        gainBtn.innerText = t.levelMode;
        gainBtn.style.color = t.levelMode === 'AUTO' ? 'var(--primary)' : 'var(--accent)';
        updateControlVisibility();
    };

    isolateBtn.onclick = () => {
        isIsolateMode = !isIsolateMode;
        isolateBtn.innerText = isIsolateMode ? 'ISOL' : 'NORM';
        isolateBtn.style.color = isIsolateMode ? '#ffff00' : '#00ff41';
    };

    // Sensor Calibration Sliders
    const sensorPanel = document.getElementById('sensor-panel');
    const sensorToggle = document.getElementById('sensor-toggle');
    sensorToggle.onclick = () => {
        sensorPanel.classList.toggle('active');
        sensorToggle.style.background = sensorPanel.classList.contains('active') ? 'var(--primary)' : 'transparent';
        sensorToggle.style.color = sensorPanel.classList.contains('active') ? 'var(--bg)' : 'var(--primary)';
        updateControlVisibility();
    };

    const setupSlider = (id, valId, prop) => {
        const slider = document.getElementById(id);
        const val = document.getElementById(valId);
        if (!slider || !val) return;
        slider.oninput = () => {
            const value = parseFloat(slider.value);
            const t = getActive(); if (t) t[prop] = value;
            val.innerText = value.toFixed(prop === 'contrast' ? 1 : 0);
        };
    };

    setupSlider('exp-slider', 'exp-val', 'exposure');
    setupSlider('con-slider', 'con-val', 'contrast');
    setupSlider('lvl-slider', 'lvl-val', 'levelCenter');
    setupSlider('wid-slider', 'wid-val', 'levelWidth');
    setupSlider('hue-slider', 'hue-val', 'hueCenter');
    setupSlider('sat-slider', 'sat-val', 'satMin');
    setupSlider('val-slider-min', 'val-val-min', 'valMin');

    const gateSlider = document.getElementById('gate-slider');
    const gateVal = document.getElementById('gate-val');
    gateSlider.oninput = () => {
        const value = parseInt(gateSlider.value);
        const t = getActive(); if (t) t.intensityGate = value;
        gateVal.innerText = value >= 255 ? 'OFF' : value;
    };

    // SENS slider — controls radarMinArea
    const sensSlider = document.getElementById('sens-slider');
    const sensVal = document.getElementById('sens-val');
    if (sensSlider) {
        sensSlider.oninput = () => {
            radarMinArea = parseInt(sensSlider.value);
            if (sensVal) sensVal.innerText = radarMinArea;
        };
    }

    updateControlVisibility();
    requestAnimationFrame(loop);
}

// ── Render Loop ────────────────────────────────────────────────────────────

function loop(timestamp) {
    if (video.videoWidth === 0 || video.videoHeight === 0) { requestAnimationFrame(loop); return; }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        trackers.forEach(t => { t.status = 'STANDBY'; t.roi = null; });
    }

    if (!lastTime) lastTime = timestamp;
    if (!lastFpsUpdate) lastFpsUpdate = timestamp;

    const dt_ms = timestamp - lastTime;
    lastTime = timestamp;
    const dt = dt_ms / 16.67;

    if (timestamp - lastFpsUpdate >= 1000) {
        fps = frames; frames = 0; lastFpsUpdate = timestamp;
        fpsEl.innerText = `FPS: ${fps}`;
    }
    frames++;

    const sw = video.videoWidth / zoomScale;
    const sh = video.videoHeight / zoomScale;
    const sx = (video.videoWidth - sw) * panOffset.x;
    const sy = (video.videoHeight - sh) * panOffset.y;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    let frame;
    try {
        frame = cv.imread(canvas);

        // Apply visual isolation if enabled (uses active tracker's settings)
        if (isIsolateMode) {
            const t = getActive();
            if (t) {
                let gray = new cv.Mat();
                cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
                t.enhanceContrast(frame, gray, new cv.Rect(0, 0, gray.cols, gray.rows));
                cv.cvtColor(gray, frame, cv.COLOR_GRAY2RGBA);
                cv.imshow(canvas, frame);
                gray.delete();
            }
        }

        // Manual ROI selection → spawn a new tracker
        const newRoi = ui.consumeROI();
        if (newRoi) {
            spawnTracker(frame, newRoi);
            activeIndex = trackers.length - 1;
        }

        // ── RADAR AUTO-ACQUISITION ──────────────────────────────────────────
        if (isRadarMode) {
            const currGray = new cv.Mat();
            cv.cvtColor(frame, currGray, cv.COLOR_RGBA2GRAY);

            if (radarPrevGray && radarPrevGray.rows === currGray.rows && radarPrevGray.cols === currGray.cols) {
                const diff = new cv.Mat();
                cv.absdiff(radarPrevGray, currGray, diff);
                cv.threshold(diff, diff, 20, 255, cv.THRESH_BINARY);
                const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
                cv.dilate(diff, diff, kernel, new cv.Point(-1, -1), 2);
                kernel.delete();

                const contours = new cv.MatVector();
                const hierarchy = new cv.Mat();
                cv.findContours(diff, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                // Collect all contacts above threshold
                const rawContacts = [];
                for (let i = 0; i < contours.size(); i++) {
                    const c = contours.get(i);
                    const area = cv.contourArea(c);
                    if (area > radarMinArea) {
                        rawContacts.push({ rect: cv.boundingRect(c), area });
                    }
                    c.delete();
                }
                contours.delete(); hierarchy.delete(); diff.delete();

                // Sort by area descending (largest = primary)
                rawContacts.sort((a, b) => b.area - a.area);

                // Draw all raw contacts (dim orange)
                rawContacts.forEach(({ rect: r }) => {
                    ctx.strokeStyle = 'rgba(255,165,0,0.35)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([]);
                    ctx.strokeRect(r.x, r.y, r.width, r.height);
                });

                // Match raw contacts to stable contact slots by proximity
                const usedKeys = new Set();
                rawContacts.slice(0, MAX_TRACKERS).forEach(({ rect: r }, ci) => {
                    // Find nearest existing contact
                    let bestKey = null, bestDist = 60;
                    for (const [key, slot] of radarContacts) {
                        const dist = Math.hypot(slot.candidate.x - r.x, slot.candidate.y - r.y);
                        if (dist < bestDist) { bestDist = dist; bestKey = key; }
                    }
                    const key = bestKey || `contact_${Date.now()}_${ci}`;
                    usedKeys.add(key);
                    const slot = radarContacts.get(key) || { candidate: r, stableFrames: 0 };
                    slot.stableFrames++;
                    slot.candidate = r;
                    radarContacts.set(key, slot);

                    // Draw pulsing candidate box
                    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150 + ci);
                    ctx.strokeStyle = `rgba(255,165,0,${pulse})`;
                    ctx.lineWidth = ci === 0 ? 2 : 1;
                    ctx.setLineDash([]);
                    ctx.strokeRect(r.x, r.y, r.width, r.height);
                    ctx.fillStyle = 'orange';
                    ctx.font = '9px monospace';
                    ctx.fillText(`ACQU [${slot.stableFrames}/${RADAR_STABLE_THRESHOLD}]`, r.x, r.y - 3);

                    // Spawn tracker when stable
                    if (slot.stableFrames >= RADAR_STABLE_THRESHOLD) {
                        const alreadyLocked = trackers.some(t =>
                            t.status === 'LOCKED' && t.roi &&
                            Math.hypot(t.roi[0] - r.x, t.roi[1] - r.y) < 60
                        );
                        if (!alreadyLocked) {
                            const roi = [r.x, r.y, r.width, r.height];
                            spawnTracker(frame, roi);
                        }
                        radarContacts.delete(key);
                    }
                });

                // Prune stale contacts
                for (const key of radarContacts.keys()) {
                    if (!usedKeys.has(key)) radarContacts.delete(key);
                }

                // Status
                const lockedCount = trackers.filter(t => t.status === 'LOCKED').length;
                if (rawContacts.length > 0) {
                    statusEl.innerText = `STATUS: RADAR [${rawContacts.length} TGT | ${lockedCount} LCK]`;
                    statusEl.style.color = 'orange';
                } else {
                    statusEl.innerText = 'STATUS: RADAR [SCANNING]';
                    statusEl.style.color = 'rgba(255,165,0,0.7)';
                }
            }

            if (radarPrevGray) radarPrevGray.delete();
            radarPrevGray = currGray;
        }
        // ──────────────────────────────────────────────────────────────────

        // Update all trackers
        const results = trackers.map(t => t.update(frame, dt));

        // Cull lost trackers
        cullLostTrackers();

        // Status for non-radar mode
        if (!isRadarMode) {
            const active = getActive();
            statusEl.innerText = `STATUS: ${active?.status || 'STANDBY'} [${activeIndex + 1}/${trackers.length}]`;
            statusEl.style.color = active?.status === 'LOCKED' ? '#00ff41' : '#ffff00';
        } else if (trackers.some(t => t.status === 'LOCKED')) {
            const lockedCount = trackers.filter(t => t.status === 'LOCKED').length;
            statusEl.innerText = `STATUS: RADAR LOCK [${lockedCount} TGT]`;
            statusEl.style.color = '#00ff41';
        }

        // ── Render all trackers ──────────────────────────────────────────

        trackers.forEach((t, i) => {
            if (t.status !== 'LOCKED' || !t.roi) return;
            const [x, y, w, h] = t.roi;
            const cx = x + w / 2;
            const cy = y + h / 2;
            const isActive = (i === activeIndex);

            if (isActive) {
                // ── Active tracker: full reticle ──

                // Corner brackets (green)
                drawBrackets(x, y, w, h, '#00ff41', 1.5, `T${i + 1}`);

                // Full-screen dashed crosshairs
                ctx.strokeStyle = 'rgba(255,255,0,0.35)';
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 15]);
                ctx.beginPath();
                ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
                ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
                ctx.stroke();
                ctx.setLineDash([]);

                // Box crosshair
                ctx.strokeStyle = '#00ff41';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx, y - 5); ctx.lineTo(cx, y + h + 5);
                ctx.moveTo(x - 5, cy); ctx.lineTo(x + w + 5, cy);
                ctx.stroke();

                // Center dot + ring
                ctx.fillStyle = '#ffff00';
                ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#00ff41';
                ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();

                // Telemetry
                const normX = cx / canvas.width;
                const normY = cy / canvas.height;
                document.getElementById('tgt-coord').innerText = `TGT: X ${normX.toFixed(3)} / Y ${normY.toFixed(3)}`;

                // Feature points
                const result = results[i];
                if (result?.points) {
                    ctx.fillStyle = '#ffff00';
                    result.points.forEach(p => {
                        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
                    });
                }

            } else {
                // ── Secondary tracker: dim cyan brackets only ──
                drawBrackets(x, y, w, h, 'rgba(0,200,200,0.6)', 1, `T${i + 1}`);
                // Small center dot
                ctx.fillStyle = 'rgba(0,200,200,0.6)';
                ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
            }
        });

        // Clear telemetry if no active tracker is locked
        const active = getActive();
        if (!active || active.status !== 'LOCKED') {
            document.getElementById('tgt-coord').innerText = 'TGT: -- / --';
        }

        frame.delete();

    } catch (e) {
        console.error('Tracking Loop Fault:', e);
        if (frame) frame.delete();
        statusEl.innerText = 'STATUS: CV FAULT';
    }

    requestAnimationFrame(loop);
}

start();
