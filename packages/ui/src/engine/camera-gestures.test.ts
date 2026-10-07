// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCameraGestures } from './camera-gestures'

const sent = vi.hoisted((): unknown[] => [])
const camera = vi.hoisted(() => ({ camMode: 'target' as 'none' | 'free' | 'target' }))
vi.mock('./bus', () => ({ sendToScene: async (msg: unknown) => { sent.push(msg) } }))
vi.mock('@scene/state', () => ({ state: camera }))

function wheel(init: WheelEventInit & { notch?: number }): void {
  const e = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init })
  if (init.notch !== undefined) Object.defineProperty(e, 'wheelDeltaY', { value: init.notch })
  // happy-dom drops modifier keys from a WheelEvent's init
  Object.defineProperty(e, 'ctrlKey', { value: init.ctrlKey === true })
  Object.defineProperty(e, 'shiftKey', { value: init.shiftKey === true })
  window.dispatchEvent(e)
}
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
const gesture = (g: Partial<Record<'orbitX' | 'orbitY' | 'panX' | 'panY' | 'zoom', number>>) =>
  ({ type: 'camera-gesture', orbitX: 0, orbitY: 0, panX: 0, panY: 0, zoom: 0, ...g })

describe('camera gestures over the viewport', () => {
  let uninstall = (): void => {}
  afterEach(() => { uninstall(); sent.length = 0 })

  it('zooms on a pinch or a vertical scroll, orbits sideways, pans with Shift, flies forward on a scroll held to its axis, and leaves the player camera alone', async () => {
    uninstall = installCameraGestures(() => true)
    camera.camMode = 'target'

    wheel({ deltaY: -2.5, ctrlKey: true })
    await frame()
    wheel({ deltaX: 3.2, deltaY: -1.5 })
    await frame()
    wheel({ deltaX: 3.2, deltaY: -1.5, shiftKey: true })
    await frame()
    wheel({ deltaY: 100, notch: -120 })
    await frame()
    camera.camMode = 'free'
    wheel({ deltaY: -100, notch: 120 })
    await frame()
    await new Promise((resolve) => setTimeout(resolve, 200))
    wheel({ deltaX: 0.5, deltaY: 4 })
    wheel({ deltaX: 3, deltaY: 2 })
    await frame()
    await new Promise((resolve) => setTimeout(resolve, 200))
    wheel({ deltaX: 10, deltaY: 1, shiftKey: true })
    await frame()
    camera.camMode = 'none'
    wheel({ deltaX: 3, deltaY: 3 })
    await frame()

    expect(sent).toEqual([
      gesture({ zoom: 10 }),
      gesture({ orbitX: -3.2 }),
      gesture({ panX: -3.2 }),
      gesture({ zoom: -100 }),
      { type: 'fly-speed', factor: 1.1 },
      gesture({ zoom: -6 }),
      gesture({ orbitX: -4 })
    ])
  })
})
