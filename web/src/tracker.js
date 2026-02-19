class KalmanFilter {
    constructor() {
        // State: [x, y, w, h, dx, dy, dw, dh]
        this.state = null;
        this.P = cv.Mat.eye(8, 8, cv.CV_32F);
        this.F = cv.Mat.eye(8, 8, cv.CV_32F);
        this.H = cv.Mat.zeros(4, 8, cv.CV_32F);

        // Measurement matrix: we only measure [x, y, w, h]
        for (let i = 0; i < 4; i++) {
            this.H.data32F[i * 8 + i] = 1.0;
        }

        // Constant Matrices (reused to avoid leaks)
        this.zeroMat = new cv.Mat();
        this.I = cv.Mat.eye(8, 8, cv.CV_32F);

        // Tuned for Damping: Q (Process Noise) is low, R (Measurement Noise) is high
        this.Q_base = cv.Mat.eye(8, 8, cv.CV_32F).mul(cv.Mat.eye(8, 8, cv.CV_32F), 0.01);
        this.R = cv.Mat.eye(4, 4, cv.CV_32F).mul(cv.Mat.eye(4, 4, cv.CV_32F), 10.0);
        this.Q = new cv.Mat();
    }

    init(roi) {
        if (this.state) this.state.delete();
        this.state = new cv.Mat(8, 1, cv.CV_32F);
        this.state.data32F.set([roi[0], roi[1], roi[2], roi[3], 0, 0, 0, 0]);
        this.P = cv.Mat.eye(8, 8, cv.CV_32F).mul(cv.Mat.eye(8, 8, cv.CV_32F), 1.0);
    }

    predict(dt = 1.0) {
        if (!this.state) return null;

        // Update Transition Matrix with current dt
        for (let i = 0; i < 4; i++) {
            this.F.data32F[i * 8 + (i + 4)] = dt;
        }

        // Q scales with dt (Scalar multiplication via convertTo)
        this.Q_base.convertTo(this.Q, -1, dt, 0);

        // x = F * x
        let nextState = new cv.Mat();
        cv.gemm(this.F, this.state, 1, this.zeroMat, 0, nextState);
        this.state.delete();
        this.state = nextState;


        // P = F * P * F' + Q
        let Ft = new cv.Mat();
        cv.transpose(this.F, Ft);
        let PFt = new cv.Mat();
        cv.gemm(this.P, Ft, 1, this.zeroMat, 0, PFt);
        let FPFt = new cv.Mat();
        cv.gemm(this.F, PFt, 1, this.zeroMat, 0, FPFt);
        cv.add(FPFt, this.Q, this.P);

        Ft.delete(); PFt.delete(); FPFt.delete();
        return Array.from(this.state.data32F.slice(0, 4));
    }

    update(roi) {
        if (!this.state) return;
        const z = new cv.Mat(4, 1, cv.CV_32F);
        z.data32F.set(roi);

        // y = z - H * x
        let Hx = new cv.Mat();
        cv.gemm(this.H, this.state, 1, this.zeroMat, 0, Hx);
        let y = new cv.Mat();
        cv.subtract(z, Hx, y);

        // S = H * P * H' + R
        let Ht = new cv.Mat();
        cv.transpose(this.H, Ht);
        let PHt = new cv.Mat();
        cv.gemm(this.P, Ht, 1, this.zeroMat, 0, PHt);
        let HPHt = new cv.Mat();
        cv.gemm(this.H, PHt, 1, this.zeroMat, 0, HPHt);
        let S = new cv.Mat();
        cv.add(HPHt, this.R, S);

        // K = P * H' * S^-1
        let Si = new cv.Mat();
        cv.invert(S, Si);
        let K = new cv.Mat();
        cv.gemm(PHt, Si, 1, this.zeroMat, 0, K);

        // x = x + K * y
        let Ky = new cv.Mat();
        cv.gemm(K, y, 1, this.zeroMat, 0, Ky);
        let nextState = new cv.Mat();
        cv.add(this.state, Ky, nextState);
        this.state.delete();
        this.state = nextState;

        // P = (I - K * H) * P
        let KH = new cv.Mat();
        cv.gemm(K, this.H, 1, this.zeroMat, 0, KH);
        let IKH = new cv.Mat();
        cv.subtract(this.I, KH, IKH);
        let nextP = new cv.Mat();
        cv.gemm(IKH, this.P, 1, this.zeroMat, 0, nextP);
        this.P.delete();
        this.P = nextP;

        z.delete(); Hx.delete(); y.delete(); Ht.delete(); PHt.delete();
        HPHt.delete(); S.delete(); Si.delete(); K.delete(); Ky.delete();
        KH.delete(); IKH.delete();
    }

    delete() {
        if (this.state) this.state.delete();
        if (this.P) this.P.delete();
        if (this.F) this.F.delete();
        if (this.H) this.H.delete();
        if (this.Q) this.Q.delete();
        if (this.R) this.R.delete();
        if (this.Q_base) this.Q_base.delete();
        if (this.zeroMat) this.zeroMat.delete();
        if (this.I) this.I.delete();
    }
}

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

        this.kalman = new KalmanFilter();

        this.clahe = null;
        try {
            if (typeof cv.createCLAHE === 'function') {
                this.clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
            }
        } catch (e) { }

        this.scaleAlpha = 0.05; // Heavier scale smoothing
        this.emaAlpha = 0.3;   // Final cinematic smoothing layer
        this.baseSpread = 1.0;
    }

    enhanceContrast(gray, rect) {
        if (rect.width <= 0 || rect.height <= 0) return;
        const roi = gray.roi(rect);
        if (this.clahe) this.clahe.apply(roi, roi);
        else cv.equalizeHist(roi, roi);
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
            cv.goodFeaturesToTrack(this.prevGray, this.p0, 150, 0.01, 7, mask);
            mask.delete();

            if (this.p0.rows > 5) {
                this.roi = roi;
                this.status = "LOCKED";
                this.baseSpread = this.calculateSpread(this.p0);
                this.kalman.init(roi);
                return true;
            }
        }
        this.status = "LOST";
        return false;
    }

    calculateSpread(mat) {
        let sx = 0, sy = 0, c = mat.rows;
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

        // Kalman Prediction
        const predictedROI = this.kalman.predict(dt);

        const gray = new cv.Mat();
        cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);

        cv.calcOpticalFlowPyrLK(this.prevGray, gray, this.p0, this.p1, this.st, this.err, this.winSize, this.maxLevel, this.criteria);

        let sumX = 0, sumY = 0, count = 0;
        let dxs = [], dys = [];
        let initialPoints = [];

        for (let i = 0; i < this.st.rows; i++) {
            if (this.st.data[i] === 1) {
                const px1 = this.p1.data32F[i * 2], py1 = this.p1.data32F[i * 2 + 1];
                const px0 = this.p0.data32F[i * 2], py0 = this.p0.data32F[i * 2 + 1];
                dxs.push(px1 - px0);
                dys.push(py1 - py0);
                initialPoints.push({ x: px1, y: py1 });
            }
        }

        let filteredPoints = initialPoints;
        if (dxs.length > 5) {
            const getMAD = (arr) => {
                const mid = Math.floor(arr.length / 2);
                const sorted = [...arr].sort((a, b) => a - b);
                const median = sorted[mid];
                const devs = arr.map(x => Math.abs(x - median)).sort((a, b) => a - b);
                return { median, mad: devs[mid] || 0.1 };
            }
            const madX = getMAD(dxs), madY = getMAD(dys);

            filteredPoints = [];
            sumX = 0; sumY = 0; count = 0;
            for (let i = 0, j = 0; i < this.st.rows; i++) {
                if (this.st.data[i] === 1) {
                    const dx = dxs[j], dy = dys[j];
                    // Relaxed MAD threshold (5x) for smoother transitions
                    if (Math.abs(dx - madX.median) < 5 * madX.mad &&
                        Math.abs(dy - madY.median) < 5 * madY.mad) {
                        const px = this.p1.data32F[i * 2], py = this.p1.data32F[i * 2 + 1];
                        filteredPoints.push({ x: px, y: py });
                        sumX += px; sumY += py; count++;
                    } else {
                        this.st.data[i] = 0;
                    }
                    j++;
                }
            }
        } else {
            // Simple pass-through if not enough points for MAD
            sumX = initialPoints.reduce((s, p) => s + p.x, 0);
            sumY = initialPoints.reduce((s, p) => s + p.y, 0);
            count = initialPoints.length;
        }

        if (count > 5) {
            const centroidX = sumX / count, centroidY = sumY / count;
            const currentSpread = this.calculateSpread(this.p1);
            let scale = currentSpread / this.baseSpread;
            scale = 1.0 * (1 - this.scaleAlpha) + Math.min(1.1, Math.max(0.9, scale)) * this.scaleAlpha;
            this.baseSpread = currentSpread;

            const [rx, ry, rw, rh] = this.roi;
            const newW = rw * scale, newH = rh * scale;
            const newROI = [centroidX - newW / 2, centroidY - newH / 2, newW, newH];

            // 1. Kalman Update (Damped by higher R)
            this.kalman.update(newROI);

            // 2. Final EMA Silk-Smooth Layer
            const targetROI = Array.from(this.kalman.state.data32F.slice(0, 4));
            this.roi = [
                this.roi[0] * (1 - this.emaAlpha) + targetROI[0] * this.emaAlpha,
                this.roi[1] * (1 - this.emaAlpha) + targetROI[1] * this.emaAlpha,
                this.roi[2] * (1 - this.emaAlpha) + targetROI[2] * this.emaAlpha,
                this.roi[3] * (1 - this.emaAlpha) + targetROI[3] * this.emaAlpha
            ];

            if (count < 40) this.refreshPoints(gray);
            else {
                const gp = new cv.Mat(count, 1, cv.CV_32FC2);
                for (let i = 0, idx = 0; i < this.st.rows; i++) {
                    if (this.st.data[i] === 1) {
                        gp.data32F[idx * 2] = this.p1.data32F[i * 2];
                        gp.data32F[idx * 2 + 1] = this.p1.data32F[i * 2 + 1];
                        idx++;
                    }
                }
                this.p0.delete(); this.p0 = gp;
            }
            this.prevGray.delete(); this.prevGray = gray;
            return { roi: this.roi, points: filteredPoints || [] };
        }

        // If lost, use prediction for a few frames
        if (predictedROI) {
            this.roi = predictedROI;
            this.prevGray.delete(); this.prevGray = gray;
            return { roi: this.roi, points: [] };
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
        cv.goodFeaturesToTrack(gray, np, 150, 0.01, 7, mask);
        if (np.rows > 5) {
            this.p0.delete(); this.p0 = np;
            this.baseSpread = this.calculateSpread(this.p0);
        } else np.delete();
        mask.delete();
    }

    delete() {
        if (this.prevGray) this.prevGray.delete();
        if (this.p0) this.p0.delete();
        if (this.p1) this.p1.delete();
        if (this.st) this.st.delete();
        if (this.err) this.err.delete();
        if (this.clahe) this.clahe.delete();
        this.kalman.delete();
    }
}
