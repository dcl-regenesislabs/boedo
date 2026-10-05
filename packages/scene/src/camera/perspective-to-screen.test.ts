import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { screenPxToWorldDir, worldToScreenPx } from './perspective-to-screen'

describe('screenPxToWorldDir', () => {
  it('casts the ray through the pixel a world point is drawn at', () => {
    const cam = Vector3.create(16, 1.6, 10.4)
    const rot = Quaternion.fromEulerDegrees(12, -20, 0)
    const target = Vector3.create(15.2, 0.54, 18.1)
    const fov = Math.PI / 3
    const px = worldToScreenPx(target, cam, rot, fov, 1280, 720)
    const dir = screenPxToWorldDir(px.left, px.top, rot, fov, 1280, 720)
    const toTarget = Vector3.normalize(Vector3.subtract(target, cam))
    expect(Vector3.dot(dir, toTarget)).toBeCloseTo(1, 6)
  })
})
