export class Camera {
    constructor(videoElement) {
        self.video = videoElement;
        self.stream = null;
        self.facingMode = "environment"; // Default to rear camera
    }

    async init() {
        const constraints = {
            video: {
                facingMode: self.facingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        try {
            self.stream = await navigator.mediaDevices.getUserMedia(constraints);
            self.video.srcObject = self.stream;
            await self.video.play();
            return true;
        } catch (e) {
            console.error("Camera init error:", e);
            return false;
        }
    }

    async switch() {
        self.facingMode = self.facingMode === "user" ? "environment" : "user";
        if (self.stream) {
            self.stream.getTracks().forEach(track => track.stop());
        }
        return await self.init();
    }
}
