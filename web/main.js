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

let camera, tracker, ui;
let lastTime = 0;
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

    // Set canvas size to match video aspect ratio
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

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

    requestAnimationFrame(loop);
}

function loop(timestamp) {
    // Calculate FPS
    const dt = timestamp - lastTime;
    if (dt >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = timestamp;
        fpsEl.innerText = `FPS: ${fps}`;
    }
    frames++;

    // Draw video to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get current frame for OpenCV
    const frame = cv.imread(canvas);

    // Handle new ROI selection
    const newRoi = ui.consumeROI();
    if (newRoi) {
        tracker.init(frame, newRoi);
    }

    // Update tracking
    const result = tracker.update(frame);

    // UI Feedback
    statusEl.innerText = `STATUS: ${tracker.status}`;
    statusEl.style.color = tracker.status === "LOCKED" ? "#00ff41" : "#ffff00";

    // Overlay drawing
    if (tracker.status === "LOCKED" && tracker.roi) {
        const [x, y, w, h] = tracker.roi;
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Draw points
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
    requestAnimationFrame(loop);
}

start();
