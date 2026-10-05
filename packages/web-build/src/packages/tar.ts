// Reads a package tarball (gzip + tar) the way npm unpacks one: the first path
// segment is dropped, links are never created, and no entry may leave the package.

import { plainBytes } from '../preview-ids'

export class TarError extends Error {
  constructor(
    readonly reason: 'too-large' | 'unsafe-path' | 'malformed',
    message: string
  ) {
    super(message)
  }
}

export interface UnpackedTarball {
  // path inside the package -> bytes
  files: Map<string, Uint8Array>
  // links and device entries that were left out
  skipped: string[]
}

const BLOCK = 512
const decoder = new TextDecoder()

export async function gunzip(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([plainBytes(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel()
        throw new TarError('too-large', `unpacks to more than ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof TarError) throw err
    throw new TarError('malformed', 'is not a gzip archive')
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function text(block: Uint8Array, start: number, length: number): string {
  let end = start
  while (end < start + length && block[end] !== 0) end++
  return decoder.decode(block.subarray(start, end))
}

function size(block: Uint8Array): number {
  // GNU base-256 sizes are for files far beyond any limit here
  if ((block[124] & 0x80) !== 0) throw new TarError('too-large', 'holds an entry larger than 8 GB')
  const value = parseInt(text(block, 124, 12).trim() || '0', 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new TarError('malformed', 'has an entry with no valid size')
  return value
}

function checksumHolds(block: Uint8Array): boolean {
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : block[i]
  return sum === parseInt(text(block, 148, 8).trim(), 8)
}

// "<length> <key>=<value>\n" records of a pax header
function paxRecords(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  for (let at = 0; at < data.length; ) {
    let space = at
    while (space < data.length && data[space] !== 32) space++
    const length = Number(decoder.decode(data.subarray(at, space)))
    if (!Number.isSafeInteger(length) || length <= 0) break
    const record = decoder.decode(data.subarray(space + 1, at + length - 1))
    const equals = record.indexOf('=')
    if (equals > 0) out[record.slice(0, equals)] = record.slice(equals + 1)
    at += length
  }
  return out
}

// The path inside the package, or undefined for the package folder itself.
function packagePath(raw: string): string | undefined {
  if (raw.includes('\0')) throw new TarError('unsafe-path', 'has an entry with a NUL in its path')
  const parts = raw.split(/[\\/]/)
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:/.test(raw)) {
    throw new TarError('unsafe-path', `has an entry with an absolute path: ${raw}`)
  }
  if (parts.includes('..')) throw new TarError('unsafe-path', `has an entry that leaves the package: ${raw}`)
  const inside = parts.filter((part) => part !== '' && part !== '.').slice(1)
  return inside.length === 0 ? undefined : inside.join('/')
}

export function readTar(tar: Uint8Array): UnpackedTarball {
  const files = new Map<string, Uint8Array>()
  const skipped: string[] = []
  let longName: string | undefined
  let pax: Record<string, string> = {}
  for (let offset = 0; offset + BLOCK <= tar.length; ) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    if (!checksumHolds(header)) throw new TarError('malformed', 'is not a tar archive')
    const type = String.fromCharCode(header[156] || 48)
    const length = pax.size === undefined ? size(header) : Number(pax.size)
    const start = offset + BLOCK
    if (!Number.isSafeInteger(length) || start + length > tar.length) throw new TarError('malformed', 'is cut short')
    const data = tar.subarray(start, start + length)
    offset = start + Math.ceil(length / BLOCK) * BLOCK

    if (type === 'x') {
      pax = paxRecords(data)
      continue
    }
    if (type === 'g') continue
    if (type === 'L') {
      longName = decoder.decode(data).replace(/\0+$/, '')
      continue
    }
    if (type === 'K') continue

    const prefix = text(header, 257, 5) === 'ustar' ? text(header, 345, 155) : ''
    const name = pax.path ?? longName ?? (prefix === '' ? '' : prefix + '/') + text(header, 0, 100)
    longName = undefined
    pax = {}
    const path = packagePath(name)
    if (type === '5' || path === undefined) continue
    if (type !== '0' && type !== '7') {
      skipped.push(path)
      continue
    }
    // a copy: a view would keep the whole archive alive
    files.set(path, data.slice())
  }
  return { files, skipped }
}
