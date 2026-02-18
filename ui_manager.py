import cv2

class UIManager:
    def __init__(self, window_name="Object Tracker"):
        self.window_name = window_name
        self.roi = None
        self.selecting = False
        self.start_point = None
        self.end_point = None
        self.paused = False
        
        cv2.namedWindow(self.window_name)
        cv2.setMouseCallback(self.window_name, self._mouse_callback)

    def _mouse_callback(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            self.selecting = True
            self.start_point = (x, y)
            self.end_point = (x, y)
        
        elif event == cv2.EVENT_MOUSEMOVE:
            if self.selecting:
                self.end_point = (x, y)
        
        elif event == cv2.EVENT_LBUTTONUP:
            self.selecting = False
            self.end_point = (x, y)
            x1, y1 = self.start_point
            x2, y2 = self.end_point
            w = abs(x1 - x2)
            h = abs(y1 - y2)
            if w > 5 and h > 5:
                self.roi = (min(x1, x2), min(y1, y2), w, h)

    def get_user_input(self):
        """Checks for keyboard input."""
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            return "QUIT"
        elif key == ord('r'):
            self.roi = None
            return "RESET"
        elif key == ord('p'):
            self.paused = not self.paused
            return "PAUSE"
        elif key == ord('s'):
            return "SELECT"
        return None


    def reset_roi(self):
        self.roi = None

    def draw_selection(self, frame):
        """Draws the selection rectangle if user is dragging."""
        if self.selecting and self.start_point and self.end_point:
            cv2.rectangle(frame, self.start_point, self.end_point, (0, 255, 255), 2)
        return frame
