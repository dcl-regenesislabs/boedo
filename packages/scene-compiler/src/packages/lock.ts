// dcl-editor.lock.json: the exact packages a project is frozen to.
import { isRecord } from '../vfs'
import { parseVersion } from './semver'

export const LOCK_FILE = 'dcl-editor.lock.json'

export interface LockedPackage {
  // tarball url, on the lock's registry
  resolved: string
  // "sha512-<base64>" of the tarball
  integrity: string
  // name it is imported by -> version, or "npm:<name>@<version>" when that name is an alias
  dependencies?: Record<string, string>
}

export interface PackageLock {
  lockfileVersion: 1
  registry: string
  // the project's own dependencies, in the form of LockedPackage.dependencies
  dependencies: Record<string, string>
  // "<name>@<version>" -> where it came from and what it depends on
  packages: Record<string, LockedPackage>
}

const NAME = /^(?:@[A-Za-z0-9-~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/

export const validPackageName = (name: string): boolean => name.length <= 214 && NAME.test(name)

export function splitPackageKey(key: string): { name: string; version: string } | undefined {
  const at = key.lastIndexOf('@')
  if (at <= 0) return undefined
  const [name, version] = [key.slice(0, at), key.slice(at + 1)]
  return validPackageName(name) && parseVersion(version) !== undefined ? { name, version } : undefined
}

// the package a dependency entry points at
export const lockedKey = (name: string, ref: string): string => (ref.startsWith('npm:') ? ref.slice('npm:'.length) : `${name}@${ref}`)

export const lockedRef = (name: string, key: string): string => (key.startsWith(name + '@') && key.lastIndexOf('@') === name.length ? key.slice(name.length + 1) : 'npm:' + key)

function references(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [name, ref] of Object.entries(value)) {
    if (typeof ref !== 'string' || !validPackageName(name) || splitPackageKey(lockedKey(name, ref)) === undefined) return undefined
    out[name] = ref
  }
  return out
}

// undefined for anything that is not a lock this version wrote
export function parseLock(source: string | Uint8Array | undefined): PackageLock | undefined {
  if (source === undefined) return undefined
  let json: unknown
  try {
    json = JSON.parse(typeof source === 'string' ? source : new TextDecoder().decode(source))
  } catch {
    return undefined
  }
  if (!isRecord(json) || json.lockfileVersion !== 1 || typeof json.registry !== 'string' || !isRecord(json.packages)) return undefined
  const dependencies = references(json.dependencies)
  if (dependencies === undefined) return undefined
  const packages: Record<string, LockedPackage> = {}
  for (const [key, entry] of Object.entries(json.packages)) {
    if (splitPackageKey(key) === undefined || !isRecord(entry)) return undefined
    const own = references(entry.dependencies)
    if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string' || !INTEGRITY.test(entry.integrity) || own === undefined) {
      return undefined
    }
    packages[key] = { resolved: entry.resolved, integrity: entry.integrity, ...(Object.keys(own).length > 0 ? { dependencies: own } : {}) }
  }
  return { lockfileVersion: 1, registry: json.registry, dependencies, packages }
}

export const serializeLock = (lock: PackageLock): string => JSON.stringify(lock, null, 2) + '\n'
