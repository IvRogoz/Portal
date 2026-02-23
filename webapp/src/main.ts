import './style.css'
import * as THREE from 'three'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app-shell">
    <header class="top-bar">
      <div>
        <p class="eyebrow">Head-Tracked Window</p>
        <h1>Parallax Room Viewer</h1>
      </div>
      <div class="actions">
        <button id="start-camera">Start Camera</button>
        <button id="calibrate" disabled>Calibrate Center</button>
      </div>
    </header>

    <section class="viewport-card">
      <div id="scene" class="scene"></div>
      <video id="webcam" autoplay playsinline muted></video>
      <div id="status" class="status-pill">Initializing...</div>
    </section>

    <section class="controls">
      <label>
        Horizontal Sensitivity
        <input id="sens-x" type="range" min="0.5" max="6" step="0.1" value="2.8" />
      </label>
      <label>
        Vertical Sensitivity
        <input id="sens-y" type="range" min="0.5" max="6" step="0.1" value="2.2" />
      </label>
      <label>
        Depth Sensitivity
        <input id="sens-z" type="range" min="0" max="5" step="0.1" value="1.6" />
      </label>
      <label>
        Smoothing
        <input id="smooth" type="range" min="0.02" max="0.4" step="0.01" value="0.14" />
      </label>
    </section>
  </main>
`

type Pose = {
  x: number
  y: number
  z: number
  eyeDistance: number
}

const sceneRoot = document.querySelector<HTMLDivElement>('#scene')!
const webcam = document.querySelector<HTMLVideoElement>('#webcam')!
const statusPill = document.querySelector<HTMLDivElement>('#status')!
const startButton = document.querySelector<HTMLButtonElement>('#start-camera')!
const calibrateButton = document.querySelector<HTMLButtonElement>('#calibrate')!
const sensXInput = document.querySelector<HTMLInputElement>('#sens-x')!
const sensYInput = document.querySelector<HTMLInputElement>('#sens-y')!
const sensZInput = document.querySelector<HTMLInputElement>('#sens-z')!
const smoothInput = document.querySelector<HTMLInputElement>('#smooth')!

const WINDOW_WIDTH = 3
const WINDOW_HEIGHT = 1.8

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x9ab6cc, 8, 20)

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100)
camera.position.set(0, 0, 1.4)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(sceneRoot.clientWidth, sceneRoot.clientHeight)
renderer.setClearColor(0xd6e4ef)
sceneRoot.appendChild(renderer.domElement)

const sceneWorld = new THREE.Group()
scene.add(sceneWorld)

const ambient = new THREE.AmbientLight(0xffffff, 0.9)
scene.add(ambient)
const keyLight = new THREE.DirectionalLight(0xffffff, 0.6)
keyLight.position.set(2, 3, 2)
scene.add(keyLight)

const floor = new THREE.GridHelper(7, 18, 0x294861, 0x4f6f86)
floor.position.set(0, -2.2, -4.8)
sceneWorld.add(floor)

const ceiling = floor.clone()
ceiling.position.set(0, 2.2, -4.8)
sceneWorld.add(ceiling)

const backWall = new THREE.GridHelper(7, 18, 0x294861, 0x4f6f86)
backWall.rotation.x = Math.PI / 2
backWall.position.set(0, 0, -8.3)
sceneWorld.add(backWall)

const leftWall = new THREE.GridHelper(7, 18, 0x294861, 0x4f6f86)
leftWall.rotation.z = Math.PI / 2
leftWall.position.set(-3.5, 0, -4.8)
sceneWorld.add(leftWall)

const rightWall = leftWall.clone()
rightWall.position.x = 3.5
sceneWorld.add(rightWall)

const bullseyeRings = [0.9, 0.72, 0.54, 0.36, 0.18]
const bullseyeColors = [0xd1413d, 0xf4f1e8, 0xd1413d, 0xf4f1e8, 0xd1413d]

const createBullseye = () => {
  const bullseye = new THREE.Group()

  bullseyeRings.forEach((radius, index) => {
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshBasicMaterial({ color: bullseyeColors[index] })
    )
    ring.position.z = index * 0.001
    bullseye.add(ring)
  })

  return bullseye
}

const bullseyePositions = [
  { x: 0, y: 0, z: -4.8 },
  { x: -1.6, y: 0.8, z: -7.2 },
  { x: 1.5, y: -0.7, z: -2.6 },
]

bullseyePositions.forEach(({ x, y, z }) => {
  const bullseye = createBullseye()
  bullseye.position.set(x, y, z)
  sceneWorld.add(bullseye)
})

const frameShape = new THREE.Shape()
frameShape.moveTo(-WINDOW_WIDTH / 2, -WINDOW_HEIGHT / 2)
frameShape.lineTo(WINDOW_WIDTH / 2, -WINDOW_HEIGHT / 2)
frameShape.lineTo(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2)
frameShape.lineTo(-WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2)
frameShape.lineTo(-WINDOW_WIDTH / 2, -WINDOW_HEIGHT / 2)
const framePoints = frameShape.getPoints()
const frameGeometry = new THREE.BufferGeometry().setFromPoints(framePoints)
const frame = new THREE.Line(
  frameGeometry,
  new THREE.LineBasicMaterial({ color: 0x1f3548 })
)
frame.position.z = -0.002
scene.add(frame)

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

  const left = -WINDOW_WIDTH / 2
  const right = WINDOW_WIDTH / 2
  const top = WINDOW_HEIGHT / 2
  const bottom = -WINDOW_HEIGHT / 2

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

  const sensX = Number(sensXInput.value)
  const sensY = Number(sensYInput.value)
  const sensZ = Number(sensZInput.value)

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
    calibrateButton.disabled = false
    setStatus('Tracking active')
  } else if (performance.now() - view.lastPoseAt > 800) {
    view.target.x = 0
    view.target.y = 0
    view.target.z = 1.4
    setStatus('No face detected')
  }

  const alpha = Number(smoothInput.value)
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
    startButton.disabled = true
  } catch (error) {
    console.error(error)
    setStatus('Camera or model failed to start')
  }
}

startButton.addEventListener('click', () => {
  void startCamera()
})

calibrateButton.addEventListener('click', () => {
  view.hasCalibration = false
  setStatus('Calibration reset, hold neutral pose')
})

window.addEventListener('resize', resize)
resize()
setStatus('Click Start Camera to begin')
animate()
