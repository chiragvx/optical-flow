import cv2
from video_input import VideoInput
from tracker import LKTracker
from ui_manager import UIManager
from renderer import Renderer

def main():
    # Initialize components
    video = VideoInput(source=0) # Use 0 for webcam
    tracker = LKTracker()
    ui = UIManager()
    renderer = Renderer()

    print("--- Real-Time Object Tracker ---")
    print("Commands:")
    print("  Drag mouse to select target")
    print("  's' - Native ROI selection (Select area and press ENTER/SPACE)")
    print("  'q' - Quit")
    print("  'r' - Reset tracker")
    print("  'p' - Pause / Resume")
    print("--------------------------------")

    frame = None


    while True:
        if not ui.paused:
            ret, new_frame = video.read_frame()
            if ret:
                frame = new_frame
            else:
                break
        
        if frame is not None:
            # Update tracker if locked
            if tracker.status == "LOCKED" and not ui.paused:
                status, roi, points = tracker.update(frame)
            else:
                status, roi, points = tracker.status, tracker.roi, tracker.p0
            
            # Check for new ROI selection from UI
            if ui.roi is not None:
                tracker.init(frame, ui.roi)
                ui.reset_roi()
            
            # Update FPS and render
            renderer.update_fps()
            display_frame = frame.copy()
            display_frame = ui.draw_selection(display_frame)
            display_frame = renderer.render(display_frame, tracker.status, roi, points)
            
            cv2.imshow(ui.window_name, display_frame)


        # Handle keyboard input
        cmd = ui.get_user_input()
        if cmd == "QUIT":
            break
        elif cmd == "RESET":
            tracker.status = "LOST"
            tracker.roi = None
            tracker.p0 = None
        elif cmd == "SELECT":
            if frame is not None:
                # Use built-in OpenCV selector
                new_roi = cv2.selectROI(ui.window_name, frame, fromCenter=False, showCrosshair=True)
                if new_roi[2] > 0 and new_roi[3] > 0:
                    tracker.init(frame, new_roi)
        elif cmd == "PAUSE":

            print("Paused" if ui.paused else "Resumed")

    video.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
