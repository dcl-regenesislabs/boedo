// Reading and writing .zip files with the browser's own deflate. Enough of the
// format for a scene project: stored and deflated entries, no encryption, no
// zip64 (4 GiB, 65535 files).
const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const END = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const UTF8 = 0x0800
const ENCRYPTED = 0x0001
const STORED = 0
const DEFLATED = 8
const MAX_32 = 0xffffffff

export interface ZipEntry {
  path: string
  size: number
  // inflates on demand: an entry nobody reads costs nothing
  read(): Promise<Uint8Array>
}

let table: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (table === null) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = MAX_32
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ MAX_32) >>> 0
}

// `limit`: stop a stream that inflates past the size its entry declares
async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  // the streams reject shared memory; these bytes are never backed by it
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(through)
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error('The zip file is damaged: an entry is larger than it says')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function dosTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

export async function writeZip(files: Iterable<readonly [string, Uint8Array]>, now = new Date()): Promise<Uint8Array> {
  const { time, day } = dosTime(now)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  let count = 0
  for (const [path, bytes] of files) {
    const name = new TextEncoder().encode(path)
    const deflated = await pipe(bytes, new CompressionStream('deflate-raw'))
    const stored = deflated.length >= bytes.length
    const data = stored ? bytes : deflated
    // version, flags, method, time, date, crc, sizes, name length, extra length
    const fields = new DataView(new ArrayBuffer(26))
    fields.setUint16(0, 20, true)
    fields.setUint16(2, UTF8, true)
    fields.setUint16(4, stored ? STORED : DEFLATED, true)
    fields.setUint16(6, time, true)
    fields.setUint16(8, day, true)
    fields.setUint32(10, crc32(bytes), true)
    fields.setUint32(14, data.length, true)
    fields.setUint32(18, bytes.length, true)
    fields.setUint16(22, name.length, true)
    const local = new Uint8Array(30 + name.length)
    new DataView(local.buffer).setUint32(0, LOCAL, true)
    local.set(new Uint8Array(fields.buffer), 4)
    local.set(name, 30)
    const entry = new Uint8Array(46 + name.length)
    const view = new DataView(entry.buffer)
    view.setUint32(0, CENTRAL, true)
    // made on "unix", as a plain 0644 file: unzip then takes the name as UTF-8
    view.setUint16(4, (3 << 8) | 20, true)
    entry.set(new Uint8Array(fields.buffer), 6)
    view.setUint32(38, (0o100644 << 16) >>> 0, true)
    view.setUint32(42, offset, true)
    entry.set(name, 46)
    parts.push(local, data)
    central.push(entry)
    offset += local.length + data.length
    count++
    if (offset > MAX_32 || count > 0xffff) throw new Error('The project is too large for a .zip file (4 GB, 65535 files)')
  }
  const directory = central.reduce((sum, entry) => sum + entry.length, 0)
  const end = new Uint8Array(22)
  const view = new DataView(end.buffer)
  view.setUint32(0, END, true)
  view.setUint16(8, count, true)
  view.setUint16(10, count, true)
  view.setUint32(12, directory, true)
  view.setUint32(16, offset, true)
  const out = new Uint8Array(offset + directory + end.length)
  let at = 0
  for (const part of [...parts, ...central, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// Directory entries are left out. Throws when the bytes are not a zip this reader takes.
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  // the end record is last, before a comment of at most 65535 bytes
  while (end >= 0 && end >= bytes.length - 22 - 0xffff && view.getUint32(end, true) !== END) end--
  if (end < 0 || view.getUint32(end, true) !== END) throw new Error('This is not a .zip file')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  if (count === 0xffff || at === MAX_32 || (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR)) {
    throw new Error('This .zip file is too large to import (zip64)')
  }
  const entries: ZipEntry[] = []
  // [local header, end of data] per file: one byte range read as two files is how a small zip inflates huge
  const spans: Array<[number, number]> = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new Error('The zip file is damaged')
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    if (path.endsWith('/')) continue
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new Error('The zip file is damaged')
    const dataEnd = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + packed
    if (dataEnd > bytes.length) throw new Error('The zip file is damaged')
    spans.push([local, dataEnd])
    entries.push({
      path,
      size,
      async read() {
        if ((flags & ENCRYPTED) !== 0) throw new Error(`"${path}" is encrypted`)
        if (method !== STORED && method !== DEFLATED) throw new Error(`"${path}" uses a compression this editor cannot read`)
        if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new Error('The zip file is damaged')
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
        const data = bytes.subarray(start, start + packed)
        const content = method === STORED ? data.slice() : await pipe(data, new DecompressionStream('deflate-raw'), size)
        if (content.length !== size || crc32(content) !== crc) throw new Error(`The zip file is damaged: "${path}" does not check out`)
        return content
      }
    })
  }
  spans.sort(([a], [b]) => a - b)
  for (let n = 1; n < spans.length; n++) {
    if (spans[n][0] < spans[n - 1][1]) throw new Error('The zip file is damaged: two of its files share the same bytes')
  }
  return entries
}
