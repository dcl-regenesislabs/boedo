// The editor cameras stay above the ground (scene y = 0): below it the view goes dark.
export const CAMERA_FLOOR = 0.3

// The lowest pitch (positive looks down) that keeps an orbit eye `distance` from a pivot at
// `pivotY` on or above the floor; `maxPitch` when even that look can't.
export function minOrbitPitch(pivotY: number, distance: number, maxPitch: number): number {
  return Math.asin(Math.max(-1, Math.min(Math.sin(maxPitch), (CAMERA_FLOOR - pivotY) / distance)))
}
