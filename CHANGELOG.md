# Changelog

## 2026-05-08

- Added visible 3D stems from each bullseye target center to the room back wall for clearer depth cues.
- Replaced target stems with cylinder geometry so their thickness renders reliably in WebGL.
- Added custom target transform controls for loaded GLB/GLTF models:
  - custom target size
  - custom target X/Y/Z position offsets
- Added custom target auto-rotation controls and model loading/clearing actions to the GUI.

## 2026-02-25

- Added scene source switching in GUI with support for loading `scene.glb` and returning to the default room + targets view.
- Added GLB camera anchor support (`cameraPosition`) plus expanded camera debugging tools, including manual camera transform controls and lens sliders (`FOV`, `Near`, `Far`).
- Added rendering controls for fog, exposure, environment lighting, sun position, shadow tuning, and sky visibility.
- Improved GLB lighting pipeline with tonemapping, environment map controls, shadow casting/receiving controls, and a fallback shadow catcher plane.
- Added color pickers for fog and background (background picker now disables skybox to preview color immediately).

## 2026-02-24

- Moved control UI from page-based HTML sliders to in-viewport `lil-gui` controls.
- Switched the Three.js view to full-window rendering and aligned room/frustum behavior with viewport size.
- Added live room/target controls: room depth, target near/far depth range, secondary target size range, and main target depth/size.
- Fixed target clipping against room bounds by clamping placement and resize-time positions.
- Stopped unintended rerandomization when adjusting sliders; rerandomization now occurs only from dedicated actions.
- Added layout persistence tools in GUI:
  - export/import layout as JSON
  - save/load layout from browser local storage
