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
    }

    init(frame, roi) {
        const [x, y, w, h] = roi;
        if (this.prevGray) this.prevGray.delete();
        this.prevGray = new cv.Mat();
        cv.cvtColor(frame, this.prevGray, cv.COLOR_RGBA2GRAY);

        // Find features in ROI
        const mask = new cv.Mat.zeros(this.prevGray.rows, this.prevGray.cols, cv.CV_8UC1);
        const rect = new cv.Rect(x, y, w, h);
        mask.roi(rect).setTo(new cv.Scalar(255));

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

        cv.calcOpticalFlowPyrLK(this.prevGray, gray, this.p0, p1, status, err, this.winSize, this.maxLevel, this.criteria);

        // Select good points
        const points = [];
        let sumX = 0, sumY = 0, count = 0;

        for (let i = 0; i < status.rows; i++) {
            if (status.data[i] === 1) {
                const x = p1.data32F[i * 2];
                const y = p1.data32F[i * 2 + 1];
                points.push({ x, y });
                sumX += x;
                sumY += y;
                count++;
            }
        }

        if (count > 0) {
            const centroidX = sumX / count;
            const centroidY = sumY / count;
            const [rx, ry, rw, rh] = this.roi;
            this.roi = [centroidX - rw / 2, centroidY - rh / 2, rw, rh];

            // Point refreshing logic
            if (count < 30) {
                this.refreshPoints(gray);
            } else {
                this.p0.delete();
                this.p0 = p1.clone();
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
        const mx = Math.max(0, x + w * padding);
        const my = Math.max(0, y + h * padding);
        const mw = Math.min(gray.cols - mx, w * (1 - 2 * padding));
        const mh = Math.min(gray.rows - my, h * (1 - 2 * padding));

        if (mw <= 0 || mh <= 0) return;

        const mask = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
        const rect = new cv.Rect(mx, my, mw, mh);
        mask.roi(rect).setTo(new cv.Scalar(255));

        const newPoints = new cv.Mat();
        cv.goodFeaturesToTrack(gray, newPoints, 100, 0.01, 7, mask);

        if (newPoints.rows > 0) {
            // Simplification: just take the new points for now
            this.p0.delete();
            this.p0 = newPoints;
        } else {
            newPoints.delete();
        }
        mask.delete();
    }
}
