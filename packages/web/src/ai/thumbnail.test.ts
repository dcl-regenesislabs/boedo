import { describe, expect, it, vi } from 'vitest'
import { saveThumbnail, type Crop, type OpenPicture } from './thumbnail'
import { applyAssistantSettings, type RawSceneJson } from '../shell/scene-json'

describe('saveThumbnail', () => {
  it('saves the painting as a 1920×1080 jpg under 1 MB and points scene.json at it', async () => {
    const encodes: Array<[Crop, number, number, number]> = []
    const open = vi.fn<OpenPicture>(async () => ({
      width: 1536, height: 1024,
      // the first quality is over Worlds' 1 MB thumbnail limit
      jpeg: async (crop, width, height, quality) => {
        encodes.push([crop, width, height, quality])
        return new Uint8Array(quality > 0.85 ? 1_200_000 : 700_000)
      },
      close: () => {}
    }))
    const files = new Map<string, Uint8Array>()
    let scene: RawSceneJson = { display: { title: 'Roof Runner' }, scene: { parcels: ['0,0'], base: '0,0' } }

    const saved = await saveThumbnail({ image: btoa('painted'), mimeType: 'image/png' }, {
      open,
      save: async (path, bytes) => { files.set(path, bytes) },
      setThumbnail: async (path) => { scene = applyAssistantSettings(scene, { thumbnailPath: path }) }
    }, new AbortController().signal)

    expect(open.mock.calls[0][1]).toBe('image/png')
    expect(encodes).toEqual([
      [{ sx: 0, sy: 80, sw: 1536, sh: 864 }, 1920, 1080, 0.88],
      [{ sx: 0, sy: 80, sw: 1536, sh: 864 }, 1920, 1080, 0.8]
    ])
    expect(saved).toEqual({ path: 'assets/images/thumbnail.jpg', width: 1920, height: 1080, bytes: 700_000 })
    expect(files.get('assets/images/thumbnail.jpg')?.length).toBe(700_000)
    expect(scene.display).toEqual({ title: 'Roof Runner', navmapThumbnail: 'assets/images/thumbnail.jpg' })
  })

  it('refuses anything that is not an image model picture', async () => {
    const save = vi.fn()
    await expect(saveThumbnail({ image: 'not base64!', mimeType: 'image/png' }, { save, setThumbnail: vi.fn() }, new AbortController().signal))
      .rejects.toThrow('saveThumbnail')
    expect(save).not.toHaveBeenCalled()
  })
})
