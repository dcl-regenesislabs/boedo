import { describe, expect, it } from 'vitest'
import { externalizeLibraryImages } from './library-glb'

// a GLB with geometry bytes, a library material's two maps and a model-own image, in that order in the BIN
function glb(): ArrayBuffer {
  const geometry = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const maps = new Uint8Array(200).fill(9)
  const ownPng = new Uint8Array([7, 7, 7, 7])
  const bin = new Uint8Array([...geometry, ...maps, ...ownPng])
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 100 }, { buffer: 0, byteOffset: 108, byteLength: 100 },
      { buffer: 0, byteOffset: 208, byteLength: 4 }
    ],
    images: [1, 2, 3].map((bufferView) => ({ bufferView, mimeType: 'image/png' })),
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
    materials: [
      { extras: { library: 'stone-blocks' }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 2 } } }
    ]
  }
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonChunk = new Uint8Array((text.length + 3) & ~3).fill(0x20)
  jsonChunk.set(text)
  const out = new Uint8Array(28 + jsonChunk.length + bin.length)
  const w = new DataView(out.buffer)
  w.setUint32(0, 0x46546c67, true); w.setUint32(4, 2, true); w.setUint32(8, out.length, true)
  w.setUint32(12, jsonChunk.length, true); w.setUint32(16, 0x4e4f534a, true); out.set(jsonChunk, 20)
  w.setUint32(20 + jsonChunk.length, bin.length, true); w.setUint32(24 + jsonChunk.length, 0x004e4942, true)
  out.set(bin, 28 + jsonChunk.length)
  return out.buffer
}

function read(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)))
  const bin = new Uint8Array(buffer, 28 + jsonLength, view.getUint32(20 + jsonLength, true))
  const slice = (i: number) => [...bin.subarray(json.bufferViews[i].byteOffset, json.bufferViews[i].byteOffset + json.bufferViews[i].byteLength)]
  return { json, bin, slice, length: view.getUint32(8, true) }
}

describe('library images leaving a GLB', () => {
  it('points each map of a library material at its shared file, drops their bytes and keeps everything else intact', () => {
    const { glb: out, used } = externalizeLibraryImages(glb())
    const { json, bin, slice, length } = read(out)
    expect(used).toEqual(['stone-blocks'])
    expect(json.images.slice(0, 2).map((image: { uri: string }) => image.uri)).toEqual(['materials/stone-blocks/color.jpg', 'materials/stone-blocks/normal.jpg'])
    expect(slice(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(slice(3)).toEqual([7, 7, 7, 7])
    expect(bin.length).toBe(12)
    expect(json.buffers[0].byteLength).toBe(12)
    expect(length).toBe(out.byteLength)
  })
})
