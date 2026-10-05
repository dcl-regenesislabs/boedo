import { describe, expect, it } from 'vitest'
import { plainBytes } from '../preview-ids'
import { Resolver } from '../resolver'
import { Vfs } from '../vfs'
import { mountPackages } from './mount'
import { resolveDependencies } from './resolve'
import { satisfies } from './semver'
import { MemoryPackageStore } from './store'

const REGISTRY = 'https://registry.test'
const encoder = new TextEncoder()

interface Published {
  name: string
  version: string
  dependencies?: Record<string, string>
  scripts?: Record<string, string>
  // extra tar entries, by their raw path in the archive
  entries?: Record<string, string>
  // serve other bytes than the ones the integrity was computed over
  tampered?: boolean
  tarballUrl?: string
}

function tar(entries: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const [path, text] of Object.entries(entries)) {
    const data = encoder.encode(text)
    const header = new Uint8Array(512)
    const put = (value: string, at: number): void => header.set(encoder.encode(value), at)
    put(path, 0)
    put('0000644\0', 100)
    put(data.length.toString(8).padStart(11, '0') + '\0', 124)
    put('        ', 148)
    put('0', 156)
    put('ustar\0' + '00', 257)
    put(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    const body = new Uint8Array(Math.ceil(data.length / 512) * 512)
    body.set(data)
    blocks.push(header, body)
  }
  blocks.push(new Uint8Array(1024))
  const out = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0))
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.length
  }
  return out
}

const gzip = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([plainBytes(bytes)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())

async function sri(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', plainBytes(bytes)))
  return 'sha512-' + btoa(String.fromCharCode(...digest))
}

// A registry served by `fetch`; `requests` lists every url asked for.
async function registryOf(published: Published[]): Promise<{ fetch: (url: string) => Promise<Response>; requests: string[] }> {
  const documents = new Map<string, { 'dist-tags': { latest: string }; versions: Record<string, unknown> }>()
  const tarballs = new Map<string, Uint8Array>()
  for (const pkg of published) {
    const manifest = { name: pkg.name, version: pkg.version, main: 'index.js', dependencies: pkg.dependencies, scripts: pkg.scripts }
    const tarball = await gzip(
      tar({
        'package/package.json': JSON.stringify(manifest),
        'package/index.js': `module.exports = ${JSON.stringify(pkg.name + '@' + pkg.version)}`,
        ...pkg.entries
      })
    )
    const url = pkg.tarballUrl ?? `${REGISTRY}/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`
    tarballs.set(url, pkg.tampered === true ? await gzip(tar({ 'package/index.js': 'steal()' })) : tarball)
    const document = documents.get(pkg.name) ?? { 'dist-tags': { latest: pkg.version }, versions: {} }
    document['dist-tags'].latest = pkg.version
    document.versions[pkg.version] = { ...manifest, dist: { tarball: url, integrity: await sri(tarball) } }
    documents.set(pkg.name, document)
  }
  const requests: string[] = []
  return {
    requests,
    fetch: async (url) => {
      requests.push(url)
      const document = documents.get(decodeURIComponent(url.slice(REGISTRY.length + 1)))
      if (document !== undefined) return new Response(JSON.stringify(document))
      const tarball = tarballs.get(url)
      return tarball === undefined ? new Response('', { status: 404 }) : new Response(plainBytes(tarball))
    }
  }
}

describe('resolving a project against a registry', () => {
  it('gives a transitive dependency and two conflicting ranges each their own version', async () => {
    const registry = await registryOf([
      { name: 'leaf', version: '1.4.0' },
      { name: 'leaf', version: '2.1.0' },
      { name: 'branch', version: '1.0.0', dependencies: { leaf: '^1.0.0', twig: '~3.2.0' } },
      { name: 'twig', version: '3.2.5' }
    ])
    const store = new MemoryPackageStore()
    const { lock } = await resolveDependencies({ dependencies: { branch: '^1.0.0', leaf: '^2.0.0' }, registry: REGISTRY, fetch: registry.fetch, store })

    expect(lock.dependencies).toEqual({ branch: '1.0.0', leaf: '2.1.0' })
    expect(Object.keys(lock.packages)).toEqual(['branch@1.0.0', 'leaf@1.4.0', 'leaf@2.1.0', 'twig@3.2.5'])
    expect(lock.packages['branch@1.0.0']).toMatchObject({
      resolved: `${REGISTRY}/branch/-/branch-1.0.0.tgz`,
      integrity: expect.stringMatching(/^sha512-/),
      dependencies: { leaf: '1.4.0', twig: '3.2.5' }
    })

    const files = Object.keys(lock.packages).flatMap((key) =>
      store.list(key).map((path): [string, string, Uint8Array] => [key, path, store.read(key, path) ?? new Uint8Array()])
    )
    const vfs = new Vfs()
    for (const [path, bytes] of mountPackages(lock, files, new Set()).files) vfs.set(path, bytes)
    const resolver = new Resolver({ vfs })
    const loaded = (specifier: string, fromDir: string): string | undefined => {
      const found = resolver.resolve(specifier, fromDir, 'import')
      return found.kind === 'file' ? vfs.text(found.path) : found.kind
    }
    expect(loaded('leaf', '/scene/src')).toContain('leaf@2.1.0')
    expect(loaded('leaf', '/scene/node_modules/branch')).toContain('leaf@1.4.0')
    expect(loaded('twig', '/scene/node_modules/branch')).toContain('twig@3.2.5')
  })

  it('resolves a frozen project again without the network', async () => {
    const registry = await registryOf([
      { name: 'leaf', version: '1.4.0' },
      { name: 'branch', version: '1.0.0', dependencies: { leaf: '^1.0.0' } }
    ])
    const store = new MemoryPackageStore()
    const dependencies = { branch: '^1.0.0' }
    const first = await resolveDependencies({ dependencies, registry: REGISTRY, fetch: registry.fetch, store })
    const offline = (): Promise<Response> => Promise.reject(new Error('offline'))

    const again = await resolveDependencies({ dependencies, lock: first.lock, registry: REGISTRY, fetch: offline, store })
    expect(again.lock).toEqual(first.lock)
    expect(again.stats).toMatchObject({ requests: 0, reused: 2, downloaded: 0 })

    const emptyStore = resolveDependencies({ dependencies, lock: first.lock, registry: REGISTRY, fetch: offline, store: new MemoryPackageStore(), frozen: true })
    await expect(emptyStore).rejects.toMatchObject({ code: 'frozen', pkg: 'branch@1.0.0' })
  })

  it('refuses a tarball that does not match its integrity, and stores nothing of it', async () => {
    const registry = await registryOf([{ name: 'leaf', version: '1.0.0', tampered: true }])
    const store = new MemoryPackageStore()
    const resolving = resolveDependencies({ dependencies: { leaf: '1.0.0' }, registry: REGISTRY, fetch: registry.fetch, store })
    await expect(resolving).rejects.toMatchObject({ code: 'integrity', pkg: 'leaf@1.0.0' })
    expect(store.has('leaf@1.0.0')).toBe(false)
  })

  it('refuses a tarball with an entry that leaves the package folder', async () => {
    const registry = await registryOf([{ name: 'leaf', version: '1.0.0', entries: { 'package/../../branch@1.0.0/index.js': 'steal()' } }])
    const store = new MemoryPackageStore()
    const resolving = resolveDependencies({ dependencies: { leaf: '1.0.0' }, registry: REGISTRY, fetch: registry.fetch, store })
    await expect(resolving).rejects.toMatchObject({ code: 'unsafe-tarball' })
    expect(store.has('leaf@1.0.0')).toBe(false)
  })

  it('refuses a tarball hosted outside the registry without asking for it', async () => {
    const elsewhere = 'https://elsewhere.test/leaf-1.0.0.tgz'
    const registry = await registryOf([{ name: 'leaf', version: '1.0.0', tarballUrl: elsewhere }])
    const resolving = resolveDependencies({ dependencies: { leaf: '1.0.0' }, registry: REGISTRY, fetch: registry.fetch, store: new MemoryPackageStore() })
    await expect(resolving).rejects.toMatchObject({ code: 'registry-origin' })
    expect(registry.requests).not.toContain(elsewhere)
  })

  it('warns about install scripts instead of running them', async () => {
    const registry = await registryOf([{ name: 'leaf', version: '1.0.0', scripts: { postinstall: 'node steal.js' } }])
    const { warnings } = await resolveDependencies({ dependencies: { leaf: '1.0.0' }, registry: REGISTRY, fetch: registry.fetch, store: new MemoryPackageStore() })
    expect(warnings).toEqual([{ code: 'install-script', package: 'leaf@1.0.0', message: expect.stringContaining('postinstall') }])
  })

  it('leaves what the SDK snapshot provides to the snapshot, and reports a different pin', async () => {
    const registry = await registryOf([{ name: 'branch', version: '1.0.0', dependencies: { '@dcl/sdk': '^7.0.0', react: '^18.0.0' } }])
    const { lock, warnings } = await resolveDependencies({
      dependencies: { branch: '1.0.0' },
      devDependencies: { '@dcl/sdk': '7.1.0' },
      snapshot: { sdkVersion: '7.25.1-1.commit-abc', provided: { '@dcl/sdk': '7.25.1-1.commit-abc', react: '18.3.1' } },
      registry: REGISTRY,
      fetch: registry.fetch,
      store: new MemoryPackageStore()
    })
    expect(Object.keys(lock.packages)).toEqual(['branch@1.0.0'])
    expect(registry.requests).toEqual([`${REGISTRY}/branch`, `${REGISTRY}/branch/-/branch-1.0.0.tgz`])
    expect(warnings).toEqual([{ code: 'sdk-version', package: '@dcl/sdk', message: expect.stringContaining('7.1.0') }])
  })

  it('stops at the size limit before anything of the package is stored', async () => {
    const registry = await registryOf([{ name: 'leaf', version: '1.0.0', entries: { 'package/big.js': 'x'.repeat(4096) } }])
    const store = new MemoryPackageStore()
    const resolving = resolveDependencies({ dependencies: { leaf: '1.0.0' }, registry: REGISTRY, fetch: registry.fetch, store, limits: { unpackedBytes: 2048 } })
    await expect(resolving).rejects.toMatchObject({ code: 'limit' })
    expect(store.has('leaf@1.0.0')).toBe(false)
  })
})

describe('version ranges as manifests write them', () => {
  it('matches the versions npm would', () => {
    const cases: [version: string, range: string, expected: boolean][] = [
      ['1.4.0', '^1.2.3', true],
      ['2.0.0', '^1.2.3', false],
      ['0.3.0', '^0.2.3', false],
      ['0.0.4', '^0.0.3', false],
      ['1.2.9', '~1.2.3', true],
      ['1.3.0', '~1.2.3', false],
      ['1.9.0', '1.x', true],
      ['2.0.0', '>=1.2.0 <2.0.0', false],
      ['3.1.0', '1.x || >=3.0.0', true],
      ['2.3.4', '1.2.3 - 2.3.4', true],
      ['7.25.1', '*', true],
      // a prerelease only matches a range that names one of the same release
      ['7.26.0-1.commit-abc', '^7.9.2', false],
      ['7.25.1-2.commit-abc', '>=7.25.1-1.commit-abc', true]
    ]
    for (const [version, range, expected] of cases) expect(satisfies(version, range), `${version} in ${range}`).toBe(expected)
    expect(satisfies('7.26.0-1.commit-abc', '^7.9.2', { includePrerelease: true })).toBe(true)
  })
})
