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
const panOffset = { x: 0.5, y: 0.5 }; // Range 0 to 1
let isIsolateMode = false;

let camera, tracker, ui;
let lastTime = 0;
let lastFpsUpdate = 0;
let frames = 0;
let fps = 0;

async function start() {
    // Wait for OpenCV and its core constructors to be ready
    if (typeof cv === 'undefined' || !cv.Mat) {
        setTimeout(start, 50);
        return;
    }

    camera = new Camera(video);
    tracker = new Tracker();
    ui = new UIManager(canvas, overlay);

    await camera.init();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Controls
    camToggle.onclick = async () => {
        statusEl.innerText = "STATUS: INITIALIZING CAM";
        await camera.switch();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    };

    resetBtn.onclick = () => {
        tracker.status = "STANDBY";
        tracker.roi = null;
    };

    // Refined Zoom (+/-) logic
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

    // Continuous Slew Logic (Press and Hold)
    let slewInterval = null;
    const startSlew = (dx, dy) => {
        if (slewInterval) return;
        const slewStep = () => {
            const step = 0.02 / zoomScale; // Constant speed
            panOffset.x = Math.max(0, Math.min(1, panOffset.x + dx * step));
            panOffset.y = Math.max(0, Math.min(1, panOffset.y + dy * step));
        };
        slewStep();
        slewInterval = setInterval(slewStep, 50);
    };

    const stopSlew = () => {
        if (slewInterval) {
            clearInterval(slewInterval);
            slewInterval = null;
        }
    };

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

    // Contrast Isolation Controls
    const gainBtn = document.getElementById('level-mode-btn');
    const isolateBtn = document.getElementById('isolate-btn');

    const updateControlVisibility = () => {
        const mode = tracker.levelMode;

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

        // Update LVL label based on mode
        if (lvl) {
            const label = lvl.querySelector('label');
            label.innerText = mode === 'SKY' ? 'THR' : 'LVL';
        }

        // Highlight GAIN button if non-auto
        gainBtn.style.borderWidth = mode === 'AUTO' ? '1px' : '2px';
        gainBtn.style.boxShadow = mode === 'AUTO' ? 'none' : '0 0 10px var(--accent)';
    };

    gainBtn.onclick = () => {
        const modes = ['AUTO', 'SLICE', 'CHROMA', 'SKY'];
        let idx = modes.indexOf(tracker.levelMode);
        tracker.levelMode = modes[(idx + 1) % modes.length];
        gainBtn.innerText = tracker.levelMode;
        gainBtn.style.color = tracker.levelMode === 'AUTO' ? 'var(--primary)' : 'var(--accent)';
        updateControlVisibility();
    };

    isolateBtn.onclick = () => {
        isIsolateMode = !isIsolateMode;
        isolateBtn.innerText = isIsolateMode ? "ISOL" : "NORM";
        isolateBtn.style.color = isIsolateMode ? "#ffff00" : "#00ff41";
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
            let value = parseFloat(slider.value);
            tracker[prop] = value;
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

    // Advanced Gate Logic
    const gateSlider = document.getElementById('gate-slider');
    const gateVal = document.getElementById('gate-val');
    gateSlider.oninput = () => {
        let value = parseInt(gateSlider.value);
        tracker.intensityGate = value;
        gateVal.innerText = value >= 255 ? 'OFF' : value;
    };

    updateControlVisibility();
    requestAnimationFrame(loop);
}

function loop(timestamp) {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        requestAnimationFrame(loop);
        return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        tracker.status = "STANDBY";
        tracker.roi = null;
    }

    if (!lastTime) lastTime = timestamp;
    if (!lastFpsUpdate) lastFpsUpdate = timestamp;

    const dt_ms = timestamp - lastTime;
    lastTime = timestamp;
    const dt = dt_ms / 16.67;

    if (timestamp - lastFpsUpdate >= 1000) {
        fps = frames;
        frames = 0;
        lastFpsUpdate = timestamp;
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

        // Apply visual isolation if enabled
        if (isIsolateMode) {
            let gray = new cv.Mat();
            cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
            tracker.enhanceContrast(frame, gray, new cv.Rect(0, 0, gray.cols, gray.rows));
            cv.cvtColor(gray, frame, cv.COLOR_GRAY2RGBA);
            cv.imshow(canvas, frame);
            gray.delete();
        }

        const newRoi = ui.consumeROI();
        if (newRoi) {
            tracker.init(frame, newRoi);
        }

        const result = tracker.update(frame, dt);

        statusEl.innerText = `STATUS: ${tracker.status}`;
        statusEl.style.color = tracker.status === "LOCKED" ? "#00ff41" : "#ffff00";

        if (tracker.status === "LOCKED" && tracker.roi) {
            const [x, y, w, h] = tracker.roi;
            const cx = x + w / 2;
            const cy = y + h / 2;

            // 1. Draw Tracking Box (Outer corners only for professional look)
            ctx.strokeStyle = '#00ff41';
            ctx.lineWidth = 1;
            const cornerLen = 10;

            // Top Left
            ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
            // Top Right
            ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen); ctx.stroke();
            // Bottom Left
            ctx.beginPath(); ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h); ctx.stroke();
            // Bottom Right
            ctx.beginPath(); ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen); ctx.stroke();

            // 2. Draw Precision Strike Reticle (Full-Screen Crosshairs)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.4)'; // Yellowish glare
            ctx.setLineDash([5, 15]); // Larger dash for full screen
            ctx.beginPath();
            // Vertical full-screen line
            ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height);
            // Horizontal full-screen line
            ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
            ctx.stroke();

            // Box-localized solid crosshair (Lock on target)
            ctx.setLineDash([]);
            ctx.strokeStyle = '#00ff41';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, y - 5); ctx.lineTo(cx, y + h + 5);
            ctx.moveTo(x - 5, cy); ctx.lineTo(x + w + 5, cy);
            ctx.stroke();

            // 3. Center Target Point (Increased Size)
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2); // Slightly larger
            ctx.fill();

            // Outer Ring for center point
            ctx.strokeStyle = '#00ff41';
            ctx.beginPath();
            ctx.arc(cx, cy, 8, 0, Math.PI * 2);
            ctx.stroke();

            // 4. Update Guidance Telemetry (Normalized 0-1)
            const normX = cx / canvas.width;
            const normY = cy / canvas.height;
            document.getElementById('tgt-coord').innerText = `TGT: X ${normX.toFixed(3)} / Y ${normY.toFixed(3)}`;

            if (result && result.points) {
                ctx.fillStyle = '#ffff00';
                result.points.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); // Restored point size
                    ctx.fill();
                });
            }
        } else {
            document.getElementById('tgt-coord').innerText = `TGT: -- / --`;
        }
        frame.delete();
    } catch (e) {
        console.error("Tracking Loop Fault:", e);
        if (frame) frame.delete();
        tracker.status = "FAULT";
        statusEl.innerText = "STATUS: CV FAULT";
    }

    requestAnimationFrame(loop);
}

start();
