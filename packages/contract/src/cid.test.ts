import { describe, expect, it } from 'vitest'
import { contentCid } from './cid'

// expected values are what @dcl/hashing's hashV1 answers for the same bytes
describe('content hash', () => {
  it('is the raw CID of one block, and the UnixFS root above 256 KiB', async () => {
    expect(await contentCid(new TextEncoder().encode('hello world'))).toBe(
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    )
    expect(await contentCid(new Uint8Array(300000).fill(7))).toBe(
      'bafybeifkhqdf426lf6kl5oshczyo2ahhhib6zxruehy2yo72ay74kukg3q'
    )
  })
})
