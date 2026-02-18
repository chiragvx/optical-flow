import cv2
import numpy as np
from tracker import LKTracker

def debug():
    tracker = LKTracker()
    frame = np.random.randint(0, 50, (480, 640, 3), dtype=np.uint8)
    cv2.rectangle(frame, (100, 100), (150, 150), (255, 255, 255), -1)
    for _ in range(50):
        x = np.random.randint(110, 140)
        y = np.random.randint(110, 140)
        cv2.circle(frame, (x, y), 2, (0, 0, 0), -1)

    roi = (100, 100, 50, 50)
    tracker.init(frame, roi)
    print(f"Status after init: {tracker.status}")
    if tracker.p0 is not None:
        print(f"Points found: {len(tracker.p0)}")
    else:
        print("No points found!")
        return

    status, new_roi, points = tracker.update(frame)
    print(f"Status after update: {status}")
    if points is not None:
        print(f"Points after update: {len(points)}")
    else:
        print("Points after update: None")

if __name__ == "__main__":
    debug()
