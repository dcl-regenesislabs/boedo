import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { LOCK_FILE } from '@dcl-editor/web-build'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryProfile } from '../store/memory-backend'
import { ProjectStore } from '../store/project-store'
import { freezePackages } from './packages'

const REGISTRY = 'https://registry.npmjs.org'
const SNAPSHOT = { sdkVersion: '7.25.1', provided: { '@dcl/sdk': '7.25.1' } }
const text = (value: string): Uint8Array => new TextEncoder().encode(value)

function tarball(entries: Record<string, string>): Buffer {
  const blocks: Buffer[] = []
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write(name, 0)
    header.write('0000644\0', 100)
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('        ', 148)
    header.write('0', 156)
    header.write('ustar\x0000', 257)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

// one package, `tint@1.0.0`, behind a fetch that counts and can be switched off
function registry(): { requests: string[]; down: () => void } {
  const tgz = tarball({ 'package/package.json': '{"name":"tint","version":"1.0.0"}', 'package/index.js': 'exports.tint = 1' })
  const url = `${REGISTRY}/tint/-/tint-1.0.0.tgz`
  const dist = { tarball: url, integrity: 'sha512-' + createHash('sha512').update(tgz).digest('base64') }
  const document = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'tint', version: '1.0.0', dist } } }
  const requests: string[] = []
  let up = true
  vi.stubGlobal('fetch', async (target: string) => {
    requests.push(target)
    if (!up) throw new TypeError('Failed to fetch')
    if (target === url) return new Response(new Uint8Array(tgz))
    return target === `${REGISTRY}/tint` ? new Response(JSON.stringify(document)) : new Response('{}', { status: 404 })
  })
  return { requests, down: () => (up = false) }
}

afterEach(() => vi.unstubAllGlobals())

describe('a project’s npm packages', () => {
  it('are downloaded once into the device’s store, pinned by the lock file, and then need no registry', async () => {
    const npm = registry()
    const device = new ProjectStore(memoryProfile())
    const files = new Map([['package.json', text('{"dependencies":{"tint":"^1.0.0","@dcl/sdk":"7.25.1"}}')]])

    const first = await freezePackages(files, device.packages, SNAPSHOT, () => {})
    expect(first.status).toMatchObject({ state: 'ready', installed: { tint: '1.0.0' }, total: 1 })
    expect(Object.keys(first.lock?.packages ?? {})).toEqual(['tint@1.0.0'])
    expect(new TextDecoder().decode(await device.packages.read('tint@1.0.0', 'index.js'))).toBe('exports.tint = 1')
    expect(npm.requests).toHaveLength(2)

    npm.down()
    files.set(LOCK_FILE, first.lockFile!)
    const frozen = await freezePackages(files, device.packages, SNAPSHOT, () => {})
    expect(frozen.status).toMatchObject({ state: 'ready', installed: { tint: '1.0.0' } })
    expect(frozen.lockFile).toBeUndefined()
    expect(npm.requests).toHaveLength(2)

    // another device has the lock (it is one of the project's files) and not the bytes
    const other = await freezePackages(files, new ProjectStore(memoryProfile()).packages, SNAPSHOT, () => {})
    expect(other.status).toMatchObject({ state: 'error', message: expect.stringContaining('npm registry cannot be reached') })
  })
})
