import { describe, it, expect, vi } from 'vitest'

const sent = vi.fn<(entityId: string, name: string, json: string) => Promise<string>>(() => Promise.resolve(''))

vi.mock('./cmd', () => ({
  cmd: {
    setComponent: (entityId: string, name: string, json: string) => sent(entityId, name, json),
    componentDefault: () => Promise.resolve(JSON.stringify({ material: null, gltf: null }))
  }
}))

import { addComponent, writeComponent } from './inspector'
import { state } from './state'

describe('writing a Material', () => {
  it('never sends a state the engine cannot finish rendering', async () => {
    state.snapshot = { '512': {} }
    const empty = { tex: { texture: { src: '' } } }
    await writeComponent('512', 'Material', JSON.stringify({
      material: { pbr: { albedoColor: { r: 0, g: 1, b: 0, a: 255 }, texture: empty, emissiveTexture: {}, bumpTexture: { tex: { texture: { src: 'images/bump.png' } } } } },
      gltf: { gltfSrc: '', name: '' }
    }))
    expect(JSON.parse(sent.mock.lastCall![2])).toEqual({
      material: { pbr: { albedoColor: { r: 0, g: 1, b: 0, a: 1 }, bumpTexture: { tex: { texture: { src: 'images/bump.png' } } } } }
    })
    expect(state.snapshot['512'].Material).toEqual(JSON.parse(sent.mock.lastCall![2]))
  })

  it('starts a new Material as the lit one the engine shows', async () => {
    state.snapshot = { '513': {} }
    void addComponent('513', 'Material')
    await vi.waitFor(() => expect(sent.mock.lastCall?.[0]).toBe('513'))
    expect(JSON.parse(sent.mock.lastCall![2]).material).toEqual({ pbr: {} })
  })
})
