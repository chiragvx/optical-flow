export class UIManager {
    constructor(canvas, overlay) {
        this.canvas = canvas;
        this.overlay = overlay;
        this.isSelecting = false;
        this.startPos = { x: 0, y: 0 };
        this.roi = null;

        this.initEvents();
    }

    initEvents() {
        const start = (e) => {
            const pos = this.getPos(e);
            this.isSelecting = true;
            this.startPos = pos;
            this.updateOverlay(pos, pos);
            this.overlay.style.display = 'block';
        };

        const move = (e) => {
            if (!this.isSelecting) return;
            const currentPos = this.getPos(e);
            this.updateOverlay(this.startPos, currentPos);
        };

        const end = (e) => {
            if (!this.isSelecting) return;
            this.isSelecting = false;
            this.overlay.style.display = 'none';

            // For Touchend, e might not have coordinates, use last move position if needed
            // But usually changedTouches has it.
            const endPos = e.clientX ? this.getPos(e) : this.getPos(e.changedTouches[0]);

            const x = Math.min(this.startPos.x, endPos.x);
            const y = Math.min(this.startPos.y, endPos.y);
            const w = Math.abs(this.startPos.x - endPos.x);
            const h = Math.abs(this.startPos.y - endPos.y);

            if (w > 10 && h > 10) {
                this.roi = [x, y, w, h];
            }
        };

        this.canvas.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);

        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling while selecting
            start(e.touches[0]);
        }, { passive: false });
        window.addEventListener('touchmove', (e) => {
            if (this.isSelecting) e.preventDefault();
            move(e.touches[0]);
        }, { passive: false });
        window.addEventListener('touchend', (e) => {
            end(e);
        });

    }

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    updateOverlay(p1, p2) {
        const rect = this.canvas.getBoundingClientRect();
        const parentRect = this.canvas.parentElement.getBoundingClientRect();

        const scaleX = rect.width / this.canvas.width;
        const scaleY = rect.height / this.canvas.height;

        // Offset of canvas relative to viewport - offset of parent relative to viewport
        const offsetX = rect.left - parentRect.left;
        const offsetY = rect.top - parentRect.top;

        const left = Math.min(p1.x, p2.x) * scaleX + offsetX;
        const top = Math.min(p1.y, p2.y) * scaleY + offsetY;
        const width = Math.abs(p1.x - p2.x) * scaleX;
        const height = Math.abs(p1.y - p2.y) * scaleY;

        this.overlay.style.left = `${left}px`;
        this.overlay.style.top = `${top}px`;
        this.overlay.style.width = `${width}px`;
        this.overlay.style.height = `${height}px`;
    }


    consumeROI() {
        const r = this.roi;
        this.roi = null;
        return r;
    }
}
