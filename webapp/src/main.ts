import './style.css'
import * as THREE from 'three'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app-shell">
    <section class="viewport-card">
      <div id="scene" class="scene"></div>
      <video id="webcam" autoplay playsinline muted></video>
      <div id="status" class="status-pill">Initializing...</div>
    </section>
  </main>
`

type Pose = {
  x: number
  y: number
  z: number
  eyeDistance: number
}

type SerializedTarget = {
  x: number
  y: number
  z: number
  scale: number
}

type LayoutSnapshot = {
  version: number
  controls: {
    roomDepth: number
    targetNear: number
    targetFar: number
    targetMinScale: number
    targetMaxScale: number
    mainTargetDepth: number
    mainTargetScale: number
    targetCount: number
  }
  secondaryTargets: SerializedTarget[]
}

const sceneRoot = document.querySelector<HTMLDivElement>('#scene')!
const webcam = document.querySelector<HTMLVideoElement>('#webcam')!
const statusPill = document.querySelector<HTMLDivElement>('#status')!
const LAYOUT_STORAGE_KEY = 'parallax-room-layout-v1'

const WINDOW_HEIGHT = 1.8
const ROOM_WIDTH =
  WINDOW_HEIGHT * (sceneRoot.clientWidth / Math.max(sceneRoot.clientHeight, 1))
const ROOM_HEIGHT = WINDOW_HEIGHT
const BASE_ROOM_DEPTH = 3.5
const ROOM_FRONT_Z = 0
const ROOM_CENTER_Z = ROOM_FRONT_Z - BASE_ROOM_DEPTH / 2
const ROOM_BACK_Z = ROOM_FRONT_Z - BASE_ROOM_DEPTH

const controls = {
  horizontalSensitivity: 2.8,
  verticalSensitivity: 2.2,
  depthSensitivity: 1.6,
  smoothing: 0.14,
  targetCount: 10,
  roomDepth: BASE_ROOM_DEPTH,
  targetNear: 0.6,
  targetFar: BASE_ROOM_DEPTH - 0.2,
  targetMinScale: 0.22,
  targetMaxScale: 0.42,
  mainTargetDepth: BASE_ROOM_DEPTH / 2,
  mainTargetScale: 1,
}

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0xd7e6f1, 0.05)

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100)
camera.position.set(0, 0, 1.4)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(sceneRoot.clientWidth, sceneRoot.clientHeight)
renderer.setClearColor(0xd6e4ef)
sceneRoot.appendChild(renderer.domElement)

const sceneWorld = new THREE.Group()
scene.add(sceneWorld)

const roomStructure = new THREE.Group()
sceneWorld.add(roomStructure)

const targetsLayer = new THREE.Group()
sceneWorld.add(targetsLayer)

const ambient = new THREE.AmbientLight(0xffffff, 0.9)
scene.add(ambient)
const keyLight = new THREE.DirectionalLight(0xffffff, 0.6)
keyLight.position.set(2, 3, 2)
scene.add(keyLight)

const wallLineMaterial = new THREE.LineBasicMaterial({ color: 0x4f6f86 })
const createHorizontalGrid = () =>
  new THREE.LineSegments(
      new THREE.WireframeGeometry(
      new THREE.PlaneGeometry(ROOM_WIDTH, BASE_ROOM_DEPTH, 18, 10)
      ),
    wallLineMaterial
  )

const floor = createHorizontalGrid()
floor.rotation.x = -Math.PI / 2
floor.position.set(0, -ROOM_HEIGHT / 2, ROOM_CENTER_Z)
roomStructure.add(floor)

const ceiling = createHorizontalGrid()
ceiling.rotation.x = -Math.PI / 2
ceiling.position.set(0, ROOM_HEIGHT / 2, ROOM_CENTER_Z)
roomStructure.add(ceiling)

const createBackWallGrid = () =>
  new THREE.LineSegments(
    new THREE.WireframeGeometry(
      new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT, 18, 12)
    ),
    wallLineMaterial
  )

const createSideWallGrid = () =>
  new THREE.LineSegments(
      new THREE.WireframeGeometry(
      new THREE.PlaneGeometry(BASE_ROOM_DEPTH, ROOM_HEIGHT, 10, 12)
      ),
    wallLineMaterial
  )

const backWall = createBackWallGrid()
backWall.position.set(0, 0, ROOM_BACK_Z)
roomStructure.add(backWall)

const leftWall = createSideWallGrid()
leftWall.rotation.y = Math.PI / 2
leftWall.position.set(-ROOM_WIDTH / 2, 0, ROOM_CENTER_Z)
roomStructure.add(leftWall)

const rightWall = createSideWallGrid()
rightWall.rotation.y = -Math.PI / 2
rightWall.position.set(ROOM_WIDTH / 2, 0, ROOM_CENTER_Z)
roomStructure.add(rightWall)

const hazeLayerMaterial = new THREE.MeshBasicMaterial({
  color: 0xe7f1f7,
  transparent: true,
  opacity: 0.08,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const hazeDepths = [ROOM_CENTER_Z - 0.3, ROOM_CENTER_Z - 0.9, ROOM_BACK_Z + 0.25]
hazeDepths.forEach((depth, index) => {
  const hazeLayer = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH * 1.1, ROOM_HEIGHT * 1.02),
    hazeLayerMaterial.clone()
  )
  const material = hazeLayer.material as THREE.MeshBasicMaterial
  material.opacity = 0.05 + index * 0.02
  hazeLayer.position.set(0, 0, depth)
  roomStructure.add(hazeLayer)
})

const bullseyeRings = [0.9, 0.72, 0.54, 0.36, 0.18]
const bullseyeColors = [0xd1413d, 0xf4f1e8, 0xd1413d, 0xf4f1e8, 0xd1413d]

const createBullseye = (scale: number) => {
  const bullseye = new THREE.Group()

  bullseyeRings.forEach((radius, index) => {
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(radius * scale, 48),
      new THREE.MeshBasicMaterial({ color: bullseyeColors[index] })
    )
    ring.position.z = index * 0.001
    bullseye.add(ring)
  })

  return bullseye
}

const mainBullseye = createBullseye(1)
mainBullseye.position.set(0, 0, ROOM_CENTER_Z)
targetsLayer.add(mainBullseye)

const secondaryTargets = new THREE.Group()
targetsLayer.add(secondaryTargets)

const getRoomDepth = () => controls.roomDepth

const getRoomCenterZ = () => ROOM_FRONT_Z - getRoomDepth() / 2

const normalizeMainTargetControls = () => {
  controls.mainTargetDepth = THREE.MathUtils.clamp(
    controls.mainTargetDepth,
    0.1,
    controls.roomDepth - 0.05
  )
  controls.mainTargetScale = THREE.MathUtils.clamp(controls.mainTargetScale, 0.3, 2.5)
}

const applyMainTargetSettings = () => {
  normalizeMainTargetControls()
  mainBullseye.position.z = ROOM_FRONT_Z - controls.mainTargetDepth
  mainBullseye.scale.setScalar(controls.mainTargetScale)
}

const normalizeTargetDepthControls = () => {
  controls.roomDepth = THREE.MathUtils.clamp(controls.roomDepth, 1.2, 8)
  controls.mainTargetDepth = Math.min(controls.mainTargetDepth, controls.roomDepth - 0.05)
  const nearMax = controls.roomDepth - 0.15
  controls.targetNear = THREE.MathUtils.clamp(controls.targetNear, 0.1, nearMax)
  const farMin = controls.targetNear + 0.1
  const farMax = controls.roomDepth - 0.05
  controls.targetFar = THREE.MathUtils.clamp(controls.targetFar, farMin, farMax)
}

const getTargetDepthRange = () => {
  normalizeTargetDepthControls()

  return {
    nearZ: ROOM_FRONT_Z - controls.targetNear,
    farZ: ROOM_FRONT_Z - controls.targetFar,
  }
}

const getSecondaryAnchorTargets = () => {
  const { nearZ, farZ } = getTargetDepthRange()
  return [
    { x: -1.6, y: 0.8, z: farZ + 0.15 },
    { x: 1.5, y: -0.7, z: nearZ - 0.15 },
  ]
}

const getRoomBounds = () => {
  const halfWidth = (ROOM_WIDTH * roomStructure.scale.x) / 2
  const halfHeight = (ROOM_HEIGHT * roomStructure.scale.y) / 2
  return { halfWidth, halfHeight }
}

const randomSecondaryPosition = () => {
  const { halfWidth, halfHeight } = getRoomBounds()
  const { nearZ, farZ } = getTargetDepthRange()
  const xMargin = 0.35
  const yMargin = 0.3
  const minX = -halfWidth + xMargin
  const maxX = halfWidth - xMargin
  const minY = -halfHeight + yMargin
  const maxY = halfHeight - yMargin
  let x = 0
  let y = 0
  let z = 0

  do {
    x = THREE.MathUtils.randFloat(minX, maxX)
    y = THREE.MathUtils.randFloat(minY, maxY)
    z = THREE.MathUtils.randFloat(farZ, nearZ)
  } while (
    Math.abs(x) < 0.55 &&
    Math.abs(y) < 0.55 &&
    Math.abs(z - getRoomCenterZ()) < 0.8
  )

  return { x, y, z }
}

const setSecondaryTargetScale = (target: THREE.Object3D, scale: number) => {
  const clampedScale = THREE.MathUtils.clamp(
    scale,
    Math.min(controls.targetMinScale, controls.targetMaxScale),
    Math.max(controls.targetMinScale, controls.targetMaxScale)
  )
  target.scale.setScalar(clampedScale)
  target.userData.targetScale = clampedScale
}

const serializeSecondaryTargets = (): SerializedTarget[] =>
  secondaryTargets.children.map((target) => ({
    x: target.position.x,
    y: target.position.y,
    z: target.position.z,
    scale: Number(target.userData.targetScale ?? target.scale.x ?? 1),
  }))

const createLayoutSnapshot = (): LayoutSnapshot => ({
  version: 1,
  controls: {
    roomDepth: controls.roomDepth,
    targetNear: controls.targetNear,
    targetFar: controls.targetFar,
    targetMinScale: controls.targetMinScale,
    targetMaxScale: controls.targetMaxScale,
    mainTargetDepth: controls.mainTargetDepth,
    mainTargetScale: controls.mainTargetScale,
    targetCount: controls.targetCount,
  },
  secondaryTargets: serializeSecondaryTargets(),
})

const setSecondaryTargetsFromSnapshot = (serializedTargets: SerializedTarget[]) => {
  const { halfWidth, halfHeight } = getRoomBounds()
  const { nearZ, farZ } = getTargetDepthRange()
  const xLimit = Math.max(halfWidth - 0.35, 0.1)
  const yLimit = Math.max(halfHeight - 0.3, 0.1)

  const targetCount = THREE.MathUtils.clamp(
    Math.floor(serializedTargets.length),
    2,
    30
  )
  controls.targetCount = targetCount
  secondaryTargets.clear()

  const normalizedTargets = [...serializedTargets]
  for (let i = normalizedTargets.length; i < targetCount; i += 1) {
    const randomPosition = randomSecondaryPosition()
    normalizedTargets.push({
      x: randomPosition.x,
      y: randomPosition.y,
      z: randomPosition.z,
      scale: THREE.MathUtils.randFloat(controls.targetMinScale, controls.targetMaxScale),
    })
  }

  normalizedTargets.slice(0, targetCount).forEach((targetData) => {
    const bullseye = createBullseye(1)
    bullseye.position.set(
      THREE.MathUtils.clamp(targetData.x, -xLimit, xLimit),
      THREE.MathUtils.clamp(targetData.y, -yLimit, yLimit),
      THREE.MathUtils.clamp(targetData.z, farZ, nearZ)
    )
    setSecondaryTargetScale(bullseye, targetData.scale)
    secondaryTargets.add(bullseye)
  })
}

const applyLayoutSnapshot = (snapshot: LayoutSnapshot) => {
  controls.roomDepth = snapshot.controls.roomDepth
  controls.targetNear = snapshot.controls.targetNear
  controls.targetFar = snapshot.controls.targetFar
  controls.targetMinScale = snapshot.controls.targetMinScale
  controls.targetMaxScale = snapshot.controls.targetMaxScale
  controls.mainTargetDepth = snapshot.controls.mainTargetDepth
  controls.mainTargetScale = snapshot.controls.mainTargetScale

  normalizeTargetDepthControls()
  normalizeMainTargetControls()
  updateRoomSize()
  setSecondaryTargetsFromSnapshot(snapshot.secondaryTargets)
  keepTargetsInsideRoom()
}

const isValidLayoutSnapshot = (value: unknown): value is LayoutSnapshot => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const snapshot = value as Partial<LayoutSnapshot>
  if (snapshot.version !== 1 || !snapshot.controls || !Array.isArray(snapshot.secondaryTargets)) {
    return false
  }

  const controlsData = snapshot.controls as Partial<LayoutSnapshot['controls']>
  const requiredControlKeys: Array<keyof LayoutSnapshot['controls']> = [
    'roomDepth',
    'targetNear',
    'targetFar',
    'targetMinScale',
    'targetMaxScale',
    'mainTargetDepth',
    'mainTargetScale',
    'targetCount',
  ]

  if (requiredControlKeys.some((key) => typeof controlsData[key] !== 'number')) {
    return false
  }

  return snapshot.secondaryTargets.every((target) =>
    typeof target.x === 'number' &&
    typeof target.y === 'number' &&
    typeof target.z === 'number' &&
    typeof target.scale === 'number'
  )
}

const buildSecondaryTargets = (requestedCount: number) => {
  const { halfWidth, halfHeight } = getRoomBounds()
  const { nearZ, farZ } = getTargetDepthRange()
  const minScale = Math.min(controls.targetMinScale, controls.targetMaxScale)
  const maxScale = Math.max(controls.targetMinScale, controls.targetMaxScale)
  controls.targetMinScale = minScale
  controls.targetMaxScale = maxScale
  const xLimit = Math.max(halfWidth - 0.35, 0.1)
  const yLimit = Math.max(halfHeight - 0.3, 0.1)
  const targetCount = THREE.MathUtils.clamp(Math.floor(requestedCount), 2, 30)
  controls.targetCount = targetCount
  secondaryTargets.clear()

  const positions = [...getSecondaryAnchorTargets()]
  for (let i = positions.length; i < targetCount; i += 1) {
    positions.push(randomSecondaryPosition())
  }

  positions.forEach(({ x, y, z }) => {
    const bullseye = createBullseye(1)
    bullseye.position.set(
      THREE.MathUtils.clamp(x, -xLimit, xLimit),
      THREE.MathUtils.clamp(y, -yLimit, yLimit),
      THREE.MathUtils.clamp(z, farZ, nearZ)
    )
    setSecondaryTargetScale(bullseye, THREE.MathUtils.randFloat(minScale, maxScale))
    secondaryTargets.add(bullseye)
  })
}

buildSecondaryTargets(controls.targetCount)
applyMainTargetSettings()

const frameGeometry = new THREE.BufferGeometry()
const frame = new THREE.Line(
  frameGeometry,
  new THREE.LineBasicMaterial({ color: 0x1f3548 })
)
frame.position.z = -0.002
scene.add(frame)

const getWindowBounds = () => {
  const windowUnitsPerPixel =
    WINDOW_HEIGHT / Math.max(sceneRoot.clientHeight, 1)
  const width = sceneRoot.clientWidth * windowUnitsPerPixel
  const height = sceneRoot.clientHeight * windowUnitsPerPixel
  return {
    left: -width / 2,
    right: width / 2,
    top: height / 2,
    bottom: -height / 2,
  }
}

const updateFrameGeometry = () => {
  const { left, right, top, bottom } = getWindowBounds()
  const framePoints = [
    new THREE.Vector3(left, bottom, 0),
    new THREE.Vector3(right, bottom, 0),
    new THREE.Vector3(right, top, 0),
    new THREE.Vector3(left, top, 0),
    new THREE.Vector3(left, bottom, 0),
  ]
  frameGeometry.setFromPoints(framePoints)
}

updateFrameGeometry()

const updateRoomSize = () => {
  const { left, right, top, bottom } = getWindowBounds()
  const roomWidth = right - left
  const roomHeight = top - bottom
  roomStructure.scale.set(
    roomWidth / ROOM_WIDTH,
    roomHeight / ROOM_HEIGHT,
    getRoomDepth() / BASE_ROOM_DEPTH
  )
  applyMainTargetSettings()
}

const keepTargetsInsideRoom = () => {
  const { halfWidth, halfHeight } = getRoomBounds()
  const { nearZ, farZ } = getTargetDepthRange()
  const xLimit = Math.max(halfWidth - 0.35, 0.1)
  const yLimit = Math.max(halfHeight - 0.3, 0.1)

  secondaryTargets.children.forEach((target) => {
    target.position.x = THREE.MathUtils.clamp(target.position.x, -xLimit, xLimit)
    target.position.y = THREE.MathUtils.clamp(target.position.y, -yLimit, yLimit)
    target.position.z = THREE.MathUtils.clamp(target.position.z, farZ, nearZ)
    const existingScale = Number(target.userData.targetScale ?? target.scale.x ?? 1)
    setSecondaryTargetScale(target, existingScale)
  })
}

updateRoomSize()
keepTargetsInsideRoom()

const view = {
  smoothed: { x: 0, y: 0, z: 1.4 },
  target: { x: 0, y: 0, z: 1.4 },
  calibration: { x: 0.5, y: 0.5, eyeDistance: 0.07 },
  hasCalibration: false,
  lastPoseAt: 0,
}

let faceLandmarker: FaceLandmarker | null = null
let stream: MediaStream | null = null

const setStatus = (message: string) => {
  statusPill.textContent = message
}

const updateFrustum = () => {
  const near = camera.near
  const far = camera.far
  const eyeX = camera.position.x
  const eyeY = camera.position.y
  const eyeZ = Math.max(camera.position.z, 0.25)

  const { left, right, top, bottom } = getWindowBounds()

  const frustumLeft = (near * (left - eyeX)) / eyeZ
  const frustumRight = (near * (right - eyeX)) / eyeZ
  const frustumTop = (near * (top - eyeY)) / eyeZ
  const frustumBottom = (near * (bottom - eyeY)) / eyeZ

  camera.projectionMatrix.makePerspective(
    frustumLeft,
    frustumRight,
    frustumTop,
    frustumBottom,
    near,
    far
  )
}

const readPose = (): Pose | null => {
  if (!faceLandmarker || webcam.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null
  }

  const result = faceLandmarker.detectForVideo(webcam, performance.now())
  if (!result.faceLandmarks.length) {
    return null
  }

  const landmarks = result.faceLandmarks[0]
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const nose = landmarks[1]

  if (!leftEye || !rightEye || !nose) {
    return null
  }

  const eyeDistance = Math.max(Math.abs(leftEye.x - rightEye.x), 0.01)
  return {
    x: (leftEye.x + rightEye.x) / 2,
    y: nose.y,
    z: nose.z,
    eyeDistance,
  }
}

const applyPose = (pose: Pose) => {
  if (!view.hasCalibration) {
    view.calibration = {
      x: pose.x,
      y: pose.y,
      eyeDistance: pose.eyeDistance,
    }
    view.hasCalibration = true
  }

  const sensX = controls.horizontalSensitivity
  const sensY = controls.verticalSensitivity
  const sensZ = controls.depthSensitivity

  const normalizedX = -(pose.x - view.calibration.x) * sensX
  const normalizedY = (view.calibration.y - pose.y) * sensY
  const depthFactor = view.calibration.eyeDistance / pose.eyeDistance
  const normalizedZ = (depthFactor - 1) * sensZ

  view.target.x = THREE.MathUtils.clamp(normalizedX, -1.4, 1.4)
  view.target.y = THREE.MathUtils.clamp(normalizedY, -0.8, 0.8)
  view.target.z = THREE.MathUtils.clamp(1.4 + normalizedZ, 0.7, 2.6)
  view.lastPoseAt = performance.now()
}

const animate = () => {
  requestAnimationFrame(animate)

  const pose = readPose()
  if (pose) {
    applyPose(pose)
    setStatus('Tracking active')
  } else if (performance.now() - view.lastPoseAt > 800) {
    view.target.x = 0
    view.target.y = 0
    view.target.z = 1.4
    setStatus('No face detected')
  }

  const alpha = controls.smoothing
  view.smoothed.x += (view.target.x - view.smoothed.x) * alpha
  view.smoothed.y += (view.target.y - view.smoothed.y) * alpha
  view.smoothed.z += (view.target.z - view.smoothed.z) * alpha

  camera.position.set(view.smoothed.x, view.smoothed.y, view.smoothed.z)
  camera.lookAt(view.smoothed.x, view.smoothed.y, view.smoothed.z - 1)
  updateFrustum()

  sceneWorld.rotation.y = view.smoothed.x * 0.03
  renderer.render(scene, camera)
}

const resize = () => {
  const width = sceneRoot.clientWidth
  const height = sceneRoot.clientHeight
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  updateFrameGeometry()
  updateRoomSize()
  keepTargetsInsideRoom()
}

const loadTracker = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    numFaces: 1,
    runningMode: 'VIDEO',
  })
}

const startCamera = async () => {
  try {
    if (!faceLandmarker) {
      setStatus('Loading face tracker...')
      await loadTracker()
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })

    webcam.srcObject = stream
    await webcam.play()
    setStatus('Camera ready, searching for face...')
  } catch (error) {
    console.error(error)
    setStatus('Camera or model failed to start')
  }
}

const applyRoomAndTargetSettings = () => {
  normalizeTargetDepthControls()
  normalizeMainTargetControls()
  mainTargetDepthController.min(0.1).max(controls.roomDepth - 0.05)
  targetNearController.min(0.1).max(controls.roomDepth - 0.15)
  targetFarController.min(controls.targetNear + 0.1).max(controls.roomDepth - 0.05)
  roomDepthController.updateDisplay()
  mainTargetDepthController.updateDisplay()
  mainTargetScaleController.updateDisplay()
  targetCountController.updateDisplay()
  targetMinScaleController.updateDisplay()
  targetMaxScaleController.updateDisplay()
  targetNearController.updateDisplay()
  targetFarController.updateDisplay()
  updateRoomSize()
  keepTargetsInsideRoom()
}

const exportLayoutToDisk = () => {
  const snapshot = createLayoutSnapshot()
  const data = JSON.stringify(snapshot, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const fileName = `target-layout-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  setStatus('Layout exported as JSON')
}

const importLayoutFromDisk = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    try {
      const file = input.files?.[0]
      if (!file) {
        return
      }

      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!isValidLayoutSnapshot(parsed)) {
        setStatus('Invalid layout JSON')
        return
      }

      applyLayoutSnapshot(parsed)
      applyRoomAndTargetSettings()
      setSecondaryTargetsFromSnapshot(parsed.secondaryTargets)
      keepTargetsInsideRoom()
      setStatus('Layout imported from JSON')
    } catch (error) {
      console.error(error)
      setStatus('Failed to import layout JSON')
    }
  }
  input.click()
}

const saveLayoutToLocalStorage = () => {
  try {
    const snapshot = createLayoutSnapshot()
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(snapshot))
    setStatus('Layout saved locally')
  } catch (error) {
    console.error(error)
    setStatus('Failed to save layout locally')
  }
}

const loadLayoutFromLocalStorage = () => {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!saved) {
      setStatus('No local layout found')
      return
    }

    const parsed = JSON.parse(saved) as unknown
    if (!isValidLayoutSnapshot(parsed)) {
      setStatus('Saved local layout is invalid')
      return
    }

    applyLayoutSnapshot(parsed)
    applyRoomAndTargetSettings()
    setSecondaryTargetsFromSnapshot(parsed.secondaryTargets)
    keepTargetsInsideRoom()
    setStatus('Layout loaded from local save')
  } catch (error) {
    console.error(error)
    setStatus('Failed to load local layout')
  }
}

const gui = new GUI({ container: sceneRoot, title: 'Tracking Controls' })
gui.open()
gui.domElement.style.position = 'absolute'
gui.domElement.style.top = '0.75rem'
gui.domElement.style.right = '0.75rem'
gui.domElement.style.zIndex = '4'
gui.add({ startCamera: () => void startCamera() }, 'startCamera').name('Start Camera')
gui.add({ calibrate: () => {
  view.hasCalibration = false
  setStatus('Calibration reset, hold neutral pose')
} }, 'calibrate').name('Calibrate Center')
const roomDepthController = gui.add(controls, 'roomDepth', 1.2, 8, 0.1).name('Room Depth')
const mainTargetDepthController =
  gui.add(controls, 'mainTargetDepth', 0.1, BASE_ROOM_DEPTH - 0.05, 0.05).name('Main Target Depth')
const mainTargetScaleController =
  gui.add(controls, 'mainTargetScale', 0.3, 2.5, 0.01).name('Main Target Size')
const targetNearController = gui.add(controls, 'targetNear', 0.1, 7.5, 0.05).name('Target Near')
const targetFarController = gui.add(controls, 'targetFar', 0.2, 8, 0.05).name('Target Far')
const targetMinScaleController =
  gui.add(controls, 'targetMinScale', 0.1, 0.7, 0.01).name('Target Min Size')
const targetMaxScaleController =
  gui.add(controls, 'targetMaxScale', 0.12, 1.1, 0.01).name('Target Max Size')
gui.add(controls, 'horizontalSensitivity', 0.5, 6, 0.1).name('Horizontal Sensitivity')
gui.add(controls, 'verticalSensitivity', 0.5, 6, 0.1).name('Vertical Sensitivity')
gui.add(controls, 'depthSensitivity', 0, 5, 0.1).name('Depth Sensitivity')
gui.add(controls, 'smoothing', 0.02, 0.4, 0.01).name('Smoothing')
const targetCountController = gui
  .add(controls, 'targetCount', 2, 30, 1)
  .name('Secondary Targets')
  .onChange((value: number) => {
    buildSecondaryTargets(value)
  })
gui
  .add({ rerandomize: () => {
    buildSecondaryTargets(controls.targetCount)
    setStatus('Secondary targets rerandomized')
  } }, 'rerandomize')
  .name('Rerandomize Targets')
gui.add({ exportLayoutToDisk }, 'exportLayoutToDisk').name('Export Layout JSON')
gui.add({ importLayoutFromDisk: () => void importLayoutFromDisk() }, 'importLayoutFromDisk').name('Import Layout JSON')
gui.add({ saveLayoutToLocalStorage }, 'saveLayoutToLocalStorage').name('Save Layout Local')
gui.add({ loadLayoutFromLocalStorage }, 'loadLayoutFromLocalStorage').name('Load Layout Local')

roomDepthController.onChange(() => {
  applyRoomAndTargetSettings()
})

mainTargetDepthController.onChange(() => {
  applyRoomAndTargetSettings()
})

mainTargetScaleController.onChange(() => {
  applyRoomAndTargetSettings()
})

targetNearController.onChange(() => {
  applyRoomAndTargetSettings()
})

targetFarController.onChange(() => {
  applyRoomAndTargetSettings()
})

targetMinScaleController.onChange(() => {
  controls.targetMinScale = Math.min(controls.targetMinScale, controls.targetMaxScale)
  targetMinScaleController.updateDisplay()
  applyRoomAndTargetSettings()
})

targetMaxScaleController.onChange(() => {
  controls.targetMaxScale = Math.max(controls.targetMaxScale, controls.targetMinScale)
  targetMaxScaleController.updateDisplay()
  applyRoomAndTargetSettings()
})

window.addEventListener('resize', resize)
resize()
setStatus('Open controls and click Start Camera')
animate()
