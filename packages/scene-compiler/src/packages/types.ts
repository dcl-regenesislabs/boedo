// The public shapes of package resolution.
import type { PackageLock } from './lock'
import type { PackageStore } from './store'

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

export const MB = 1024 * 1024

export interface ResolveLimits {
  packages: number
  // of all packages together
  unpackedBytes: number
  // of one compressed tarball
  tarballBytes: number
}

export const DEFAULT_LIMITS: ResolveLimits = { packages: 200, unpackedBytes: 100 * MB, tarballBytes: 20 * MB }

// What the SDK snapshot already holds: these names never come from the registry.
export interface SnapshotPackages {
  sdkVersion: string
  // package name -> the version the snapshot ships
  provided: Record<string, string>
}

export type PackageWarningCode =
  | 'sdk-version'
  | 'snapshot-version'
  | 'install-script'
  | 'native'
  | 'node-builtins'
  | 'unsupported-spec'
  | 'optional-skipped'
  | 'peer-unmet'
  | 'weak-integrity'
  | 'links-skipped'

export interface PackageWarning {
  code: PackageWarningCode
  // "<name>@<version>", or a bare name when no version was picked
  package?: string
  message: string
}

export type ResolveErrorCode =
  | 'integrity'
  | 'limit'
  | 'not-found'
  | 'no-version'
  | 'registry-origin'
  | 'unsafe-tarball'
  | 'network'
  | 'frozen'
  | 'invalid'

export class PackageResolveError extends Error {
  constructor(
    readonly code: ResolveErrorCode,
    message: string,
    readonly pkg?: string
  ) {
    super(message)
    this.name = 'PackageResolveError'
  }
}

export type ResolveProgress =
  | { type: 'resolved'; package: string }
  | { type: 'downloaded'; package: string; bytes: number }
  | { type: 'stored'; package: string; reused: boolean; done: number; total: number }

export interface ResolveStats {
  packages: number
  downloaded: number
  reused: number
  // registry requests made: 0 for a project that was already frozen
  requests: number
  tarballBytes: number
  unpackedBytes: number
}

export interface ResolveInput {
  // the project's package.json "dependencies"; `file:` entries are left to the build
  dependencies: Record<string, unknown>
  // only checked against the SDK snapshot, never installed
  devDependencies?: Record<string, unknown>
  // the project's current lock: what it pins is kept while it still fits
  lock?: PackageLock
  registry?: string
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  store: PackageStore
  snapshot?: SnapshotPackages
  limits?: Partial<ResolveLimits>
  // fail instead of touching the network
  frozen?: boolean
  onProgress?: (progress: ResolveProgress) => void
  signal?: AbortSignal
}

export interface ResolveResult {
  lock: PackageLock
  warnings: PackageWarning[]
  stats: ResolveStats
}
