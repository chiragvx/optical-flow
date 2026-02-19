export class Tracker {
    constructor() {
        this.prevGray = null;
        this.p0 = null;
        this.roi = null; // [x, y, w, h]
        this.status = "STANDBY";

        // LK Params
        this.winSize = new cv.Size(15, 15);
        this.maxLevel = 2;
        this.criteria = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 10, 0.03);

        // CLAHE for dark objects
        this.clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
        this.scaleAlpha = 0.2; // Smoothing for scale changes
    }

    applyCLAHE(gray, rect) {
        const roi = gray.roi(rect);
        const enhanced = new cv.Mat();
        this.clahe.apply(roi, enhanced);
        enhanced.copyTo(roi);
        enhanced.delete();
        roi.delete();
    }

    init(frame, roi) {
        const [x, y, w, h] = roi;
        if (this.prevGray) this.prevGray.delete();
        this.prevGray = new cv.Mat();
        cv.cvtColor(frame, this.prevGray, cv.COLOR_RGBA2GRAY);

        // Enhance contrast in ROI for better feature detection
        const rect = new cv.Rect(
            Math.max(0, Math.floor(x)),
            Math.max(0, Math.floor(y)),
            Math.min(Math.floor(w), this.prevGray.cols - Math.max(0, Math.floor(x))),
            Math.min(Math.floor(h), this.prevGray.rows - Math.max(0, Math.floor(y)))
        );

        if (rect.width > 0 && rect.height > 0) {
            this.applyCLAHE(this.prevGray, rect);
        }

        // Find features in ROI
        const mask = new cv.Mat.zeros(this.prevGray.rows, this.prevGray.cols, cv.CV_8UC1);
        if (rect.width > 0 && rect.height > 0) {
            mask.roi(rect).setTo(new cv.Scalar(255));
        }

        if (this.p0) this.p0.delete();
        this.p0 = new cv.Mat();
        cv.goodFeaturesToTrack(this.prevGray, this.p0, 100, 0.01, 7, mask);

        mask.delete();
        if (this.p0.rows > 0) {
            this.roi = roi;
            this.status = "LOCKED";
            return true;
        }
        this.status = "LOST";
        return false;
    }

    update(frame) {
        if (this.status !== "LOCKED" || !this.p0 || this.p0.rows === 0) return null;

        const gray = new cv.Mat();
        cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);

        const p1 = new cv.Mat();
        const status = new cv.Mat();
        const err = new cv.Mat();

        // 1. Forward Tracking
        cv.calcOpticalFlowPyrLK(this.prevGray, gray, this.p0, p1, status, err, this.winSize, this.maxLevel, this.criteria);

        // 2. Backward Tracking (Consistency Check)
        const p0r = new cv.Mat();
        const status_back = new cv.Mat();
        const err_back = new cv.Mat();
        cv.calcOpticalFlowPyrLK(gray, this.prevGray, p1, p0r, status_back, err_back, this.winSize, this.maxLevel, this.criteria);

        // 3. Select good points based on status, error, and FB-consistency
        const points = [];
        const oldPoints = [];
        let sumX = 0, sumY = 0, count = 0;
        const FB_THRESHOLD = 1.0;
        const ERR_THRESHOLD = 25.0;

        for (let i = 0; i < status.rows; i++) {
            if (status.data[i] === 1 && status_back.data[i] === 1) {
                const x1 = p1.data32F[i * 2], y1 = p1.data32F[i * 2 + 1];
                const x0 = this.p0.data32F[i * 2], y0 = this.p0.data32F[i * 2 + 1];
                const xr = p0r.data32F[i * 2], yr = p0r.data32F[i * 2 + 1];

                const fb_dist = Math.sqrt((x0 - xr) ** 2 + (y0 - yr) ** 2);

                if (fb_dist < FB_THRESHOLD && err.data32F[i] < ERR_THRESHOLD) {
                    points.push({ x: x1, y: y1 });
                    oldPoints.push({ x: x0, y: y0 });
                    sumX += x1;
                    sumY += y1;
                    count++;
                } else {
                    status.data[i] = 0;
                }
            }
        }

        p0r.delete(); status_back.delete(); err_back.delete();

        if (count > 0) {
            const [rx, ry, rw, rh] = this.roi;
            const centroidX = sumX / count;
            const centroidY = sumY / count;

            // 4. Calculate Scale change (Depth Perception)
            let scale = 1.0;
            if (count > 1) {
                const dists = [];
                const step = Math.max(1, Math.floor(count / 10));
                for (let i = 0; i < count; i += step) {
                    for (let j = i + step; j < count; j += step) {
                        const d1 = Math.sqrt((points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2);
                        const d0 = Math.sqrt((oldPoints[i].x - oldPoints[j].x) ** 2 + (oldPoints[i].y - oldPoints[j].y) ** 2);
                        if (d0 > 1) dists.push(d1 / d0);
                    }
                }
                if (dists.length > 0) {
                    dists.sort((a, b) => a - b);
                    const medianScale = dists[Math.floor(dists.length / 2)];
                    // Smooth scale changes and clamp
                    scale = 1.0 * (1 - this.scaleAlpha) + Math.min(1.1, Math.max(0.9, medianScale)) * this.scaleAlpha;
                }
            }

            // 5. Update ROI with Smoothing
            const alpha = 0.4;
            const newW = rw * scale;
            const newH = rh * scale;
            const targetX = centroidX - newW / 2;
            const targetY = centroidY - newH / 2;

            this.roi = [
                this.roi[0] * (1 - alpha) + targetX * alpha,
                this.roi[1] * (1 - alpha) + targetY * alpha,
                newW,
                newH
            ];

            // 6. Point refreshing logic
            if (count < 30) {
                this.refreshPoints(gray);
            } else {
                const goodPoints = new cv.Mat(count, 1, cv.CV_32FC2);
                let goodIdx = 0;
                for (let i = 0; i < status.rows; i++) {
                    if (status.data[i] === 1) {
                        goodPoints.data32F[goodIdx * 2] = p1.data32F[i * 2];
                        goodPoints.data32F[goodIdx * 2 + 1] = p1.data32F[i * 2 + 1];
                        goodIdx++;
                    }
                }
                this.p0.delete();
                this.p0 = goodPoints;
            }

            this.prevGray.delete();
            this.prevGray = gray;
            p1.delete(); status.delete(); err.delete();
            return { roi: this.roi, points };
        }

        this.status = "LOST";
        gray.delete(); p1.delete(); status.delete(); err.delete();
        return null;
    }

    refreshPoints(gray) {
        const [x, y, w, h] = this.roi;
        const padding = 0.1;
        const mx = Math.max(0, Math.floor(x + w * padding));
        const my = Math.max(0, Math.floor(y + h * padding));
        const mw = Math.min(gray.cols - mx, Math.floor(w * (1 - 2 * padding)));
        const mh = Math.min(gray.rows - my, Math.floor(h * (1 - 2 * padding)));

        if (mw <= 10 || mh <= 10) return;

        const rect = new cv.Rect(mx, my, mw, mh);
        this.applyCLAHE(gray, rect);

        const mask = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
        mask.roi(rect).setTo(new cv.Scalar(255));

        const newPoints = new cv.Mat();
        cv.goodFeaturesToTrack(gray, newPoints, 100, 0.01, 7, mask);

        if (newPoints.rows > 0) {
            this.p0.delete();
            this.p0 = newPoints;
        } else {
            newPoints.delete();
        }
        mask.delete();
    }

    delete() {
        if (this.prevGray) this.prevGray.delete();
        if (this.p0) this.p0.delete();
        if (this.clahe) this.clahe.delete();
    }
}
