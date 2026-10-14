// Turns a project's dependencies into a lock and a filled package store: versions are
// picked as npm picks them, every tarball is checked against its integrity before it
// is unpacked, and nothing a package ships is ever run.
import { inspectPackage } from './inspect'
import { type LockedPackage, lockedKey, lockedRef, splitPackageKey, validPackageName } from './lock'
import { compareVersions, maxSatisfying, parseVersion, satisfies, validRange } from './semver'
import { type Manifest, base64, compareKeys, digest, hex, openRegistry, parseSpec, readManifest, sorted } from './registry'
import { PACKAGE_RECEIPT, type PackageReceipt, readReceipt, writeReceipt } from './store'
import { TarError, type UnpackedTarball, gunzip, readTar } from './tar'
import {
  DEFAULT_LIMITS,
  DEFAULT_REGISTRY,
  MB,
  PackageResolveError,
  type PackageWarning,
  type PackageWarningCode,
  type ResolveInput,
  type ResolveLimits,
  type ResolveResult,
  type ResolveStats
} from './types'

const DOWNLOADS_AT_ONCE = 4

export async function resolveDependencies(input: ResolveInput): Promise<ResolveResult> {
  const registry = openRegistry({
    url: input.registry ?? DEFAULT_REGISTRY,
    fetch: input.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init)),
    frozen: input.frozen === true,
    signal: input.signal
  })
  const limits: ResolveLimits = { ...DEFAULT_LIMITS, ...input.limits }
  const provided = input.snapshot?.provided ?? {}
  // pins made against another registry point at tarballs this one may not serve
  const previous = input.lock !== undefined && input.lock.registry === registry.url ? input.lock : undefined
  const stats: ResolveStats = { packages: 0, downloaded: 0, reused: 0, requests: 0, tarballBytes: 0, unpackedBytes: 0 }

  const warnings: PackageWarning[] = []
  const warn = (code: PackageWarningCode, message: string, pkg?: string): void => {
    if (warnings.some((warning) => warning.code === code && warning.message === message)) return
    warnings.push({ code, message, ...(pkg === undefined ? {} : { package: pkg }) })
  }

  const packages = new Map<string, LockedPackage>()
  // packages picked from the registry in this run; the others are taken as the lock has them
  const manifests = new Map<string, Manifest>()
  const dependents = new Map<string, string | undefined>()
  const queue: string[] = []
  const root: Record<string, string> = {}

  // makes sure the dependencies of this exact version are known
  async function known(key: string): Promise<void> {
    if (packages.has(key) || manifests.has(key) || previous?.packages[key] !== undefined) return
    const parts = splitPackageKey(key)
    if (parts === undefined) throw new PackageResolveError('invalid', `"${key}" is not a package version`)
    const doc = (await registry.packument(parts.name)).versions[parts.version]
    if (doc === undefined) throw new PackageResolveError('no-version', `${key} is not in the registry`, key)
    manifests.set(key, readManifest(key, doc))
  }

  async function choose(name: string, range: string, locked: string | undefined): Promise<string> {
    const tag = !validRange(range)
    const fits = (key: string): boolean => {
      const parts = splitPackageKey(key)
      return parts !== undefined && parts.name === name && (tag || satisfies(parts.version, range))
    }
    const usable = (key: string): boolean => packages.has(key) || previous?.packages[key] !== undefined
    if (locked !== undefined && fits(locked) && usable(locked)) return locked
    if (!tag) {
      const newest = (keys: Iterable<string>): string | undefined => {
        const version = maxSatisfying([...keys].filter(fits).map((key) => key.slice(name.length + 1)), range)
        return version === undefined ? undefined : `${name}@${version}`
      }
      // one copy is shared where the ranges allow it
      const shared = newest(packages.keys()) ?? newest(Object.keys(previous?.packages ?? {}))
      if (shared !== undefined) return shared
    }
    const doc = await registry.packument(name)
    const latest = doc.tags.latest
    const version = tag
      ? doc.tags[range]
      : latest !== undefined && satisfies(latest, range)
        ? latest
        : maxSatisfying(Object.keys(doc.versions), range)
    if (version === undefined || parseVersion(version) === undefined || doc.versions[version] === undefined) {
      throw new PackageResolveError('no-version', `no version of ${name} matches "${range}"`, name)
    }
    const key = `${name}@${version}`
    if (!packages.has(key) && !manifests.has(key)) manifests.set(key, readManifest(key, doc.versions[version]))
    return key
  }

  function register(key: string, dependent: string | undefined): void {
    if (packages.has(key)) return
    if (packages.size >= limits.packages) throw new PackageResolveError('limit', `the project needs more than ${limits.packages} packages`)
    const manifest = manifests.get(key)
    const pinned = previous?.packages[key]
    if (manifest !== undefined) packages.set(key, { resolved: manifest.tarball, integrity: manifest.integrity ?? '', dependencies: {} })
    else if (pinned !== undefined) packages.set(key, { resolved: pinned.resolved, integrity: pinned.integrity, dependencies: { ...pinned.dependencies } })
    else throw new PackageResolveError('invalid', `${key} was never resolved`, key)
    dependents.set(key, dependent)
    queue.push(key)
    input.onProgress?.({ type: 'resolved', package: key })
  }

  // asks for a package document ahead of its turn, unless something already picked or pinned may do
  function prefetch(alias: string, raw: string): void {
    const spec = parseSpec(alias, raw)
    if (input.frozen === true || provided[alias] !== undefined || spec.kind !== 'registry') return
    const fits = (key: string): boolean =>
      key.startsWith(spec.name + '@') && validRange(spec.range) && satisfies(key.slice(spec.name.length + 1), spec.range)
    if ([...packages.keys(), ...Object.keys(previous?.packages ?? {})].some(fits)) return
    registry.packument(spec.name).catch(() => {})
  }

  // true when the snapshot owns the name; a range it does not meet is only reported
  function fromSnapshot(alias: string, raw: string, from: string | undefined): boolean {
    const have = provided[alias]
    if (have === undefined) return false
    const range = raw.trim()
    if (have !== '' && validRange(range) && !satisfies(have, range, { includePrerelease: true })) {
      if (alias === '@dcl/sdk' && from === undefined) {
        warn('sdk-version', `This project pins @dcl/sdk ${range}; it is built here with ${have}.`, alias)
      } else {
        warn('snapshot-version', `${from ?? 'This project'} asks for ${alias} ${range}; it gets the ${have} the SDK ships.`, from ?? alias)
      }
    }
    return true
  }

  // a peer is the copy its dependent (or the project) already uses, when there is one
  function sharedPeer(alias: string, key: string): string | undefined {
    const dependent = dependents.get(key)
    const ref = (dependent === undefined ? undefined : packages.get(dependent)?.dependencies?.[alias]) ?? root[alias]
    return ref === undefined ? undefined : lockedKey(alias, ref)
  }

  async function expand(key: string): Promise<void> {
    const entry = packages.get(key)
    if (entry === undefined) return
    const own = (entry.dependencies ??= {})
    const manifest = manifests.get(key)
    if (manifest === undefined) {
      for (const [alias, ref] of sorted({ ...own })) {
        if (provided[alias] !== undefined) {
          delete own[alias]
          continue
        }
        const dependency = lockedKey(alias, ref)
        await known(dependency)
        register(dependency, key)
      }
      return
    }
    const edges: [alias: string, raw: string, kind: 'required' | 'optional' | 'peer'][] = []
    for (const [alias, raw] of Object.entries(manifest.dependencies)) edges.push([alias, raw, 'required'])
    for (const [alias, raw] of Object.entries(manifest.optional)) edges.push([alias, raw, 'optional'])
    for (const [alias, raw] of Object.entries(manifest.peers)) edges.push([alias, raw, 'peer'])
    edges.sort(([a], [b]) => compareKeys(a, b))
    // bundled dependencies come inside the tarball
    const bundled = (alias: string): boolean => manifest.bundled === 'all' || manifest.bundled.has(alias)
    for (const [alias, raw, kind] of edges) if (kind !== 'peer' && !bundled(alias)) prefetch(alias, raw)
    let otherPlatforms = 0
    for (const [alias, raw, kind] of edges) {
      if (kind !== 'peer' && bundled(alias)) continue
      if (fromSnapshot(alias, raw, key)) continue
      const spec = parseSpec(alias, raw)
      if (spec.kind !== 'registry') {
        warn('unsupported-spec', `${key} depends on ${alias} as "${raw}", which is not a registry version; it was left out.`, key)
        continue
      }
      try {
        let dependency = kind === 'peer' ? sharedPeer(alias, key) : undefined
        if (dependency === undefined) {
          dependency = await choose(spec.name, spec.range, undefined)
        } else if (validRange(spec.range) && !satisfies(dependency.slice(dependency.lastIndexOf('@') + 1), spec.range)) {
          warn('peer-unmet', `${key} expects ${alias} ${spec.range}; the project uses ${dependency}.`, key)
        }
        if (kind === 'optional' && manifests.get(dependency)?.platform === true && !packages.has(dependency)) {
          otherPlatforms++
          continue
        }
        register(dependency, key)
        own[alias] = lockedRef(alias, dependency)
      } catch (err) {
        const fatal = !(err instanceof PackageResolveError) || err.code === 'limit' || err.code === 'frozen' || kind === 'required'
        if (fatal) throw err
        warn(kind === 'peer' ? 'peer-unmet' : 'optional-skipped', `${key}: ${alias} was left out (${err.message}).`, key)
      }
    }
    if (otherPlatforms > 0) {
      warn('optional-skipped', `${key}: ${otherPlatforms} optional packages built for one platform were left out.`, key)
    }
  }

  for (const [alias, raw] of Object.entries(input.dependencies)) {
    if (typeof raw === 'string' && validPackageName(alias) && previous?.dependencies[alias] === undefined) prefetch(alias, raw)
  }
  for (const [alias, raw] of sorted(input.dependencies)) {
    if (typeof raw !== 'string' || fromSnapshot(alias, raw, undefined)) continue
    const spec = parseSpec(alias, raw)
    if (spec.kind === 'local') continue
    if (spec.kind === 'unsupported' || !validPackageName(alias)) {
      warn('unsupported-spec', `${alias}: "${raw}" is not a registry version; it was left out.`, alias)
      continue
    }
    const pinned = previous?.dependencies[alias]
    const key = await choose(spec.name, spec.range, pinned === undefined ? undefined : lockedKey(alias, pinned))
    register(key, undefined)
    root[alias] = lockedRef(alias, key)
  }
  for (const [alias, raw] of Object.entries(input.devDependencies ?? {})) {
    if (typeof raw === 'string') fromSnapshot(alias, raw, undefined)
  }
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) await expand(key)

  const account = (key: string, bytes: number): void => {
    stats.unpackedBytes += bytes
    if (stats.unpackedBytes > limits.unpackedBytes) {
      throw new PackageResolveError('limit', `the packages unpack to more than ${limits.unpackedBytes} bytes (at ${key})`, key)
    }
  }

  async function download(key: string, entry: LockedPackage): Promise<PackageReceipt> {
    const tarball = await registry.tarball(key, entry.resolved, limits.tarballBytes)
    const sha512 = 'sha512-' + base64(await digest('SHA-512', tarball))
    if (entry.integrity === '') {
      const shasum = manifests.get(key)?.shasum
      if (shasum === undefined || hex(await digest('SHA-1', tarball)) !== shasum) {
        throw new PackageResolveError('integrity', `${key}: the tarball does not match the checksum the registry lists`, key)
      }
      entry.integrity = sha512
      warn('weak-integrity', `${key} was published with a SHA-1 checksum only; the lock pins what was downloaded.`, key)
    } else if (sha512 !== entry.integrity) {
      throw new PackageResolveError('integrity', `${key}: the tarball does not match its integrity (${entry.integrity})`, key)
    }
    input.onProgress?.({ type: 'downloaded', package: key, bytes: tarball.length })

    let unpacked: UnpackedTarball
    try {
      unpacked = readTar(await gunzip(tarball, 2 * limits.unpackedBytes + MB))
    } catch (err) {
      if (!(err instanceof TarError)) throw err
      throw new PackageResolveError(err.reason === 'too-large' ? 'limit' : 'unsafe-tarball', `${key} ${err.message}`, key)
    }
    const { files } = unpacked
    files.delete(PACKAGE_RECEIPT)
    let bytes = 0
    for (const content of files.values()) bytes += content.length
    account(key, bytes)
    const receipt: PackageReceipt = { integrity: entry.integrity, files: files.size, bytes, ...inspectPackage(key.slice(0, key.lastIndexOf('@')), files) }
    await input.store.remove(key)
    for (const [path, content] of files) await input.store.write(key, path, content)
    await writeReceipt(input.store, key, receipt)
    if (unpacked.skipped.length > 0) warn('links-skipped', `${key}: ${unpacked.skipped.length} links in the tarball were left out.`, key)
    stats.downloaded++
    stats.tarballBytes += tarball.length
    return receipt
  }

  const keys = [...packages.keys()]
  const receipts = new Map<string, PackageReceipt>()
  let next = 0
  let failed = false
  const drain = async (): Promise<void> => {
    while (next < keys.length && !failed) {
      const key = keys[next++]
      const entry = packages.get(key)
      if (entry === undefined) continue
      try {
        const stored = await readReceipt(input.store, key)
        const reused = stored !== undefined && stored.integrity === entry.integrity
        if (reused) {
          account(key, stored.bytes)
          stats.reused++
        }
        receipts.set(key, reused ? stored : await download(key, entry))
        input.onProgress?.({ type: 'stored', package: key, reused, done: receipts.size, total: keys.length })
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, keys.length) }, drain))

  const direct = new Set(Object.entries(root).map(([alias, ref]) => lockedKey(alias, ref)))
  for (const key of keys) {
    const traits = receipts.get(key)
    if (traits === undefined) continue
    if (traits.installScripts.length > 0) {
      warn('install-script', `${key} declares ${traits.installScripts.join(', ')} scripts; they are not run here.`, key)
    }
    if (traits.native) warn('native', `${key} ships native code, which a scene cannot load.`, key)
    if (traits.nodeBuiltins.length > 0 && direct.has(key)) {
      warn('node-builtins', `${key} uses Node built-ins a scene does not have: ${traits.nodeBuiltins.join(', ')}.`, key)
    }
  }

  const byVersion = (a: string, b: string): number => {
    const [x, y] = [splitPackageKey(a), splitPackageKey(b)]
    if (x === undefined || y === undefined || x.name !== y.name) return compareKeys(a, b)
    const [vx, vy] = [parseVersion(x.version), parseVersion(y.version)]
    return vx === undefined || vy === undefined ? 0 : compareVersions(vx, vy)
  }
  const locked: Record<string, LockedPackage> = {}
  for (const key of [...keys].sort(byVersion)) {
    const entry = packages.get(key)
    if (entry === undefined) continue
    const own = Object.fromEntries(sorted(entry.dependencies ?? {}))
    locked[key] = { resolved: entry.resolved, integrity: entry.integrity, ...(Object.keys(own).length > 0 ? { dependencies: own } : {}) }
  }
  stats.packages = keys.length
  stats.requests = registry.requests()
  return {
    lock: { lockfileVersion: 1, registry: registry.url, dependencies: Object.fromEntries(sorted(root)), packages: locked },
    warnings,
    stats
  }
}
