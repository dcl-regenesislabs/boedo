import { beforeEach, describe, expect, it, vi } from 'vitest'

const { files, removed, texts } = vi.hoisted(() => ({ files: [] as string[], removed: [] as string[][], texts: new Map<string, string>() }))
vi.mock('./engine/datalayer', () => ({
  dataLayerListFiles: async () => files,
  dataLayerReadFile: async (path: string) => texts.get(path) ?? '',
  dataLayerWriteTick: () => 0,
  dataLayerRemoveFiles: async (paths: string[]) => { removed.push(paths); return [] }
}))
import { state } from '@scene/state'
import { deleteProjectFile, olderBuilds, unusedModelFiles } from './project-file-use'

describe('deleting a project file', () => {
  beforeEach(() => { files.length = 0; removed.length = 0 })

  it('takes a built model\'s script along only when no other build of it is left', async () => {
    files.push('models/barrel-da3fa86b.glb', 'models/barrel-0011aabb.glb', 'models/src/barrel.js')
    await deleteProjectFile('models/barrel-da3fa86b.glb')
    files.splice(0, 1)
    await deleteProjectFile('models/barrel-0011aabb.glb')
    expect(removed).toEqual([['models/barrel-da3fa86b.glb'], ['models/barrel-0011aabb.glb', 'models/src/barrel.js']])
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
