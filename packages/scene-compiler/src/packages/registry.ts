// Talks to the npm registry: package documents, and tarballs read under a size cap.
import { plainBytes } from '../preview-ids'
import { isRecord } from '../vfs'
import { validPackageName } from './lock'
import { PackageResolveError } from './types'

export interface Manifest {
  tarball: string
  integrity: string | undefined
  shasum: string | undefined
  dependencies: Record<string, string>
  optional: Record<string, string>
  // peers the package cannot do without
  peers: Record<string, string>
  bundled: ReadonlySet<string> | 'all'
  // built for one operating system or processor
  platform: boolean
}

export interface Packument {
  tags: Record<string, string>
  versions: Record<string, unknown>
}

export type Spec = { kind: 'registry'; name: string; range: string } | { kind: 'local' } | { kind: 'unsupported' }

export const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function strings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isRecord(value)) for (const [key, item] of Object.entries(value)) if (typeof item === 'string') out[key] = item
  return out
}

export function compareKeys(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

export const sorted = <T>(record: Record<string, T>): [string, T][] => Object.entries(record).sort(([a], [b]) => compareKeys(a, b))

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new PackageResolveError('invalid', `"${url}" is not a url`)
  }
}

export function parseSpec(alias: string, raw: string): Spec {
  let name = alias
  let range = raw.trim()
  if (range.startsWith('npm:')) {
    const at = range.lastIndexOf('@')
    name = at > 4 ? range.slice(4, at) : range.slice(4)
    range = at > 4 ? range.slice(at + 1) : 'latest'
  }
  if (/^(file|link|portal):/.test(range)) return { kind: 'local' }
  if (/^[a-z+]+:/.test(range) || range.startsWith('git@') || range.includes('/') || !validPackageName(name)) return { kind: 'unsupported' }
  return { kind: 'registry', name, range: range === '' ? '*' : range }
}

export function readManifest(key: string, doc: unknown): Manifest {
  const dist = isRecord(doc) && isRecord(doc.dist) ? doc.dist : undefined
  if (!isRecord(doc) || dist === undefined || typeof dist.tarball !== 'string') {
    throw new PackageResolveError('invalid', `the registry has no tarball for ${key}`, key)
  }
  const optional = strings(doc.optionalDependencies)
  const dependencies = strings(doc.dependencies)
  for (const name of Object.keys(optional)) delete dependencies[name]
  const meta = isRecord(doc.peerDependenciesMeta) ? doc.peerDependenciesMeta : {}
  const peers: Record<string, string> = {}
  for (const [name, range] of Object.entries(strings(doc.peerDependencies))) {
    const info = meta[name]
    if (!(isRecord(info) && info.optional === true) && dependencies[name] === undefined && optional[name] === undefined) peers[name] = range
  }
  const bundle = doc.bundleDependencies ?? doc.bundledDependencies
  const sha512 = typeof dist.integrity === 'string' ? dist.integrity.split(/\s+/).find((hash) => hash.startsWith('sha512-')) : undefined
  return {
    tarball: dist.tarball,
    integrity: sha512?.split('?')[0],
    shasum: typeof dist.shasum === 'string' ? dist.shasum.toLowerCase() : undefined,
    dependencies,
    optional,
    peers,
    bundled: bundle === true ? 'all' : new Set(Array.isArray(bundle) ? bundle.filter((name): name is string => typeof name === 'string') : []),
    platform: doc.os !== undefined || doc.cpu !== undefined || doc.libc !== undefined
  }
}

export async function digest(algorithm: 'SHA-1' | 'SHA-512', bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, plainBytes(bytes)))
}

export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

export interface Registry {
  url: string
  // registry requests made so far
  requests(): number
  packument(name: string): Promise<Packument>
  tarball(key: string, url: string, maxBytes: number): Promise<Uint8Array>
}

export function openRegistry(options: {
  url: string
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  // fail instead of touching the network
  frozen: boolean
  signal?: AbortSignal
}): Registry {
  const url = options.url.replace(/\/+$/, '')
  const origin = originOf(url)
  const packuments = new Map<string, Promise<Packument>>()
  let requests = 0

  async function request(target: string, accept?: string): Promise<Response> {
    requests++
    let response: Response
    try {
      // only safelisted headers: the registry does not answer CORS preflights
      response = await options.fetch(target, {
        headers: accept === undefined ? undefined : { Accept: accept },
        credentials: 'omit',
        signal: options.signal
      })
    } catch (err) {
      throw new PackageResolveError('network', `${target}: ${describe(err)}`)
    }
    if (response.url !== '' && originOf(response.url) !== origin) {
      throw new PackageResolveError('registry-origin', `${target} was answered by ${originOf(response.url)}, not by ${origin}`)
    }
    return response
  }

  async function loadPackument(name: string): Promise<Packument> {
    if (options.frozen) throw new PackageResolveError('frozen', `${name} is not pinned by the lock, and the project is frozen`, name)
    const response = await request(`${url}/${name.replace('/', '%2f')}`, 'application/vnd.npm.install-v1+json')
    if (response.status === 404) throw new PackageResolveError('not-found', `${name} is not in the registry`, name)
    if (!response.ok) throw new PackageResolveError('network', `${name}: the registry answered ${response.status}`, name)
    let json: unknown
    try {
      json = await response.json()
    } catch (err) {
      throw new PackageResolveError('network', `${name}: ${describe(err)}`, name)
    }
    if (!isRecord(json) || !isRecord(json.versions)) throw new PackageResolveError('invalid', `${name}: the registry sent no versions`, name)
    return { tags: strings(json['dist-tags']), versions: json.versions }
  }

  async function bodyOf(response: Response, key: string, maxBytes: number): Promise<Uint8Array> {
    const tooLarge = new PackageResolveError('limit', `${key}: the tarball is larger than ${maxBytes} bytes`, key)
    if (Number(response.headers.get('content-length')) > maxBytes) throw tooLarge
    try {
      const reader = response.body?.getReader()
      if (reader === undefined) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > maxBytes) throw tooLarge
        return bytes
      }
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > maxBytes) {
          await reader.cancel()
          throw tooLarge
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      return bytes
    } catch (err) {
      if (err instanceof PackageResolveError) throw err
      throw new PackageResolveError('network', `${key}: ${describe(err)}`, key)
    }
  }

  return {
    url,
    requests: () => requests,
    packument(name) {
      let pending = packuments.get(name)
      if (pending === undefined) packuments.set(name, (pending = loadPackument(name)))
      return pending
    },
    async tarball(key, target, maxBytes) {
      if (options.frozen) throw new PackageResolveError('frozen', `${key} is not in the package store, and the project is frozen`, key)
      if (originOf(target) !== origin) {
        throw new PackageResolveError('registry-origin', `${key}: its tarball is on ${originOf(target)}, not on ${origin}`, key)
      }
      const response = await request(target)
      if (!response.ok) throw new PackageResolveError('network', `${key}: the registry answered ${response.status}`, key)
      return bodyOf(response, key, maxBytes)
    }
  }
}
