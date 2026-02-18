import cv2

class VideoInput:
    def __init__(self, source=0, width=1280, height=720):
        """
        Initializes video capture.
        :param source: Webcam index or path to video file.
        :param width: Target width for resizing.
        :param height: Target height for resizing.
        """
        self.cap = cv2.VideoCapture(source)
        self.width = width
        self.height = height
        
        if not self.cap.isOpened():
            raise IOError(f"Could not open video source: {source}")

    def read_frame(self):
        """
        Reads and resizes next frame.
        :return: (ret, frame)
        """
        ret, frame = self.cap.read()
        if ret:
            frame = cv2.resize(frame, (self.width, self.height))
        return ret, frame

    def release(self):
        """Releases video capture."""
        self.cap.release()

    def get_fps(self):
        """Returns the frame rate of the video source."""
        return self.cap.get(cv2.CAP_PROP_FPS) or 30
