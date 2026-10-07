// Trackpad, wheel and middle-drag over the viewport drive the editor cameras. A two-finger scroll
// up/down zooms, as in the player camera, and so does a pinch; sideways it orbits, with Shift it pans.
// Flying, a scroll only moves forward and back, and Shift + scroll looks around. A mouse wheel zooms in orbit and sets the speed while flying,
// and a middle-drag pans. The scene sees none of these events, so they are read here and sent over
// the bus once a frame.
import { state } from '@scene/state'
import type { CameraGesture } from '@dcl-editor/contract'
import { sendToScene } from './bus'

// A mouse wheel moves in whole notches (wheelDelta a multiple of 120) and never sideways;
// a trackpad scrolls in small, often fractional steps on both axes.
export function isMouseWheel(e: WheelEvent): boolean {
  const notch = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
  if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return true
  return e.deltaX === 0 && notch !== undefined && notch !== 0 && notch % 120 === 0
}

// a pause this long ends a swipe, so the next one picks its own axis
const GESTURE_GAP_MS = 150
// looking around on a swipe, slower than an orbit: a trackpad travels far
const FLY_LOOK = 0.4

type Pending = CameraGesture
const empty = (): Pending => ({ orbitX: 0, orbitY: 0, panX: 0, panY: 0, zoom: 0 })

export function installCameraGestures(onCanvas: (e: Event) => boolean): () => void {
  let pending = empty()
  let frame = 0
  let flySpeedFactor = 1
  const flush = (): void => {
    frame = 0
    const g = pending
    pending = empty()
    if (g.orbitX !== 0 || g.orbitY !== 0 || g.panX !== 0 || g.panY !== 0 || g.zoom !== 0) {
      void sendToScene({ type: 'camera-gesture', ...g })
    }
    if (flySpeedFactor !== 1) {
      void sendToScene({ type: 'fly-speed', factor: flySpeedFactor })
      flySpeedFactor = 1
    }
  }
  const queue = (g: Partial<Pending>): void => {
    pending = {
      orbitX: pending.orbitX + (g.orbitX ?? 0),
      orbitY: pending.orbitY + (g.orbitY ?? 0),
      panX: pending.panX + (g.panX ?? 0),
      panY: pending.panY + (g.panY ?? 0),
      zoom: pending.zoom + (g.zoom ?? 0)
    }
    if (frame === 0) frame = requestAnimationFrame(flush)
  }
  const cameraOn = (): boolean => state.camMode !== 'none'
  let scrollAxis: 'x' | 'y' = 'y'
  let lastScrollAt = 0

  const onWheel = (e: WheelEvent): void => {
    if (!cameraOn() || !onCanvas(e)) return
    // a trackpad pinch arrives as a wheel with ctrlKey; left alone the page would zoom
    e.preventDefault()
    if (e.ctrlKey === true) {
      queue({ zoom: -e.deltaY * 4 })
      return
    }
    if (isMouseWheel(e)) {
      if (state.camMode === 'free') {
        flySpeedFactor *= e.deltaY > 0 ? 0.9 : 1.1
        if (frame === 0) frame = requestAnimationFrame(flush)
      } else queue({ zoom: -e.deltaY })
      return
    }
    // a swipe is never straight: hold the axis it started on until it pauses, or moving forward turns too
    const now = performance.now()
    if (now - lastScrollAt > GESTURE_GAP_MS) scrollAxis = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'x' : 'y'
    lastScrollAt = now
    const dx = scrollAxis === 'x' ? e.deltaX : 0
    const dy = scrollAxis === 'y' ? e.deltaY : 0
    // the view follows the fingers, so a trackpad's deltas are inverted
    if (state.camMode === 'free') {
      // flying, a scroll only moves forward and back, as zoom does in the player camera; Shift looks around
      if (e.shiftKey === true) queue({ orbitX: -dx * FLY_LOOK, orbitY: -dy * FLY_LOOK })
      else queue({ zoom: -dy })
    } else if (e.shiftKey === true) queue({ panX: -dx, panY: -dy })
    else queue({ orbitX: -dx, zoom: -dy })
  }

  // Safari reports a pinch as gesture events, with a running scale
  let lastScale = 1
  const onGestureStart = (e: Event): void => {
    if (!cameraOn() || !onCanvas(e)) return
    e.preventDefault()
    lastScale = 1
  }
  const onGestureChange = (e: Event): void => {
    if (!cameraOn() || !onCanvas(e)) return
    e.preventDefault()
    const scale = (e as Event & { scale?: number }).scale ?? 1
    queue({ zoom: Math.log(scale / lastScale) * 400 })
    lastScale = scale
  }

  let dragging = false
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1 || !cameraOn() || !onCanvas(e)) return
    e.preventDefault()
    dragging = true
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (dragging) queue({ panX: -e.movementX, panY: -e.movementY })
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 1) dragging = false
  }

  const opts = { capture: true, passive: false }
  window.addEventListener('wheel', onWheel, opts)
  window.addEventListener('gesturestart', onGestureStart, opts)
  window.addEventListener('gesturechange', onGestureChange, opts)
  window.addEventListener('pointerdown', onPointerDown, { capture: true })
  window.addEventListener('pointermove', onPointerMove, { capture: true })
  window.addEventListener('pointerup', onPointerUp, { capture: true })
  return () => {
    window.removeEventListener('wheel', onWheel, opts)
    window.removeEventListener('gesturestart', onGestureStart, opts)
    window.removeEventListener('gesturechange', onGestureChange, opts)
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    window.removeEventListener('pointermove', onPointerMove, { capture: true })
    window.removeEventListener('pointerup', onPointerUp, { capture: true })
    if (frame !== 0) cancelAnimationFrame(frame)
  }
}
