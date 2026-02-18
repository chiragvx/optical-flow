import cv2
import time

class Renderer:
    def __init__(self):
        self.prev_time = time.time()
        self.fps = 0

    def update_fps(self):
        curr_time = time.time()
        dt = curr_time - self.prev_time
        if dt > 0:
            self.fps = 1.0 / dt
        self.prev_time = curr_time

    def render(self, frame, status, roi=None, points=None):
        """
        Renders overlays on the frame.
        """
        # Draw FPS
        cv2.putText(frame, f"FPS: {int(self.fps)}", (10, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
        # Draw Status
        color = (0, 255, 0) if status == "LOCKED" else (0, 0, 255)
        cv2.putText(frame, f"STATUS: {status}", (10, 60), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        # Draw ROI and points
        if status == "LOCKED" and roi:
            x, y, w, h = roi
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            
            if points is not None:
                for p in points:
                    px, py = p.ravel()
                    cv2.circle(frame, (int(px), int(py)), 3, (255, 0, 0), -1)

        return frame
