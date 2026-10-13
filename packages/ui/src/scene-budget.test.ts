import { beforeEach, describe, expect, it, vi } from 'vitest'

const { files, tick } = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), tick: { n: 0 } }))
vi.mock('./engine/datalayer', () => ({
  dataLayerReadFileBytes: async (path: string) => {
    const bytes = files.get(path)
    if (bytes === undefined) throw new Error('no such file')
    return bytes
  },
  dataLayerRealm: () => 'project',
  dataLayerPathTick: () => tick.n
}))
import { state } from '@scene/state'
import { sceneBudget, sceneModels, sceneTextures } from './scene-budget'

const model = (count: number, extra: Record<string, unknown> = {}): Uint8Array => new TextEncoder().encode(JSON.stringify({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min: [0, 0, 0], max: [1, 1, 1], count }], ...extra
}))
const texture = (src: string) => ({ tex: { texture: { src } } })

describe('scene budget over the project files', () => {
  beforeEach(() => {
    files.clear()
    tick.n++
    state.snapshot = { '512': { GltfContainer: { src: 'models/tree.glb' } }, '513': { GltfContainer: { src: 'models/broken.glb' } } }
  })

  it('reports a model it cannot read as missing instead of failing, and counts it once it is fixed', async () => {
    files.set('models/tree.glb', model(30))
    files.set('models/broken.glb', new TextEncoder().encode('not a model'))
    expect((await sceneBudget()).used.triangles).toBe(10)
    expect((await sceneModels()).find((m) => m.src === 'models/broken.glb')?.warnings[0]).toMatch(/missing or not a readable model/)
    files.set('models/broken.glb', model(60))
    tick.n++
    expect((await sceneBudget()).used.triangles).toBe(30)
  })

  it('counts a replaced file again after a write', async () => {
    files.set('models/tree.glb', model(30))
    files.set('models/broken.glb', model(3))
    expect((await sceneBudget()).used.triangles).toBe(11)
    files.set('models/tree.glb', model(300))
    tick.n++
    expect((await sceneBudget()).used.triangles).toBe(101)
  })

  it('counts a Material\'s image files with the models\' shared ones, each file once, and no video texture', async () => {
    files.set('models/tree.glb', model(3, { images: [{ uri: 'materials/T_Bark_D.jpg' }] }))
    state.snapshot = {
      '512': { GltfContainer: { src: 'models/tree.glb' } },
      '513': { Material: { material: { pbr: { texture: texture('models/materials/T_Bark_D.jpg'), bumpTexture: texture('assets/images/bump.png') } } } },
      '514': { Material: { material: { unlit: { texture: texture('assets/images/bump.png'), alphaTexture: { tex: { videoTexture: { videoPlayerEntity: 512 } } } } } } }
    }
    expect((await sceneBudget()).used.textures).toBe(2)
    expect((await sceneTextures()).used).toBe(2)
  })
})
