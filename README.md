# Portal

Portal is a browser-based experiment that tracks head pose from your webcam and uses it to drive a `three.js` camera, creating a virtual window/parallax effect.

The app now runs as a full-window Three.js viewport and uses in-scene `lil-gui` controls instead of page sliders.

## Preview

<video src="https://raw.githubusercontent.com/IvRogoz/Portal/main/preview.mp4" controls width="720"></video>

## Tech stack

- Vite + TypeScript
- three.js
- MediaPipe Tasks Vision (Face Landmarker)

## Project structure

- `webapp/` - frontend application code

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Preview production build

```bash
npm run preview
```

Run commands from `webapp/`.

## Controls

All runtime controls are in the top-right `Tracking Controls` panel:

- Camera and calibration actions
- Tracking sensitivity and smoothing
- Scene source switching between the default room + targets and `scene.glb`
- Room depth
- Main target depth and size
- Secondary target count, near/far depth range, and size range
- Target rerandomization
- Custom target loading and clearing for GLB/GLTF models
- Custom target size, X/Y/Z position offsets, auto-rotation, and rotation speed

## Targets

The default room renders a main bullseye plus secondary bullseye targets at varied depths. Each target includes a visible 3D stem from its center to the back wall to make depth relationships easier to read.

Custom GLB/GLTF targets can replace the default bullseyes. Loaded custom targets are auto-fit into the room first, then adjusted with the custom target size and position controls.

## Layout save/load

Target layouts can be persisted and restored from the GUI:

- `Export Layout JSON` downloads a snapshot file
- `Import Layout JSON` loads a previously exported file
- `Save Layout Local` stores the snapshot in browser local storage
- `Load Layout Local` restores the locally saved snapshot

Snapshot data includes room/target controls, main target depth+size, and all secondary target positions and scales.

## Notes

- Webcam permission is required for head tracking.
- A modern Chromium-based browser is recommended for best performance.
