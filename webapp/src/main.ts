import './style.css'
import * as THREE from 'three'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

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
  cameraFov: 60,
  cameraNear: 0.05,
  cameraFar: 100,
  fogColor: '#d7e6f1',
  backgroundColor: '#d6e4ef',
  fogDensity: 0.05,
  exposure: 1.05,
  useEnvironmentLight: true,
  environmentIntensity: 1,
  ambientIntensity: 0.35,
  hemiIntensity: 0.65,
  keyIntensity: 1.45,
  fillIntensity: 0.42,
  sunX: 4,
  sunY: 6,
  sunZ: 5,
  keyShadowBias: -0.00015,
  keyShadowNormalBias: 0.01,
  keyShadowRadius: 1.5,
  shadowGroundOpacity: 0.32,
  allObjectsShadowCatcher: false,
  showSkybox: true,
  shadowsEnabled: true,
  targetCount: 10,
  roomDepth: BASE_ROOM_DEPTH,
  targetNear: 0.6,
  targetFar: BASE_ROOM_DEPTH - 0.2,
  targetMinScale: 0.22,
  targetMaxScale: 0.42,
  mainTargetDepth: BASE_ROOM_DEPTH / 2,
  mainTargetScale: 1,
  useSceneGlb: false,
}

const cameraDebug = {
  manualControl: false,
  freezeTracking: false,
  positionX: 0,
  positionY: 0,
  positionZ: 1.4,
  pitch: 0,
  yaw: 0,
  roll: 0,
}

const scene = new THREE.Scene()
const sceneFog = new THREE.FogExp2(controls.fogColor, controls.fogDensity)
scene.fog = sceneFog

const DEFAULT_CAMERA_BASE_POSITION = new THREE.Vector3(0, 0, 1.4)

const camera = new THREE.PerspectiveCamera(
  controls.cameraFov,
  1,
  controls.cameraNear,
  controls.cameraFar
)
camera.position.copy(DEFAULT_CAMERA_BASE_POSITION)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(sceneRoot.clientWidth, sceneRoot.clientHeight)
renderer.setClearColor(controls.backgroundColor)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = controls.exposure
renderer.shadowMap.enabled = controls.shadowsEnabled
renderer.shadowMap.type = THREE.PCFSoftShadowMap
sceneRoot.appendChild(renderer.domElement)

const pmremGenerator = new THREE.PMREMGenerator(renderer)
const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
scene.environment = environmentTexture

const createSkyTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, '#8fb7de')
  gradient.addColorStop(0.35, '#b5d3ec')
  gradient.addColorStop(0.62, '#d7e6f1')
  gradient.addColorStop(1, '#f3f0e9')

  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.needsUpdate = true

  return texture
}

const skyTexture = createSkyTexture()
if (skyTexture) {
  scene.background = skyTexture
}

const sceneWorld = new THREE.Group()
scene.add(sceneWorld)

const roomStructure = new THREE.Group()
sceneWorld.add(roomStructure)

const targetsLayer = new THREE.Group()
sceneWorld.add(targetsLayer)

const glbSceneLayer = new THREE.Group()
glbSceneLayer.visible = false
sceneWorld.add(glbSceneLayer)

const ambient = new THREE.AmbientLight(0xffffff, controls.ambientIntensity)
scene.add(ambient)
const hemiLight = new THREE.HemisphereLight(0xc9e3ff, 0xcabda9, controls.hemiIntensity)
scene.add(hemiLight)

const keyLight = new THREE.DirectionalLight(0xfff3df, controls.keyIntensity)
keyLight.position.set(controls.sunX, controls.sunY, controls.sunZ)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.bias = controls.keyShadowBias
keyLight.shadow.normalBias = controls.keyShadowNormalBias
keyLight.shadow.radius = controls.keyShadowRadius
keyLight.shadow.camera.near = 0.5
keyLight.shadow.camera.far = 30
keyLight.shadow.camera.left = -8
keyLight.shadow.camera.right = 8
keyLight.shadow.camera.top = 8
keyLight.shadow.camera.bottom = -8
scene.add(keyLight)
scene.add(keyLight.target)

const fillLight = new THREE.DirectionalLight(0xd9ecff, controls.fillIntensity)
fillLight.position.set(-5, 3, -4)
scene.add(fillLight)

const glbShadowCatcherMaterial = new THREE.ShadowMaterial({
  opacity: controls.shadowGroundOpacity,
})
const glbShadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glbShadowCatcherMaterial)
glbShadowCatcher.rotation.x = -Math.PI / 2
glbShadowCatcher.receiveShadow = true
glbShadowCatcher.visible = false
glbSceneLayer.add(glbShadowCatcher)

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

const resetCameraDebug = () => {
  cameraDebug.manualControl = false
  cameraDebug.freezeTracking = false
  cameraDebug.positionX = DEFAULT_CAMERA_BASE_POSITION.x
  cameraDebug.positionY = DEFAULT_CAMERA_BASE_POSITION.y
  cameraDebug.positionZ = DEFAULT_CAMERA_BASE_POSITION.z
  cameraDebug.pitch = 0
  cameraDebug.yaw = 0
  cameraDebug.roll = 0
}

const copyCurrentCameraToManual = () => {
  cameraDebug.positionX = camera.position.x
  cameraDebug.positionY = camera.position.y
  cameraDebug.positionZ = camera.position.z
  cameraDebug.pitch = THREE.MathUtils.radToDeg(camera.rotation.x)
  cameraDebug.yaw = THREE.MathUtils.radToDeg(camera.rotation.y)
  cameraDebug.roll = THREE.MathUtils.radToDeg(camera.rotation.z)
  cameraDebug.manualControl = true
}

const logCameraDebug = () => {
  console.log('[camera debug] world position', {
    x: Number(camera.position.x.toFixed(4)),
    y: Number(camera.position.y.toFixed(4)),
    z: Number(camera.position.z.toFixed(4)),
  })
  console.log('[camera debug] world rotation (deg)', {
    x: Number(THREE.MathUtils.radToDeg(camera.rotation.x).toFixed(2)),
    y: Number(THREE.MathUtils.radToDeg(camera.rotation.y).toFixed(2)),
    z: Number(THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(2)),
  })
}

let faceLandmarker: FaceLandmarker | null = null
let stream: MediaStream | null = null
let glbLoadPromise: Promise<void> | null = null
let loadedGlbRoot: THREE.Object3D | null = null
let glbCameraBasePosition: THREE.Vector3 | null = null
let glbCameraBaseQuaternion: THREE.Quaternion | null = null
const trackingOffset = new THREE.Vector3()

const gltfLoader = new GLTFLoader()

const setStatus = (message: string) => {
  statusPill.textContent = message
}

const applyFogSettings = () => {
  const density = THREE.MathUtils.clamp(controls.fogDensity, 0, 0.2)
  controls.fogDensity = density
  sceneFog.density = density
  sceneFog.color.set(controls.fogColor)
}

const applySunSettings = () => {
  controls.sunX = THREE.MathUtils.clamp(controls.sunX, -30, 30)
  controls.sunY = THREE.MathUtils.clamp(controls.sunY, -5, 40)
  controls.sunZ = THREE.MathUtils.clamp(controls.sunZ, -30, 30)
  keyLight.position.set(controls.sunX, controls.sunY, controls.sunZ)
  keyLight.updateMatrixWorld()
}

const applyEnvironmentSettings = () => {
  controls.environmentIntensity = THREE.MathUtils.clamp(controls.environmentIntensity, 0, 3)
  scene.environment = controls.useEnvironmentLight ? environmentTexture : null

  loadedGlbRoot?.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return
    }

    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material]

    materials.forEach((material) => {
      if (
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshPhysicalMaterial
      ) {
        material.envMapIntensity = controls.useEnvironmentLight
          ? controls.environmentIntensity
          : 0
        material.needsUpdate = true
      }
    })
  })
}

const applyGlbShadowReceiverMode = () => {
  if (!loadedGlbRoot) {
    return
  }

  loadedGlbRoot.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return
    }

    if (controls.allObjectsShadowCatcher) {
      node.castShadow = controls.shadowsEnabled
      node.receiveShadow = controls.shadowsEnabled
      return
    }

    node.castShadow = controls.shadowsEnabled
    node.receiveShadow = false
  })
}

const applyRenderSettings = () => {
  controls.exposure = THREE.MathUtils.clamp(controls.exposure, 0, 2.5)
  controls.ambientIntensity = THREE.MathUtils.clamp(controls.ambientIntensity, 0, 2)
  controls.hemiIntensity = THREE.MathUtils.clamp(controls.hemiIntensity, 0, 2)
  controls.keyIntensity = THREE.MathUtils.clamp(controls.keyIntensity, 0, 4)
  controls.fillIntensity = THREE.MathUtils.clamp(controls.fillIntensity, 0, 4)
  controls.keyShadowBias = THREE.MathUtils.clamp(controls.keyShadowBias, -0.01, 0.01)
  controls.keyShadowNormalBias = THREE.MathUtils.clamp(controls.keyShadowNormalBias, 0, 0.2)
  controls.keyShadowRadius = THREE.MathUtils.clamp(controls.keyShadowRadius, 0, 8)
  controls.shadowGroundOpacity = THREE.MathUtils.clamp(controls.shadowGroundOpacity, 0, 1)

  renderer.toneMappingExposure = controls.exposure
  renderer.shadowMap.enabled = controls.shadowsEnabled
  applyEnvironmentSettings()

  ambient.intensity = controls.ambientIntensity
  hemiLight.intensity = controls.hemiIntensity
  keyLight.intensity = controls.keyIntensity
  fillLight.intensity = controls.fillIntensity
  applySunSettings()

  keyLight.castShadow = controls.shadowsEnabled
  keyLight.shadow.bias = controls.keyShadowBias
  keyLight.shadow.normalBias = controls.keyShadowNormalBias
  keyLight.shadow.radius = controls.keyShadowRadius
  glbShadowCatcherMaterial.opacity = controls.shadowGroundOpacity
  glbShadowCatcher.visible =
    controls.shadowsEnabled &&
    controls.useSceneGlb &&
    !controls.allObjectsShadowCatcher

  applyGlbShadowReceiverMode()

  if (controls.showSkybox && skyTexture) {
    scene.background = skyTexture
  } else {
    scene.background = null
  }
  renderer.setClearColor(controls.backgroundColor)
}

const applyCameraLensSettings = () => {
  controls.cameraFov = THREE.MathUtils.clamp(controls.cameraFov, 20, 120)
  controls.cameraNear = THREE.MathUtils.clamp(controls.cameraNear, 0.01, 10)
  controls.cameraFar = THREE.MathUtils.clamp(
    controls.cameraFar,
    controls.cameraNear + 0.1,
    1000
  )

  camera.fov = controls.cameraFov
  camera.near = controls.cameraNear
  camera.far = controls.cameraFar
  camera.updateProjectionMatrix()
}

const setCameraDefaults = () => {
  applyCameraLensSettings()
}

const ensureSceneGlbLoaded = async () => {
  if (loadedGlbRoot) {
    return
  }

  if (!glbLoadPromise) {
    glbLoadPromise = new Promise<void>((resolve, reject) => {
      gltfLoader.load(
        '/scene2.glb',
        (gltf) => {
          loadedGlbRoot = gltf.scene
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              const materials = Array.isArray(node.material)
                ? node.material
                : [node.material]

              materials.forEach((material) => {
                if (
                  material instanceof THREE.MeshStandardMaterial ||
                  material instanceof THREE.MeshPhysicalMaterial
                ) {
                  material.envMapIntensity = controls.environmentIntensity
                  material.needsUpdate = true
                }
              })
            }
          })

          const sceneBounds = new THREE.Box3().setFromObject(gltf.scene)
          if (!sceneBounds.isEmpty()) {
            const sceneSize = sceneBounds.getSize(new THREE.Vector3())
            const sceneCenter = sceneBounds.getCenter(new THREE.Vector3())
            const maxHalfSpan = Math.max(sceneSize.x, sceneSize.z, 2) * 0.7

            glbShadowCatcher.position.set(sceneCenter.x, sceneBounds.min.y + 0.002, sceneCenter.z)
            glbShadowCatcher.scale.set(
              Math.max(sceneSize.x * 1.1, 2),
              Math.max(sceneSize.z * 1.1, 2),
              1
            )

            keyLight.target.position.copy(sceneCenter)
            keyLight.shadow.camera.left = -maxHalfSpan
            keyLight.shadow.camera.right = maxHalfSpan
            keyLight.shadow.camera.bottom = -maxHalfSpan
            keyLight.shadow.camera.top = maxHalfSpan
            keyLight.shadow.camera.near = 0.1
            keyLight.shadow.camera.far = Math.max(sceneSize.y * 3, 20)
            keyLight.shadow.camera.updateProjectionMatrix()
            keyLight.target.updateMatrixWorld()
          }

          glbSceneLayer.clear()
          glbSceneLayer.add(glbShadowCatcher)
          glbSceneLayer.add(gltf.scene)
          applyGlbShadowReceiverMode()
          console.log('[scene.glb] Ground shadow mode:', {
            usingFallbackShadowCatcher: true,
            allObjectsCatchShadows: controls.allObjectsShadowCatcher,
          })

          const cameraNamedObjects: string[] = []
          const cameraTypeObjects: string[] = []
          gltf.scene.traverse((node) => {
            if (node.name && node.name.toLowerCase().includes('camera')) {
              cameraNamedObjects.push(node.name)
            }
            if ((node as THREE.Object3D).type.toLowerCase().includes('camera')) {
              cameraTypeObjects.push(node.name || '(unnamed)')
            }
          })
          const uniqueCameraNamedObjects = [...new Set(cameraNamedObjects)]
          const gltfCameraNames = gltf.cameras.map((sceneCamera, index) =>
            sceneCamera.name?.trim() ? sceneCamera.name : `(unnamed gltf.cameras[${index}])`
          )
          console.log('[scene.glb] Objects containing "camera" in name:', uniqueCameraNamedObjects)
          console.log('[scene.glb] Camera-typed objects in scene graph:', [...new Set(cameraTypeObjects)])
          console.log('[scene.glb] Cameras array from glTF:', gltfCameraNames)

          glbCameraBasePosition = null
          glbCameraBaseQuaternion = null

          const cameraPositionAnchor =
            gltf.scene.getObjectByName('cameraPosition') ??
            gltf.scene.getObjectByName('CameraPosition') ??
            null

          let firstPerspectiveCamera: THREE.PerspectiveCamera | null = null
          const preferredCameraName = 'camera_main'

          gltf.scene.traverse((node) => {
            if (
              !firstPerspectiveCamera &&
              node instanceof THREE.PerspectiveCamera &&
              node.name.toLowerCase() === preferredCameraName
            ) {
              firstPerspectiveCamera = node
            }
          })

          if (!firstPerspectiveCamera) {
            const namedCameraFromArray = gltf.cameras.find(
              (sceneCamera): sceneCamera is THREE.PerspectiveCamera =>
                sceneCamera instanceof THREE.PerspectiveCamera &&
                sceneCamera.name.toLowerCase() === preferredCameraName
            )
            if (namedCameraFromArray) {
              firstPerspectiveCamera = namedCameraFromArray
            }
          }

          gltf.scene.traverse((node) => {
            if (!firstPerspectiveCamera && node instanceof THREE.PerspectiveCamera) {
              firstPerspectiveCamera = node
            }
          })

          if (!firstPerspectiveCamera) {
            firstPerspectiveCamera =
              gltf.cameras.find((sceneCamera): sceneCamera is THREE.PerspectiveCamera =>
                sceneCamera instanceof THREE.PerspectiveCamera
              ) ?? null
          }

          const cameraAnchorPosition = new THREE.Vector3()
          const cameraAnchorQuaternion = new THREE.Quaternion()
          const cameraAnchorScale = new THREE.Vector3()

          if (cameraPositionAnchor) {
            cameraPositionAnchor.updateWorldMatrix(true, false)
            cameraPositionAnchor.matrixWorld.decompose(
              cameraAnchorPosition,
              cameraAnchorQuaternion,
              cameraAnchorScale
            )
          }

          if (firstPerspectiveCamera) {
            firstPerspectiveCamera.updateWorldMatrix(true, false)
            const worldPosition = new THREE.Vector3()
            const worldQuaternion = new THREE.Quaternion()
            const worldScale = new THREE.Vector3()
            firstPerspectiveCamera.matrixWorld.decompose(
              worldPosition,
              worldQuaternion,
              worldScale
            )

            glbCameraBasePosition = cameraPositionAnchor ? cameraAnchorPosition : worldPosition
            glbCameraBaseQuaternion = worldQuaternion
            console.log('[scene.glb] Active camera:', {
              name: firstPerspectiveCamera.name || '(unnamed)',
              fov: firstPerspectiveCamera.fov,
              near: firstPerspectiveCamera.near,
              far: firstPerspectiveCamera.far,
            })
          } else if (cameraPositionAnchor) {
            glbCameraBasePosition = cameraAnchorPosition
            glbCameraBaseQuaternion = cameraAnchorQuaternion
          }

          resolve()
        },
        undefined,
        (error) => {
          glbLoadPromise = null
          reject(error)
        }
      )
    })
  }

  await glbLoadPromise
}

const applySceneSource = async (useSceneGlb: boolean) => {
  if (useSceneGlb) {
    roomStructure.visible = false
    targetsLayer.visible = false
    glbSceneLayer.visible = true

    try {
      if (!loadedGlbRoot) {
        setStatus('Loading scene.glb...')
      }
      await ensureSceneGlbLoaded()
      setCameraDefaults()
      applyRenderSettings()
      if (controls.useSceneGlb) {
        setStatus('Using scene.glb')
      }
      setDefaultSceneControlsVisibility(false)
      frame.visible = false
    } catch (error) {
      console.error(error)
      controls.useSceneGlb = false
      glbSceneLayer.visible = false
      roomStructure.visible = true
      targetsLayer.visible = true
      setDefaultSceneControlsVisibility(true)
      frame.visible = true
      setStatus('Failed to load scene.glb')
      sceneSourceController.updateDisplay()
    }
    return
  }

  glbSceneLayer.visible = false
  roomStructure.visible = true
  targetsLayer.visible = true
  setCameraDefaults()
  setDefaultSceneControlsVisibility(true)
  frame.visible = true
  applyRenderSettings()
  setStatus('Using room + targets scene')
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

  if (cameraDebug.manualControl) {
    camera.position.set(cameraDebug.positionX, cameraDebug.positionY, cameraDebug.positionZ)
    camera.rotation.set(
      THREE.MathUtils.degToRad(cameraDebug.pitch),
      THREE.MathUtils.degToRad(cameraDebug.yaw),
      THREE.MathUtils.degToRad(cameraDebug.roll),
      'XYZ'
    )
    camera.aspect = sceneRoot.clientWidth / Math.max(sceneRoot.clientHeight, 1)
    camera.updateProjectionMatrix()
  } else {
    const trackedX = cameraDebug.freezeTracking ? 0 : view.smoothed.x
    const trackedY = cameraDebug.freezeTracking ? 0 : view.smoothed.y
    const trackedZ = cameraDebug.freezeTracking ? DEFAULT_CAMERA_BASE_POSITION.z : view.smoothed.z

    if (controls.useSceneGlb) {
      if (glbCameraBasePosition) {
        trackingOffset.set(
          trackedX,
          trackedY,
          trackedZ - DEFAULT_CAMERA_BASE_POSITION.z
        )
        if (glbCameraBaseQuaternion) {
          trackingOffset.applyQuaternion(glbCameraBaseQuaternion)
        }
        camera.position.copy(glbCameraBasePosition).add(trackingOffset)
      } else {
        camera.position.set(trackedX, trackedY, trackedZ)
      }
      if (glbCameraBaseQuaternion) {
        camera.quaternion.copy(glbCameraBaseQuaternion)
      } else {
        camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 1)
      }
      camera.aspect = sceneRoot.clientWidth / Math.max(sceneRoot.clientHeight, 1)
      camera.updateProjectionMatrix()
    } else {
      camera.position.set(trackedX, trackedY, trackedZ)
      camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 1)
      updateFrustum()
    }
  }

  sceneWorld.rotation.y = controls.useSceneGlb ? 0 : view.smoothed.x * 0.03
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
const renderFolder = gui.addFolder('Render')
renderFolder
  .addColor(controls, 'fogColor')
  .name('Fog Color')
  .onChange(() => {
    applyFogSettings()
  })
renderFolder
  .addColor(controls, 'backgroundColor')
  .name('Background Color')
  .onChange(() => {
    controls.showSkybox = false
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'exposure', 0, 2.5, 0.01)
  .name('Exposure')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'useEnvironmentLight')
  .name('Environment Light')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'environmentIntensity', 0, 3, 0.01)
  .name('Env Intensity')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'ambientIntensity', 0, 2, 0.01)
  .name('Ambient Light')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'hemiIntensity', 0, 2, 0.01)
  .name('Sky Fill Light')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'keyIntensity', 0, 4, 0.01)
  .name('Key Light')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'fillIntensity', 0, 4, 0.01)
  .name('Fill Light')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'sunX', -30, 30, 0.01)
  .name('Sun Pos X')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'sunY', -5, 40, 0.01)
  .name('Sun Pos Y')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'sunZ', -30, 30, 0.01)
  .name('Sun Pos Z')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'shadowsEnabled')
  .name('Shadows')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'allObjectsShadowCatcher')
  .name('All Catch Shadows')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'keyShadowBias', -0.01, 0.01, 0.00001)
  .name('Shadow Bias')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'keyShadowNormalBias', 0, 0.2, 0.0001)
  .name('Shadow NormalBias')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'keyShadowRadius', 0, 8, 0.01)
  .name('Shadow Softness')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'shadowGroundOpacity', 0, 1, 0.01)
  .name('Ground Shadow')
  .onChange(() => {
    applyRenderSettings()
  })
renderFolder
  .add(controls, 'showSkybox')
  .name('Show Skybox')
  .onChange(() => {
    applyRenderSettings()
  })
gui
  .add(controls, 'fogDensity', 0, 0.2, 0.001)
  .name('Depth Fog')
  .onChange(() => {
    applyFogSettings()
  })
gui.add({ startCamera: () => void startCamera() }, 'startCamera').name('Start Camera')
gui.add({ calibrate: () => {
  view.hasCalibration = false
  setStatus('Calibration reset, hold neutral pose')
} }, 'calibrate').name('Calibrate Center')
const sceneSourceController = gui
  .add(controls, 'useSceneGlb')
  .name('Use scene.glb')
  .onChange((value: boolean) => {
    void applySceneSource(value)
  })
gui
  .add(
    {
      useDefaultRoom: () => {
        controls.useSceneGlb = false
        sceneSourceController.updateDisplay()
        void applySceneSource(false)
      },
    },
    'useDefaultRoom'
  )
  .name('Use Room + Targets')
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
const cameraDebugFolder = gui.addFolder('Camera Debug')
cameraDebugFolder
  .add(controls, 'cameraFov', 20, 120, 0.1)
  .name('Camera FOV')
  .onChange(() => {
    applyCameraLensSettings()
  })
cameraDebugFolder
  .add(controls, 'cameraNear', 0.01, 10, 0.01)
  .name('Camera Near')
  .onChange(() => {
    applyCameraLensSettings()
    cameraFarController.min(controls.cameraNear + 0.1)
    cameraFarController.updateDisplay()
  })
const cameraFarController = cameraDebugFolder
  .add(controls, 'cameraFar', 0.11, 1000, 0.1)
  .name('Camera Far')
  .onChange(() => {
    applyCameraLensSettings()
  })
cameraDebugFolder
  .add(cameraDebug, 'manualControl')
  .name('Manual Camera')
cameraDebugFolder
  .add(cameraDebug, 'freezeTracking')
  .name('Freeze Tracking')
cameraDebugFolder
  .add(cameraDebug, 'positionX', -20, 20, 0.01)
  .name('Cam Pos X')
cameraDebugFolder
  .add(cameraDebug, 'positionY', -20, 20, 0.01)
  .name('Cam Pos Y')
cameraDebugFolder
  .add(cameraDebug, 'positionZ', -20, 20, 0.01)
  .name('Cam Pos Z')
cameraDebugFolder
  .add(cameraDebug, 'pitch', -180, 180, 0.1)
  .name('Cam Rot X')
cameraDebugFolder
  .add(cameraDebug, 'yaw', -180, 180, 0.1)
  .name('Cam Rot Y')
cameraDebugFolder
  .add(cameraDebug, 'roll', -180, 180, 0.1)
  .name('Cam Rot Z')
cameraDebugFolder
  .add({ copyCurrentCameraToManual }, 'copyCurrentCameraToManual')
  .name('Copy Current To Manual')
cameraDebugFolder
  .add({ resetCameraDebug }, 'resetCameraDebug')
  .name('Reset Camera Debug')
cameraDebugFolder
  .add({ logCameraDebug }, 'logCameraDebug')
  .name('Log Camera Transform')
cameraDebugFolder.close()
const targetCountController = gui
  .add(controls, 'targetCount', 2, 30, 1)
  .name('Secondary Targets')
  .onChange((value: number) => {
    buildSecondaryTargets(value)
  })
const rerandomizeController = gui
  .add({ rerandomize: () => {
    buildSecondaryTargets(controls.targetCount)
    setStatus('Secondary targets rerandomized')
  } }, 'rerandomize')
  .name('Rerandomize Targets')
const exportLayoutController = gui
  .add({ exportLayoutToDisk }, 'exportLayoutToDisk')
  .name('Export Layout JSON')
const importLayoutController = gui
  .add({ importLayoutFromDisk: () => void importLayoutFromDisk() }, 'importLayoutFromDisk')
  .name('Import Layout JSON')
const saveLayoutController = gui
  .add({ saveLayoutToLocalStorage }, 'saveLayoutToLocalStorage')
  .name('Save Layout Local')
const loadLayoutController = gui
  .add({ loadLayoutFromLocalStorage }, 'loadLayoutFromLocalStorage')
  .name('Load Layout Local')

const defaultSceneControllers: Array<{ domElement: HTMLElement }> = [
  roomDepthController,
  mainTargetDepthController,
  mainTargetScaleController,
  targetNearController,
  targetFarController,
  targetMinScaleController,
  targetMaxScaleController,
  targetCountController,
  rerandomizeController,
  exportLayoutController,
  importLayoutController,
  saveLayoutController,
  loadLayoutController,
]

function setDefaultSceneControlsVisibility(visible: boolean) {
  defaultSceneControllers.forEach((controller) => {
    controller.domElement.style.display = visible ? '' : 'none'
  })
}

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
applyCameraLensSettings()
cameraFarController.min(controls.cameraNear + 0.1)
applyFogSettings()
applyRenderSettings()
void applySceneSource(controls.useSceneGlb)
setStatus('Open controls and click Start Camera')
animate()
