import {
  engine,
  executeTask,
  PrimaryPointerInfo,
  Transform,
  UiCanvasInformation
} from '@dcl/sdk/ecs'
import { type Quaternion, type Vector3 } from '@dcl/sdk/math'
import { isHosted } from '../hosted'
import { screenPxToWorldDir, worldToScreenPx } from './perspective-to-screen'

// `~system/Runtime` doesn't ship `getCameraFov` in its bundled types; the op is
// added by bevy-explorer (mirroring `getWorldTime`). Augment the module so we
// can import it with proper typing.
declare module '~system/Runtime' {
  export function getCameraFov(): Promise<number>
}

// FOV is pushed via `GlobalCrdtState` whenever it changes and at least every
// two seconds. We cache the latest value here and refresh on a slow timer; the
// op is async, so we can't read it synchronously in the render path. Stale
// readings are bounded by the bevy-side push cadence.
let cachedFovY: number | null = null

async function refreshCameraFov(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- deferred so an explorer build without the getCameraFov op fails soft inside this try/catch
    const { getCameraFov } = await import('~system/Runtime')
    const fov = await getCameraFov()
    if (Number.isFinite(fov) && fov > 0) {
      cachedFovY = fov
    }
  } catch (err) {
    console.error('failed to read camera fov', err)
  }
}

let started = false
export function startCameraProjection(): void {
  if (started) return
  started = true
  // Initial fetch + periodic refresh. Bevy already sends every two seconds on
  // its side; this keeps our cache aligned even if a push was missed.
  executeTask(async () => {
    await refreshCameraFov()
  })
  let elapsed = 0
  engine.addSystem((dt: number) => {
    elapsed += dt
    if (elapsed >= 1.5) {
      elapsed = 0
      void refreshCameraFov()
    }
  })
}

// Cached vertical FOV (radians), or null until the first fetch resolves.
export function cameraFovY(): number | null {
  return cachedFovY
}

/**
 * Project a world-space point to viewport pixel coords using the cached
 * player camera FOV plus the live `engine.CameraEntity` transform. Returns:
 *
 * - in-front + on-viewport: `onScreen: true`, `left`/`top` inside the rect.
 * - in-front + off-viewport: `onScreen: false`, `left`/`top` clamped to rect.
 * - behind camera: `behind: true`, `left`/`top` placed on the rect edge in
 *   the camera-space xy direction (a "pointer over there" indicator).
 *
 * Returns `null` until the FOV cache is populated (first frames after load),
 * or when the canvas has no size yet.
 */
export function projectWorldToScreen(
  world: Vector3
): { left: number; top: number; onScreen: boolean; behind: boolean } | null {
  if (cachedFovY === null) return null
  const camT = Transform.getOrNull(engine.CameraEntity)
  if (camT === null) return null
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (canvas === null || canvas.width <= 0 || canvas.height <= 0) return null

  return worldToScreenPx(
    world,
    camT.position,
    camT.rotation as Quaternion,
    cachedFovY,
    canvas.width,
    canvas.height,
    { boundOutOfScreen: true }
  )
}

let pointerSpace: { width: number; height: number } | null = null

export function setPointerSpace(size: { width: number; height: number }): void {
  pointerSpace = size.width > 0 && size.height > 0 ? size : null
}

// The pointer in canvas pixels, the space the overlays and projections use. Hosted, the
// engine reports the pointer in the page's CSS pixels while its canvas can be larger.
export function pointerCanvasPx(): { x: number; y: number } | null {
  const at = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenCoordinates
  if (at === undefined) return null
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (pointerSpace === null || canvas === null || canvas.width <= 0 || canvas.height <= 0) return { x: at.x, y: at.y }
  return { x: (at.x * canvas.width) / pointerSpace.width, y: (at.y * canvas.height) / pointerSpace.height }
}

// The ray under the pointer. Hosted, the engine's worldRayDirection comes from that same
// mismatched pointer, so the ray is unprojected through the camera the gizmo is drawn with.
export function pointerWorldRay(): { origin: Vector3; dir: Vector3 } | null {
  const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const camT = Transform.getOrNull(engine.CameraEntity)
  if (p === null || camT === null) return null
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const at = pointerCanvasPx()
  if (isHosted() && cachedFovY !== null && at !== null && canvas !== null && canvas.width > 0 && canvas.height > 0) {
    return { origin: camT.position, dir: screenPxToWorldDir(at.x, at.y, camT.rotation as Quaternion, cachedFovY, canvas.width, canvas.height) }
  }
  if (p.worldRayDirection === undefined) return null
  return { origin: camT.position, dir: p.worldRayDirection as Vector3 }
}
