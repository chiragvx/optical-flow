export class Tracker {
    constructor() {
        this.prevGray = null;
        this.p0 = null;
        this.roi = null; // [x, y, w, h]
        this.status = "STANDBY";

        // LK Params - Optimized for Mobile Speed
        this.winSize = new cv.Size(15, 15);
        this.maxLevel = 2;
        this.criteria = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 10, 0.05);

        // Pre-allocate mats to avoid GC pressure
        this.p1 = new cv.Mat();
        this.st = new cv.Mat();
        this.err = new cv.Mat();

        // Resilient Contrast Enhancement
        this.clahe = null;
        try {
            if (typeof cv.createCLAHE === 'function') {
                this.clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
            }
        } catch (e) {
            console.warn("CLAHE not supported, using equalizeHist fallback.");
        }

        this.scaleAlpha = 0.15; // Slow smoothing for scale
        this.posAlpha = 0.4;    // Faster smoothing for position
        this.baseSpread = 1.0;  // Initial point distribution spread
    }

    enhanceContrast(gray, rect) {
        if (rect.width <= 0 || rect.height <= 0) return;
        const roi = gray.roi(rect);
        if (this.clahe) {
            this.clahe.apply(roi, roi);
        } else {
            cv.equalizeHist(roi, roi);
        }
        roi.delete();
    }

    init(frame, roi) {
        const [x, y, w, h] = roi;
        if (this.prevGray) this.prevGray.delete();
        this.prevGray = new cv.Mat();
        cv.cvtColor(frame, this.prevGray, cv.COLOR_RGBA2GRAY);

        const rect = new cv.Rect(
            Math.max(0, Math.floor(x)),
            Math.max(0, Math.floor(y)),
            Math.min(Math.floor(w), this.prevGray.cols - Math.max(0, Math.floor(x))),
            Math.min(Math.floor(h), this.prevGray.rows - Math.max(0, Math.floor(y)))
        );

        if (rect.width > 10 && rect.height > 10) {
            this.enhanceContrast(this.prevGray, rect);
            const mask = new cv.Mat.zeros(this.prevGray.rows, this.prevGray.cols, cv.CV_8UC1);
            mask.roi(rect).setTo(new cv.Scalar(255));

            if (this.p0) this.p0.delete();
            this.p0 = new cv.Mat();
            cv.goodFeaturesToTrack(this.prevGray, this.p0, 60, 0.02, 7, mask); // Fewer points for speed
            mask.delete();

            if (this.p0.rows > 5) {
                this.roi = roi;
                this.status = "LOCKED";
                // Calculate initial spread for scaling
                this.baseSpread = this.calculateSpread(this.p0);
                return true;
            }
        }
        this.status = "LOST";
        return false;
    }

    calculateSpread(pointsMat) {
        if (pointsMat.rows < 2) return 1.0;
        let sumX = 0, sumY = 0;
        const count = pointsMat.rows;
        for (let i = 0; i < count; i++) {
            sumX += pointsMat.data32F[i * 2];
            sumY += pointsMat.data32F[i * 2 + 1];
        }
        const avgX = sumX / count;
        const avgY = sumY / count;

        let varSum = 0;
        for (let i = 0; i < count; i++) {
            const dx = pointsMat.data32F[i * 2] - avgX;
            const dy = pointsMat.data32F[i * 2 + 1] - avgY;
            varSum += Math.sqrt(dx * dx + dy * dy);
        }
        return varSum / count;
    }

    update(frame) {
        if (this.status !== "LOCKED" || !this.p0 || this.p0.rows === 0) return null;

        const gray = new cv.Mat();
        cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);

        // 1. Single Pass LK (Speed Boost: No backward pass)
        cv.calcOpticalFlowPyrLK(this.prevGray, gray, this.p0, this.p1, this.st, this.err, this.winSize, this.maxLevel, this.criteria);

        const points = [];
        let sumX = 0, sumY = 0, count = 0;
        const ERR_THRESHOLD = 30.0; // Relaxed slightly for speed

        for (let i = 0; i < this.st.rows; i++) {
            if (this.st.data[i] === 1 && this.err.data32F[i] < ERR_THRESHOLD) {
                const px = this.p1.data32F[i * 2];
                const py = this.p1.data32F[i * 2 + 1];
                points.push({ x: px, y: py });
                sumX += px;
                sumY += py;
                count++;
            }
        }

        if (count > 5) {
            const centroidX = sumX / count;
            const centroidY = sumY / count;

            // 2. Fast O(N) Scale Estimation via Distribution Spread
            const currentSpread = this.calculateSpread(this.p1);
            let scale = currentSpread / this.baseSpread;
            // Clamp and smooth scale
            scale = 1.0 * (1 - this.scaleAlpha) + Math.min(1.2, Math.max(0.8, scale)) * this.scaleAlpha;
            this.baseSpread = currentSpread; // Update base for next frame relative change

            const [rx, ry, rw, rh] = this.roi;
            const newW = rw * scale;
            const newH = rh * scale;

            // 3. Sub-pixel ROI Smoothing (Restores visual "Snap")
            this.roi = [
                rx * (1 - this.posAlpha) + (centroidX - newW / 2) * this.posAlpha,
                ry * (1 - this.posAlpha) + (centroidY - newH / 2) * this.posAlpha,
                newW,
                newH
            ];

            // 4. Lite Point Refreshing
            if (count < 20) {
                this.refreshPoints(gray);
            } else {
                // Efficient Mat copy
                const goodPoints = new cv.Mat(count, 1, cv.CV_32FC2);
                let idx = 0;
                for (let i = 0; i < this.st.rows; i++) {
                    if (this.st.data[i] === 1) {
                        goodPoints.data32F[idx * 2] = this.p1.data32F[i * 2];
                        goodPoints.data32F[idx * 2 + 1] = this.p1.data32F[i * 2 + 1];
                        idx++;
                    }
                }
                this.p0.delete();
                this.p0 = goodPoints;
            }

            this.prevGray.delete();
            this.prevGray = gray;
            return { roi: this.roi, points };
        }

        this.status = "LOST";
        gray.delete();
        return null;
    }

    refreshPoints(gray) {
        const [x, y, w, h] = this.roi;
        const mx = Math.max(0, Math.floor(x));
        const my = Math.max(0, Math.floor(y));
        const mw = Math.min(gray.cols - mx, Math.floor(w));
        const mh = Math.min(gray.rows - my, Math.floor(h));

        if (mw < 10 || mh < 10) return;

        const rect = new cv.Rect(mx, my, mw, mh);
        this.enhanceContrast(gray, rect);

        const mask = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
        mask.roi(rect).setTo(new cv.Scalar(255));

        const newPoints = new cv.Mat();
        cv.goodFeaturesToTrack(gray, newPoints, 60, 0.02, 7, mask);

        if (newPoints.rows > 5) {
            this.p0.delete();
            this.p0 = newPoints;
            this.baseSpread = this.calculateSpread(this.p0);
        } else {
            newPoints.delete();
        }
        mask.delete();
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
