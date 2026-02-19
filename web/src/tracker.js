export class Tracker {
    constructor() {
        this.prevGray = null;
        this.p0 = null;
        this.roi = null;
        this.status = "STANDBY";

        this.winSize = new cv.Size(15, 15);
        this.maxLevel = 2;
        this.criteria = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 20, 0.01);

        this.p1 = null;
        this.st = null;
        this.err = null;

        this.clahe = null;
        try {
            if (typeof cv.createCLAHE === 'function') {
                this.clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
            }
        } catch (e) { }

        // Stability Parameters
        this.moveAlpha = 0.4;  // Smoothing for position
        this.scaleAlpha = 0.05; // High inertia for scaling
        this.baseSpread = 1.0;
        this.lastValidVelocity = { x: 0, y: 0 };

        // Contrast Isolation (Level Slicing)
        this.levelMode = 'AUTO'; // 'AUTO' (CLAHE) or 'SLICE'
        this.levelCenter = 127;  // 0-255
        this.levelWidth = 64;    // 1-255
    }

    enhanceContrast(gray, rect) {
        if (rect.width <= 0 || rect.height <= 0) return;
        const roi = gray.roi(rect);

        if (this.levelMode === 'SLICE') {
            // Level Slicing: Stretch [Center - Width/2, Center + Width/2] to [0, 255]
            const low = Math.max(0, this.levelCenter - this.levelWidth / 2);
            const high = Math.min(255, this.levelCenter + this.levelWidth / 2);
            const range = high - low || 1;
            const alpha = 255 / range;
            const beta = -low * alpha;

            roi.convertTo(roi, -1, alpha, beta);
        } else {
            // Default: Smart Auto (CLAHE or Equalize)
            if (this.clahe) this.clahe.apply(roi, roi);
            else cv.equalizeHist(roi, roi);
        }
        roi.delete();
    }

    init(frame, roi) {
        if (this.prevGray) this.prevGray.delete();
        this.prevGray = new cv.Mat();
        cv.cvtColor(frame, this.prevGray, cv.COLOR_RGBA2GRAY);

        const rect = new cv.Rect(
            Math.max(0, Math.floor(roi[0])), Math.max(0, Math.floor(roi[1])),
            Math.min(Math.floor(roi[2]), this.prevGray.cols - Math.max(0, Math.floor(roi[0]))),
            Math.min(Math.floor(roi[3]), this.prevGray.rows - Math.max(0, Math.floor(roi[1])))
        );

        if (rect.width > 10 && rect.height > 10) {
            this.enhanceContrast(this.prevGray, rect);
            const mask = new cv.Mat.zeros(this.prevGray.rows, this.prevGray.cols, cv.CV_8UC1);
            let maskRoi = mask.roi(rect);
            maskRoi.setTo(new cv.Scalar(255));
            maskRoi.delete();

            if (this.p0) this.p0.delete();
            this.p0 = new cv.Mat();
            cv.goodFeaturesToTrack(this.prevGray, this.p0, 100, 0.01, 7, mask);
            mask.delete();

            if (this.p0.rows > 5) {
                this.roi = roi;
                this.status = "LOCKED";
                this.baseSpread = this.calculateSpread(this.p0);
                this.lastValidVelocity = { x: 0, y: 0 };
                return true;
            }
        }
        this.status = "LOST";
        return false;
    }

    calculateSpread(mat) {
        let sx = 0, sy = 0, c = mat.rows;
        if (c < 2) return 1.0;
        for (let i = 0; i < c; i++) {
            sx += mat.data32F[i * 2]; sy += mat.data32F[i * 2 + 1];
        }
        let ax = sx / c, ay = sy / c, vs = 0;
        for (let i = 0; i < c; i++) {
            let dx = mat.data32F[i * 2] - ax, dy = mat.data32F[i * 2 + 1] - ay;
            vs += Math.sqrt(dx * dx + dy * dy);
        }
        return vs / c;
    }

    update(frame, dt = 1.0) {
        if (this.status !== "LOCKED" || !this.p0 || this.p0.rows === 0) return null;

        if (!this.p1) this.p1 = new cv.Mat();
        if (!this.st) this.st = new cv.Mat();
        if (!this.err) this.err = new cv.Mat();

        const gray = new cv.Mat();
        cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);

        cv.calcOpticalFlowPyrLK(this.prevGray, gray, this.p0, this.p1, this.st, this.err, this.winSize, this.maxLevel, this.criteria);

        let dxs = [], dys = [];
        let validPoints = [];
        for (let i = 0; i < this.st.rows; i++) {
            if (this.st.data[i] === 1) {
                const px1 = this.p1.data32F[i * 2], py1 = this.p1.data32F[i * 2 + 1];
                const px0 = this.p0.data32F[i * 2], py0 = this.p0.data32F[i * 2 + 1];
                dxs.push(px1 - px0);
                dys.push(py1 - py0);
                validPoints.push({ x: px1, y: py1 });
            }
        }

        if (validPoints.length > 5) {
            // Consensus Motion: Use Median to reject erratic individual jumps
            const getMedian = (arr) => {
                const sorted = [...arr].sort((a, b) => a - b);
                return sorted[Math.floor(sorted.length / 2)];
            };
            const medDX = getMedian(dxs);
            const medDY = getMedian(dys);

            // High Inertia Smoothing
            const currentVelocity = { x: medDX, y: medDY };
            this.lastValidVelocity.x = this.lastValidVelocity.x * (1 - this.moveAlpha) + currentVelocity.x * this.moveAlpha;
            this.lastValidVelocity.y = this.lastValidVelocity.y * (1 - this.moveAlpha) + currentVelocity.y * this.moveAlpha;

            // Scale Inertia: Average spread to prevent pulsing
            const currentSpread = this.calculateSpread(this.p1);
            let scale = currentSpread / this.baseSpread;
            // Limit scale change to 5% per frame
            scale = 1.0 * (1 - this.scaleAlpha) + Math.min(1.1, Math.max(0.9, scale)) * this.scaleAlpha;
            this.baseSpread = currentSpread;

            const [rx, ry, rw, rh] = this.roi;
            const newW = rw * scale, newH = rh * scale;
            const newX = rx + this.lastValidVelocity.x - (newW - rw) / 2;
            const newY = ry + this.lastValidVelocity.y - (newH - rh) / 2;

            this.roi = [newX, newY, newW, newH];

            // Feature Refresh Logic
            if (validPoints.length < 30) {
                this.refreshPoints(gray);
            } else {
                // Update p0 with p1 (only valid points)
                const nextP0 = new cv.Mat(validPoints.length, 1, cv.CV_32FC2);
                for (let i = 0, idx = 0; i < this.st.rows; i++) {
                    if (this.st.data[i] === 1) {
                        nextP0.data32F[idx * 2] = this.p1.data32F[i * 2];
                        nextP0.data32F[idx * 2 + 1] = this.p1.data32F[i * 2 + 1];
                        idx++;
                    }
                }
                this.p0.delete();
                this.p0 = nextP0;
            }

            this.prevGray.delete();
            this.prevGray = gray;
            return { roi: this.roi, points: validPoints };
        }

        this.status = "LOST";
        gray.delete();
        return null;
    }

    refreshPoints(gray) {
        const [x, y, w, h] = this.roi;
        const rect = new cv.Rect(
            Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)),
            Math.min(gray.cols - Math.max(0, Math.floor(x)), Math.floor(w)),
            Math.min(gray.rows - Math.max(0, Math.floor(y)), Math.floor(h))
        );
        if (rect.width < 10 || rect.height < 10) return;

        this.enhanceContrast(gray, rect);
        const mask = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
        let maskRoi = mask.roi(rect);
        maskRoi.setTo(new cv.Scalar(255));
        maskRoi.delete();

        const np = new cv.Mat();
        cv.goodFeaturesToTrack(gray, np, 100, 0.01, 7, mask);
        mask.delete();

        if (np.rows > 5) {
            this.p0.delete();
            this.p0 = np;
            this.baseSpread = this.calculateSpread(this.p0);
        } else np.delete();
    }

    delete() {
        if (this.prevGray) this.prevGray.delete();
        if (this.p0) this.p0.delete();
        if (this.p1) this.p1.delete();
        if (this.st) this.st.delete();
        if (this.err) this.err.delete();
        if (this.clahe) this.clahe.delete();
    }
}
