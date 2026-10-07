import { describe, expect, it, vi } from 'vitest'
import { createEntities } from '@scene/inspector'
import { importFiles } from './assets'

const saved = vi.hoisted((): string[] => [])
vi.mock('./engine/datalayer', () => ({
  dataLayerAvailable: () => true,
  dataLayerListFiles: async () => ['assets/images/brick.png'],
  dataLayerSaveFileBytes: async (path: string) => { saved.push(path) }
}))
vi.mock('./engine/cmd', () => ({ cmd: {} }))
vi.mock('./engine/bus', () => ({ sceneRpc: async () => null }))
vi.mock('@scene/inspector', () => ({ createEntities: vi.fn(async () => []) }))
vi.mock('@scene/state', () => ({ state: {}, setSelected: () => {} }))
vi.mock('./panels/reveal', () => ({ revealInTree: () => {} }))
vi.mock('@scene/custom-components', () => ({ NAME_COMPONENT: 'core-schema::Name' }))

describe('importing files', () => {
  it('adds images, sounds, videos and data files without a model, never over an existing file, and says what it left out', async () => {
    const big = new File([new Uint8Array(1)], 'huge.png')
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 })
    const result = await importFiles(
      [new File(['x'], 'Brick.png'), new File(['{}'], 'manifest.json'), new File(['x'], 'Door Creak.mp3'), new File(['x'], 'intro.mp4'), new File(['x'], 'song.flac'), big],
      { x: 8, y: 0, z: 8 }
    )

    expect(result.placed).toBeNull()
    const added = ['assets/images/brick-2.png', 'assets/data/manifest.json', 'assets/audio/door-creak.mp3', 'assets/video/intro.mp4']
    expect(result.added).toEqual(added)
    expect(saved).toEqual(added)
    expect(result.skipped).toEqual(['huge.png (over 50 MB, which Worlds refuse)', 'song.flac (not a model, image, sound, video or data file)'])
    expect(createEntities).not.toHaveBeenCalled()
  })
})
