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

    const zoomBtn = document.getElementById('zoom-btn');
    zoomBtn.onclick = () => {
        zoomScale = zoomScale === 4 ? 1 : zoomScale * 2;
        zoomBtn.innerText = `ZOOM: ${zoomScale}X`;
    };

    // Contrast Isolation Controls
    const gainBtn = document.getElementById('level-mode-btn');
    const isolateBtn = document.getElementById('isolate-btn');

    gainBtn.onclick = () => {
        tracker.levelMode = tracker.levelMode === 'AUTO' ? 'SLICE' : 'AUTO';
        gainBtn.innerText = `GAIN: ${tracker.levelMode}`;
    };

    isolateBtn.onclick = () => {
        isIsolateMode = !isIsolateMode;
        isolateBtn.innerText = isIsolateMode ? "ISOL" : "NORM";
        isolateBtn.style.color = isIsolateMode ? "#ffff00" : "#00ff41";
    };

    // Slew logic
    const slew = (dx, dy) => {
        const step = 0.05 / zoomScale;
        panOffset.x = Math.max(0, Math.min(1, panOffset.x + dx * step));
        panOffset.y = Math.max(0, Math.min(1, panOffset.y + dy * step));
    };

    document.getElementById('slew-up').onclick = () => slew(0, -1);
    document.getElementById('slew-down').onclick = () => slew(0, 1);
    document.getElementById('slew-left').onclick = () => slew(-1, 0);
    document.getElementById('slew-right').onclick = () => slew(1, 0);

    // Sensor Calibration Sliders
    const sensorPanel = document.getElementById('sensor-panel');
    const sensorToggle = document.getElementById('sensor-toggle');

    sensorToggle.onclick = () => {
        sensorPanel.classList.toggle('active');
        sensorToggle.style.background = sensorPanel.classList.contains('active') ? 'var(--primary)' : 'transparent';
        sensorToggle.style.color = sensorPanel.classList.contains('active') ? 'var(--bg)' : 'var(--primary)';
    };

    const setupSlider = (id, valId, prop) => {
        const slider = document.getElementById(id);
        const val = document.getElementById(valId);
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
            tracker.enhanceContrast(gray, new cv.Rect(0, 0, gray.cols, gray.rows));
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
            ctx.strokeStyle = '#00ff41';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);

            if (result && result.points) {
                ctx.fillStyle = '#ffff00';
                result.points.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
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
