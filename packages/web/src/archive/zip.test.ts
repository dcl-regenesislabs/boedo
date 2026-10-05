import { describe, expect, it } from 'vitest'
import { readZip, writeZip } from './zip'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('zip', () => {
  it('reads back what it wrote, compressible or not, with non-ASCII names', async () => {
    const random = crypto.getRandomValues(new Uint8Array(4096))
    const files: Array<[string, Uint8Array]> = [
      ['scene.json', text('{"main":"bin/index.js"}')],
      ['src/índice.ts', text('export {}\n'.repeat(500))],
      ['assets/noise.bin', random],
      ['empty.txt', new Uint8Array()]
    ]
    const zip = await writeZip(files)
    expect(zip.length).toBeLessThan(files.reduce((sum, [, bytes]) => sum + bytes.length, 0))
    const entries = readZip(zip)
    expect(entries.map((entry) => entry.path)).toEqual(files.map(([name]) => name))
    for (const [index, entry] of entries.entries()) expect(await entry.read()).toEqual(files[index][1])
  })

  it('refuses a zip whose central directory points two files at the same bytes', async () => {
    const zip = await writeZip([
      ['a.txt', text('a'.repeat(1000))],
      ['b.txt', text('b'.repeat(1000))]
    ])
    const view = new DataView(zip.buffer)
    let second = -1
    for (let at = zip.length - 22, seen = 0; at >= 0; at--) {
      if (view.getUint32(at, true) === 0x02014b50 && ++seen === 1) second = at
    }
    view.setUint32(second + 42, 0, true)
    expect(() => readZip(zip)).toThrow('share the same bytes')
  })

  it('refuses bytes that are not a zip', () => {
    expect(() => readZip(text('not a zip at all, just some text'))).toThrow('not a .zip file')
  })
})
