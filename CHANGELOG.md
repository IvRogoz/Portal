# Changelog

## 2026-02-24

- Moved control UI from page-based HTML sliders to in-viewport `lil-gui` controls.
- Switched the Three.js view to full-window rendering and aligned room/frustum behavior with viewport size.
- Added live room/target controls: room depth, target near/far depth range, secondary target size range, and main target depth/size.
- Fixed target clipping against room bounds by clamping placement and resize-time positions.
- Stopped unintended rerandomization when adjusting sliders; rerandomization now occurs only from dedicated actions.
- Added layout persistence tools in GUI:
  - export/import layout as JSON
  - save/load layout from browser local storage
