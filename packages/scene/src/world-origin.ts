import { type Snapshot } from './state'

// The world frame hangs off the scene's WORLD_ORIGIN (entity 5). Engines since
// bevy-explorer #1093 no longer seed it, so it is rebuilt from the scene's base parcel.
let baseCorner: { x: number; z: number } | null = null

export function setSceneBaseCorner(corner: { x: number; z: number } | null): void {
  baseCorner = corner
}

export function withWorldOrigin(snapshot: Snapshot): Snapshot {
  if ('5' in snapshot || baseCorner === null) return snapshot
  snapshot['5'] = {
    Transform: {
      position: { x: -baseCorner.x, y: 0, z: -baseCorner.z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      parent: 0
    }
  }
  return snapshot
}
