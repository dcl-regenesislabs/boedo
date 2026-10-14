import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWalletImages, makeThumbnail } from './thumbnail.ts'
import { createUsageMeter } from './usage.ts'
import type { ImageProvider } from './images.ts'
import type { BrowserCall } from './types.ts'

const wallet = '0x0000000000000000000000000000000000000001'
const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

const args = {
  brief: 'A frantic rooftop chase at dusk', title: 'Roof Runner', style: 'comic',
  shots: [{ from: { x: 8, y: 20, z: -10 }, lookAt: { x: 8, y: 0, z: 8 } }], preview: true
}

function browser(): { call: BrowserCall; calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = []
  const call: BrowserCall = async (tool, input) => {
    calls.push([tool, input])
    if (tool === 'view') return JSON.stringify({ mimeType: 'image/jpeg', image: 'VIEW', width: 1024, height: 576 })
    return JSON.stringify({ path: 'assets/images/thumbnail.jpg', width: 1920, height: 1080, bytes: 1234, preview: { mimeType: 'image/jpeg', image: 'SMALL' } })
  }
  return { call, calls }
}

describe('make_thumbnail', () => {
  it('says it is unavailable without an image model, before touching the scene', async () => {
    const { call, calls } = browser()
    const result = await makeThumbnail(args, call, createWalletImages(undefined, undefined, 10))
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('not set up') }])
    expect(calls).toEqual([])
  })

  it('paints from the scene views, saves in the browser, and stops at the daily cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcl-images-'))
    directories.push(dir)
    const generate = vi.fn<ImageProvider['generate']>(async () => ({ mimeType: 'image/jpeg', data: '/9j/IMAGE' }))
    const images = createWalletImages({ generate }, createUsageMeter(dir, { daily: 1, weekly: 7 }).forWallet(wallet), 1)
    const { call, calls } = browser()

    const made = await makeThumbnail(args, call, images)
    const [request] = generate.mock.calls[0]
    expect(request.references).toEqual([{ mimeType: 'image/jpeg', data: 'VIEW' }])
    expect(request.prompt).toContain('"Roof Runner"')
    expect(request.prompt).toContain('central square')
    expect(calls.map(([tool]) => tool)).toEqual(['view', 'scene_request'])
    expect(calls[1][1].request).toMatchObject({ type: 'saveThumbnail', image: '/9j/IMAGE', mimeType: 'image/jpeg', preview: true })
    expect(made.content[0]).toEqual({ type: 'image', mimeType: 'image/jpeg', data: 'SMALL' })
    expect(JSON.stringify(made.content)).not.toContain('/9j/IMAGE')

    const capped = await makeThumbnail(args, call, images)
    expect(capped.content).toEqual([{ type: 'text', text: expect.stringContaining("today's 1 thumbnail") }])
    expect(generate).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
  })
})
