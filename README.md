# Real-Time Object Tracking System

A lightweight, real-time object tracking system using Python, OpenCV, and Lucas-Kanade Optical Flow.

## Features
- Interactive target selection via mouse drag.
- Real-time tracking using Lucas-Kanade Sparse Optical Flow.
- Visual feedback with bounding boxes and flow points.
- FPS and tracking status display.
- Modular design for easy algorithm swapping.

## Prerequisites
- Python 3.8+
- OpenCV (`opencv-python`)
- NumPy

## Installation
```bash
pip install -r requirements.txt
```

## Usage
Run the main script:
```bash
python main.py
```

### Controls
- **Mouse Drag**: Select a Region of Interest (ROI) to start tracking.
- **'s'**: Native ROI selection (Select area and press ENTER or SPACE).
- **'q'**: Quit the application.

- **'r'**: Reset the tracker (clear ROI and points).
- **'p'**: Pause or resume the video stream.

## Project Structure
- `main.py`: Main entry point and orchestration.
- `tracker.py`: `LKTracker` implementation.
- `video_input.py`: Video capture and preprocessing.
- `ui_manager.py`: Mouse and keyboard interaction.
- `renderer.py`: Visualization and overlays.
