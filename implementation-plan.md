## Goal
Build a browser-based app that estimates head pose from webcam video and renders a 3D grid room whose camera perspective matches the viewer's head movement, like looking through a virtual window.

## Recommended Stack (Best balance: smooth + simple)
- Frontend: `Vite + TypeScript`
- 3D rendering: `three.js`
- Head tracking: `MediaPipe Tasks Vision (Face Landmarker)` in-browser (WASM + optional GPU delegate)
- Camera access: `getUserMedia`
- Optional smoothing: `One Euro Filter` or exponential smoothing in TS
- Hosting: static hosting (Vercel/Netlify/GitHub Pages)

Why this stack:
- No backend required for MVP.
- Lower latency than webcam -> python server -> browser loop.
- Easier deployment and fewer moving parts than Python/OpenCV streaming.

## Alternatives

### A) Browser-only (Recommended)
- `three.js + MediaPipe Face Landmarker`.
- Pros: lowest architecture complexity, good real-time performance, easiest deployment.
- Cons: some performance variance across browsers/devices.

### B) Browser + Backend CV (Python/OpenCV)
- Browser streams frames to backend, backend returns pose.
- Pros: more CV flexibility, easier custom ML experimentation.
- Cons: network latency, more infra complexity, harder to feel "window-like" smooth.

### C) WebXR / Native App
- Better sensor integration and potential tracking quality.
- Pros: strongest immersive performance potential.
- Cons: largest scope increase, less universal accessibility.

## Execution Plan
1. Bootstrap app shell
   - Vite + TS project, webcam permission flow, basic UI controls.

2. Integrate face/head pose tracking
   - Use MediaPipe Face Landmarker.
   - Extract head pose (rotation + translation proxy) from facial landmarks/transformation matrix.

3. Build the 3D room scene
   - Create wireframe/grid room in `three.js`.
   - Define virtual window plane and world scale.

4. Perspective matching
   - Map tracked head coordinates to `three.js` camera position.
   - Lock camera frustum to window dimensions for realistic parallax.

5. Stabilize motion
   - Add temporal smoothing + deadzone.
   - Tune sensitivity and coordinate calibration.

6. Calibration UX
   - Center pose calibration button.
   - Optionally estimate user distance via face size normalization.

7. Performance pass
   - Use `requestAnimationFrame`, throttle pose estimation if needed.
   - Adaptive quality settings for low-end devices.

8. QA and polish
   - Browser compatibility checks (Chrome/Edge/Safari).
   - Mobile fallback messaging if unsupported.

## Technical Notes
- `Flash` is obsolete for this use-case and should not be included.
- `three.js` is the right rendering choice for this target.
- Python/OpenCV is useful for research/prototyping, but not optimal for a low-latency web MVP.

## Suggested Milestones
- M1: Static room render + webcam feed visible.
- M2: Raw head tracking drives camera movement.
- M3: Calibration + smoothing produces convincing "window" effect.
- M4: UX polish + deployable build.

## Approval Gate
Per your plan, implementation should start only after explicit approval of this architecture and milestone plan.
