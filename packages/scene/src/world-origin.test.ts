import { afterEach, describe, it, expect } from 'vitest'
import { worldTransformOf, rootLocalForWorld } from './world-pos'
import { setSceneBaseCorner, withWorldOrigin } from './world-origin'
import type { Snapshot } from './state'

afterEach(() => setSceneBaseCorner(null))

describe('a snapshot from an engine that no longer seeds WORLD_ORIGIN', () => {
  it('resolves world positions against the base parcel the page names', () => {
    // base parcel 4,-2: scene-local 8,0,8 is world 72,0,-24
    setSceneBaseCorner({ x: 64, z: -32 })
    const snapshot = withWorldOrigin({ '512': { Transform: { position: { x: 8, y: 0, z: 8 } } } } as Snapshot)
    expect(worldTransformOf(snapshot, '512')?.position).toEqual({ x: 72, y: 0, z: -24 })
    expect(rootLocalForWorld(snapshot, { x: 70, y: 0, z: -20 })).toEqual({ x: 6, y: 0, z: 12 })
  })

  it('keeps an origin the engine did send', () => {
    setSceneBaseCorner({ x: 64, z: -32 })
    const sent = { '5': { Transform: { position: { x: 0, y: 0, z: 0 } } } }
    expect(withWorldOrigin({ ...sent } as Snapshot)['5']).toBe(sent['5'])
  })
})
