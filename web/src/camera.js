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
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');

            if (videoDevices.length > 1) {
                // Find current device index
                const currentId = this.stream ? this.stream.getVideoTracks()[0].getSettings().deviceId : null;
                let nextIdx = 0;

                if (currentId) {
                    const currentIdx = videoDevices.findIndex(d => d.deviceId === currentId);
                    nextIdx = (currentIdx + 1) % videoDevices.length;
                }

                // Stop current
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                }

                // Start next with explicit ID
                const constraints = {
                    video: {
                        deviceId: { exact: videoDevices[nextIdx].deviceId },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                };

                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
                this.video.srcObject = this.stream;
                await this.video.play();
                return true;
            } else {
                // Fallback to orientation toggle if device IDs aren't helpful or only 1 found
                this.facingMode = this.facingMode === "user" ? "environment" : "user";
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                }
                return await this.init();
            }
        } catch (e) {
            console.error("Camera switch error:", e);
            return false;
        }
    }
}
