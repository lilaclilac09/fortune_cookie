# Gesture Mode Setup

## Installation

After scaffolding, install dependencies:
```bash
cd app
npm install
```

## Running Locally

```bash
npm run dev
```

Access at http://localhost:3000

## Using Gesture Mode

1. Click the "👋 Gesture Mode" button
2. Allow camera access when prompted
3. Position both hands in front of the camera
4. Hold hands close together, then pull them apart quickly to crack the cookie
5. Orange dots will appear on your wrists for visual feedback

## Requirements

- Modern browser with webcam support (Chrome, Edge, Safari recommended)
- Camera permissions granted
- Good lighting for optimal hand detection

## Fallback

If gesture mode doesn't work or camera access is denied, toggle it off to use the traditional button-based cracking.

## Privacy

All hand tracking runs locally in your browser using MediaPipe. No video or tracking data is sent to any server.
