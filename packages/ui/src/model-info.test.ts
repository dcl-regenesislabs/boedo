import { describe, expect, it } from 'vitest'
import { inspectModel } from './model-info'

function model(extra: Record<string, unknown> = {}) {
  return new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [0, 0, 0], max: [1, 2, 3], count: 36 }], ...extra
  }))
}

describe('model inspection for assistant placement', () => {
  it('uses the chosen scene, nested transforms and the Bevy SDK coordinate conversion', () => {
    const info = inspectModel(model({
      scenes: [{ nodes: [0] }, { nodes: [2] }],
      nodes: [{ translation: [4, 1, 2], scale: [2, 3, 4], children: [1] }, { mesh: 0, translation: [1, 0, 0] }, { mesh: 0, scale: [100, 100, 100] }]
    }))
    expect(info.bounds).toEqual({ min: { x: -8, y: 1, z: 2 }, max: { x: -6, y: 7, z: 14 }, size: { x: 2, y: 6, z: 12 } })
    expect(info.triangles).toBe(12)
  })

  it('transforms all eight corners for rotation and negative scales', () => {
    const info = inspectModel(model({ nodes: [{ mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [-2, 1, 1] }] }))
    expect(info.bounds?.min.x).toBeCloseTo(-3)
    expect(info.bounds?.max.x).toBeCloseTo(0)
    expect(info.bounds?.min.z).toBeCloseTo(0)
    expect(info.bounds?.max.z).toBeCloseTo(2)
  })

  it('reads matrix transforms, collider names and their triangles outside the bounds, dependencies and exact animation names', () => {
    const info = inspectModel(model({
      nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1], children: [1], skin: 0 }, { name: 'wall_collider', mesh: 0, scale: [50, 50, 50] }],
      images: [{ uri: 'textures/paint.png' }, { uri: 'data:image/png;base64,AA==' }],
      animations: [{ name: 'Armature|Walk' }], materials: [{ name: 'wood' }]
    }))
    expect(info.bounds?.min).toEqual({ x: -4, y: 4, z: 5 })
    expect(info.colliderNodes).toEqual(['wall_collider'])
    expect([info.triangles, info.primitives]).toEqual([24, 2])
    expect(info.externalResources).toEqual(['textures/paint.png'])
    expect(info.animations).toEqual(['Armature|Walk'])
    expect(info.warnings.join(' ')).toContain('rest pose')
  })

  it('returns unknown bounds instead of making up the size of an incomplete model', () => {
    expect(inspectModel(model({ accessors: [{ count: 3 }] })).bounds).toBeNull()
    expect(inspectModel(model({ nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: {} } }] })).bounds).toBeNull()
  })

  it('rejects cyclic hierarchies and malformed model data', () => {
    expect(() => inspectModel(model({ nodes: [{ children: [0] }] }))).toThrow('hierarchy')
    expect(() => inspectModel(model({ nodes: [{ mesh: 99 }] }))).toThrow('index')
    expect(() => inspectModel(new Uint8Array([0x67, 0x6c, 0x54, 0x46]))).toThrow('header')
  })
})

describe('embedded texture sizes', () => {
  it('reads the largest side from the image headers inside a GLB, and the sides DCL would not take', () => {
    const png = new Uint8Array(24)
    const p = new DataView(png.buffer)
    p.setUint32(0, 0x89504e47); p.setUint32(16, 1024); p.setUint32(20, 256)
    // a JPEG with one APP0 segment, then a baseline start-of-frame of 300 wide by 600 high
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x01, 0x2c, 0x03, 0, 0, 0, 0])
    const bin = new Uint8Array(png.length + jpeg.length + 2)
    bin.set(png); bin.set(jpeg, png.length)
    const json = new TextEncoder().encode(JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }, { buffer: 0, byteOffset: png.length, byteLength: jpeg.length }],
      images: [{ bufferView: 0, mimeType: 'image/png' }, { bufferView: 1, mimeType: 'image/jpeg' }]
    }))
    const jsonChunk = new Uint8Array((json.length + 3) & ~3).fill(0x20)
    jsonChunk.set(json)
    const glb = new Uint8Array(28 + jsonChunk.length + bin.length)
    const w = new DataView(glb.buffer)
    w.setUint32(0, 0x46546c67, true); w.setUint32(4, 2, true); w.setUint32(8, glb.length, true)
    w.setUint32(12, jsonChunk.length, true); w.setUint32(16, 0x4e4f534a, true); glb.set(jsonChunk, 20)
    w.setUint32(20 + jsonChunk.length, bin.length, true); w.setUint32(24 + jsonChunk.length, 0x004e4942, true)
    glb.set(bin, 28 + jsonChunk.length)
    expect(inspectModel(glb).largestImage).toBe(1024)
    expect(inspectModel(glb).textureProblems).toEqual(['300x600 is not a power of two'])
    // the JPEG made 2048 high: now it is the largest
    glb.set([0x08, 0x00], 28 + jsonChunk.length + png.length + 13)
    expect(inspectModel(glb).largestImage).toBe(2048)
    glb.set([0x01, 0x00], 28 + jsonChunk.length + png.length + 15)
    expect(inspectModel(glb).textureProblems).toEqual(['256x2048 is over 1024'])
  })
})
