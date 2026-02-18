import cv2
import numpy as np
from abc import ABC, abstractmethod

class BaseTracker(ABC):
    @abstractmethod
    def init(self, frame, roi):
        pass

    @abstractmethod
    def update(self, frame):
        pass

class LKTracker(BaseTracker):
    def __init__(self):
        # Parameters for lucas kanade optical flow
        self.lk_params = dict(winSize=(15, 15),
                              maxLevel=2,
                              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03))
        
        # Parameters for corner detection
        self.feature_params = dict(maxCorners=100,
                                  qualityLevel=0.01,
                                  minDistance=7,
                                  blockSize=7)

        
        self.prev_gray = None
        self.p0 = None
        self.roi = None
        self.status = "LOST"

    def init(self, frame, roi):
        """
        Initializes tracking with an ROI.
        :param frame: Initial frame.
        :param roi: (x, y, w, h)
        """
        x, y, w, h = roi
        self.prev_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Extract features within the ROI
        mask = np.zeros_like(self.prev_gray)
        mask[y:y+h, x:x+w] = 255
        self.p0 = cv2.goodFeaturesToTrack(self.prev_gray, mask=mask, **self.feature_params)
        
        if self.p0 is not None:
            self.roi = roi
            self.status = "LOCKED"
        else:
            self.status = "LOST"

    def update(self, frame):
        """
        Updates tracking for the new frame.
        :param frame: Current frame.
        :return: (status, roi, points)
        """
        if self.status != "LOCKED" or self.p0 is None:
            return self.status, None, None

        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Calculate optical flow
        p1, st, err = cv2.calcOpticalFlowPyrLK(self.prev_gray, frame_gray, self.p0, None, **self.lk_params)
        
        # Select good points
        if p1 is not None:
            good_new = p1[st == 1]
            good_old = self.p0[st == 1]
            
            if len(good_new) > 0:
                # Calculate centroid of new points
                centroid_x = np.mean(good_new[:, 0])
                centroid_y = np.mean(good_new[:, 1])

                
                # Update ROI: keep same size, center on point centroid
                x, y, w, h = self.roi
                new_x = int(centroid_x - w / 2)
                new_y = int(centroid_y - h / 2)
                self.roi = (new_x, new_y, w, h)
                
                self.p0 = good_new.reshape(-1, 1, 2)
                self.prev_gray = frame_gray.copy()

                # Refresh points if count gets too low
                if len(self.p0) < 30:
                    x, y, w, h = self.roi
                    # Use a slightly smaller mask to avoid background features
                    padding = 0.1
                    mx, my = int(x + w * padding), int(y + h * padding)
                    mw, mh = int(w * (1 - 2 * padding)), int(h * (1 - 2 * padding))
                    
                    # Ensure mask is within frame
                    fh, fw = frame_gray.shape
                    mx = max(0, min(mx, fw - 1))
                    my = max(0, min(my, fh - 1))
                    mw = max(1, min(mw, fw - mx))
                    mh = max(1, min(mh, fh - my))
                    
                    mask = np.zeros_like(frame_gray)
                    mask[my:my+mh, mx:mx+mw] = 255
                    new_points = cv2.goodFeaturesToTrack(frame_gray, mask=mask, **self.feature_params)
                    if new_points is not None:
                        # Combine existing points with new ones
                        self.p0 = np.vstack((self.p0, new_points))
                        # Remove duplicates if any (simple distance check could be better but this is a start)
                        self.p0 = np.unique(self.p0, axis=0)

                return self.status, self.roi, self.p0


        
        self.status = "LOST"
        return self.status, None, None
