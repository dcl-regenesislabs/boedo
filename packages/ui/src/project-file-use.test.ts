import { beforeEach, describe, expect, it, vi } from 'vitest'

const { files, removed, texts, bytes, tick } = vi.hoisted(() => ({
  files: [] as string[], removed: [] as string[][], texts: new Map<string, string>(), bytes: new Map<string, Uint8Array>(), tick: { n: 0 }
}))
vi.mock('./engine/datalayer', () => ({
  dataLayerListFiles: async () => files,
  dataLayerReadFile: async (path: string) => texts.get(path) ?? '',
  dataLayerReadFileBytes: async (path: string) => {
    const found = bytes.get(path)
    if (found === undefined) throw new Error('no such file')
    return found
  },
  dataLayerRealm: () => 'project',
  dataLayerPathTick: () => tick.n,
  dataLayerRemoveFiles: async (paths: string[]) => { removed.push(paths); return [] }
}))
import { state } from '@scene/state'
import { deleteProjectFile, fileUsers, olderBuilds, unusedModelFiles } from './project-file-use'

// a model pointing at image files beside it
const pointingAt = (...uris: string[]): Uint8Array => new TextEncoder().encode(JSON.stringify({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], images: uris.map((uri) => ({ uri }))
}))

beforeEach(() => { files.length = 0; removed.length = 0; bytes.clear(); texts.clear(); tick.n++ })

describe('deleting a project file', () => {

  it('takes a built model\'s script along only when no other build of it is left', async () => {
    files.push('models/barrel-da3fa86b.glb', 'models/barrel-0011aabb.glb', 'models/src/barrel.js')
    await deleteProjectFile('models/barrel-da3fa86b.glb')
    files.splice(0, 1)
    await deleteProjectFile('models/barrel-0011aabb.glb')
    expect(removed).toEqual([['models/barrel-da3fa86b.glb'], ['models/barrel-0011aabb.glb', 'models/src/barrel.js']])
  })

  it('names the entities that play a sound file as its users', async () => {
    state.snapshot = { '512': { AudioSource: { audioClipUrl: 'assets/audio/coin.mp3' } }, '513': { AudioStream: { url: 'assets/audio/coin.mp3' } }, '514': { AudioSource: { audioClipUrl: 'assets/audio/jump.mp3' } } }
    expect((await fileUsers('assets/audio/coin.mp3')).entities).toEqual(['#512', '#513'])
  })

  it('leaves scripts alone when the file is not a built model', async () => {
    files.push('models/barrel.glb', 'models/src/barrel.js')
    await deleteProjectFile('models/barrel.glb')
    expect(removed).toEqual([['models/barrel.glb']])
  })
})

describe('model files nothing uses', () => {
  it('flags an orphan, but not an older build of a model in the scene or a model a script names', async () => {
    files.length = 0
    files.push('models/tower-11111111.glb', 'models/tower-22222222.glb', 'models/rock.glb', 'models/sign.glb', 'src/index.ts')
    texts.set('src/index.ts', "GltfContainer.create(e, { src: 'models/sign.glb' })")
    state.snapshot = { '512': { GltfContainer: { src: 'models/tower-22222222.glb' } } }
    expect(await unusedModelFiles()).toEqual(['models/rock.glb'])
    expect(await olderBuilds()).toEqual(['models/tower-11111111.glb'])
  })
})

describe('shared material images nothing uses', () => {
  it('flags an image no model on disk points at, keeping one an older build or a Material still uses', async () => {
    files.push('models/tower-11111111.glb', 'models/tower-22222222.glb',
      'models/materials/T_Stone_D.jpg', 'models/materials/T_Brick_D.jpg', 'models/materials/T_Sand_D.jpg', 'models/materials/T_Gravel_D.jpg')
    bytes.set('models/tower-11111111.glb', pointingAt('materials/T_Stone_D.jpg'))
    bytes.set('models/tower-22222222.glb', pointingAt('./materials/T_Brick_D.jpg'))
    state.snapshot = {
      '512': { GltfContainer: { src: 'models/tower-22222222.glb' } },
      '513': { Material: { material: { pbr: { texture: { tex: { texture: { src: 'models/materials/T_Sand_D.jpg' } } } } } } }
    }
    expect(await unusedModelFiles()).toEqual(['models/materials/T_Gravel_D.jpg'])
  })

  it('go with the last model that points at them', async () => {
    files.push('models/rock.glb', 'models/wall.glb', 'models/materials/T_Stone_D.jpg', 'models/materials/T_Moss_D.jpg')
    bytes.set('models/rock.glb', pointingAt('materials/T_Stone_D.jpg', 'materials/T_Moss_D.jpg'))
    bytes.set('models/wall.glb', pointingAt('materials/T_Stone_D.jpg'))
    state.snapshot = {}
    await deleteProjectFile('models/rock.glb')
    expect(removed).toEqual([['models/rock.glb', 'models/materials/T_Moss_D.jpg']])
  })
})
