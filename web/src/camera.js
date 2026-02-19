export class Camera {
    constructor(videoElement) {
        this.video = videoElement;
        this.stream = null;
        this.facingMode = "environment"; // Default to rear camera
    }

    async init() {
        const constraints = {
            video: {
                facingMode: this.facingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            await this.video.play();
            return true;
        } catch (e) {
            console.error("Camera init error:", e);
            return false;
        }
    }

    async switch() {
        this.facingMode = this.facingMode === "user" ? "environment" : "user";
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        return await this.init();
    }
}
