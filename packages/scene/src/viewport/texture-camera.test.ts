import { describe, expect, it } from 'vitest'
import { textureCameraPatch } from './texture-camera'

const cam = { width: 2048, height: 1152, mode: { $case: 'perspective' as const, perspective: { fieldOfView: Math.PI / 3 } } }

describe('textureCameraPatch', () => {
  it('asks for no write while the camera already matches', () => {
    expect(textureCameraPatch(cam, Math.PI / 3, { width: 2048, height: 1152 })).toBeNull()
    expect(textureCameraPatch(cam, null, null)).toBeNull()
  })

  it('names only what changed', () => {
    expect(textureCameraPatch(cam, Math.PI / 4, { width: 2048, height: 1152 })).toEqual({ fieldOfView: Math.PI / 4 })
    expect(textureCameraPatch(cam, Math.PI / 3, { width: 1600, height: 900 })).toEqual({ width: 1600, height: 900 })
  })
})
