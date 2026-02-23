# Portal

Portal is a browser-based experiment that tracks head pose from your webcam and uses it to drive a `three.js` camera, creating a virtual window/parallax effect.

## Tech stack

- Vite + TypeScript
- three.js
- MediaPipe Tasks Vision (Face Landmarker)

## Project structure

- `webapp/` - frontend application code

## Local development

```bash
cd webapp
npm install
npm run dev
```

## Build

```bash
cd webapp
npm run build
```

## Preview production build

```bash
cd webapp
npm run preview
```

## Notes

- Webcam permission is required for head tracking.
- A modern Chromium-based browser is recommended for best performance.
