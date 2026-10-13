import { describe, expect, it } from 'vitest'
import { CAMERA_FLOOR, minOrbitPitch } from './ground'

const LIMIT = Math.PI / 2 - 0.01
// the orbit eye sits `distance` back along the look from the pivot: forward.y = -sin(pitch)
const eyeY = (pivotY: number, pitch: number, distance: number): number => pivotY + Math.sin(pitch) * distance

describe('orbit eye above the ground', () => {
  it('tilts only a look that would sink the eye, and keeps it on the floor wherever the pivot is', () => {
    for (const pivotY of [-5, -0.5, 0, 0.3, 1, 8]) {
      for (const distance of [0.5, 2, 10, 60]) {
        for (let pitch = -LIMIT; pitch <= LIMIT; pitch += 0.1) {
          const clamped = Math.max(pitch, minOrbitPitch(pivotY, distance, LIMIT))
          if (eyeY(pivotY, pitch, distance) >= CAMERA_FLOOR) expect(clamped).toBe(pitch)
          if (eyeY(pivotY, LIMIT, distance) >= CAMERA_FLOOR) expect(eyeY(pivotY, clamped, distance)).toBeGreaterThanOrEqual(CAMERA_FLOOR - 1e-9)
          else expect(clamped).toBeCloseTo(LIMIT)
        }
      }
    }
  })
})
