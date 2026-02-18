import unittest
import numpy as np
import cv2
from tracker import LKTracker

class TestLKTracker(unittest.TestCase):
    def setUp(self):
        self.tracker = LKTracker()
        # Create a checkerboard frame for strong features
        self.frame = np.zeros((480, 640, 3), dtype=np.uint8)
        for i in range(0, 480, 20):
            for j in range(0, 640, 20):
                if (i // 20 + j // 20) % 2 == 0:
                    self.frame[i:i+20, j:j+20] = 255




    def test_initialization(self):
        """Test if the tracker initializes correctly with a valid ROI."""
        roi = (100, 100, 50, 50)
        self.tracker.init(self.frame, roi)
        self.assertEqual(self.tracker.status, "LOCKED")
        self.assertIsNotNone(self.tracker.p0)

    def test_tracking_no_motion(self):
        """Test if tracker stays on ROI when there is no motion."""
        roi = (100, 100, 50, 50)
        self.tracker.init(self.frame, roi)
        
        status, new_roi, points = self.tracker.update(self.frame)
        self.assertEqual(status, "LOCKED")
        self.assertEqual(new_roi, roi)

    def test_tracking_loss(self):
        """Test if tracker handles object loss (e.g., empty frame)."""
        roi = (100, 100, 50, 50)
        self.tracker.init(self.frame, roi)
        
        empty_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        status, new_roi, points = self.tracker.update(empty_frame)
        self.assertEqual(status, "LOST")
        self.assertIsNone(new_roi)

if __name__ == '__main__':
    unittest.main()
