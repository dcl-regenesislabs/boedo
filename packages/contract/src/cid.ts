// The Decentraland content hash (@dcl/hashing hashV1) on WebCrypto: a raw sha2-256 CIDv1 up to
// one 256 KiB chunk, and the root of a balanced UnixFS dag-pb tree over raw leaves above that.

const CHUNK = 262144
const FANOUT = 174
const RAW = 0x55
const DAG_PB = 0x70
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export const HASH = /^baf(krei|ybei)[a-z2-7]{52}$/

interface Node {
  cid: Uint8Array
  /** Bytes of the whole subtree as stored, which a link carries as Tsize. */
  tsize: number
  fileSize: number
}

function base32(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

async function cid(codec: number, bytes: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  const out = new Uint8Array(36)
  out.set([1, codec, 0x12, 0x20])
  out.set(digest, 4)
  return out
}

function varint(n: number): number[] {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80)
    n = Math.floor(n / 0x80)
  }
  out.push(n)
  return out
}

function encodeParent(children: Node[]): Uint8Array {
  const out: number[] = []
  const data = [0x08, 0x02, 0x18, ...varint(children.reduce((sum, c) => sum + c.fileSize, 0))]
  for (const child of children) {
    const link = [0x0a, child.cid.length, ...child.cid, 0x12, 0x00, 0x18, ...varint(child.tsize)]
    out.push(0x12, ...varint(link.length), ...link)
    data.push(0x20, ...varint(child.fileSize))
  }
  out.push(0x0a, ...varint(data.length), ...data)
  return Uint8Array.from(out)
}

function text(cidBytes: Uint8Array): string {
  return `b${base32(cidBytes)}`
}

/** The CIDv1 of the bytes as one raw block, whatever their size. */
export async function rawCid(bytes: Uint8Array): Promise<string> {
  return text(await cid(RAW, bytes))
}

/** What `@dcl/hashing`'s `hashV1` answers for the same bytes. */
export async function contentCid(bytes: Uint8Array): Promise<string> {
  if (bytes.length <= CHUNK) return rawCid(bytes)
  let level: Node[] = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const chunk = bytes.subarray(offset, offset + CHUNK)
    level.push({ cid: await cid(RAW, chunk), tsize: chunk.length, fileSize: chunk.length })
  }
  do {
    const parents: Node[] = []
    for (let i = 0; i < level.length; i += FANOUT) {
      const children = level.slice(i, i + FANOUT)
      const encoded = encodeParent(children)
      parents.push({
        cid: await cid(DAG_PB, encoded),
        tsize: encoded.length + children.reduce((sum, c) => sum + c.tsize, 0),
        fileSize: children.reduce((sum, c) => sum + c.fileSize, 0)
      })
    }
    level = parents
  } while (level.length > 1)
  return text(level[0].cid)
}

/** True when `hash` names exactly these bytes: the content hash, or the raw CID of the whole body. */
export async function matchesHash(bytes: Uint8Array, hash: string): Promise<boolean> {
  if (hash.startsWith('bafkrei')) return (await rawCid(bytes)) === hash
  return bytes.length > CHUNK && (await contentCid(bytes)) === hash
}
