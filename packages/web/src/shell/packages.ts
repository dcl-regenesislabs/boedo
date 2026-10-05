// A project's npm packages, frozen: what package.json asks for is resolved once,
// each tarball is checked against its sha512 and unpacked into the device's
// package store, and the exact versions are written to the project's lock file.
// A project whose lock fits and whose packages are stored asks the registry
// for nothing, so it builds with no network.
import type { ProjectPackages } from '@dcl-editor/contract'
import {
  LOCK_FILE,
  type PackageLock,
  PackageResolveError,
  type PackageStore,
  type SnapshotPackages,
  lockedKey,
  parseLock,
  resolveDependencies,
  serializeLock
} from '@dcl-editor/web-build'
import { parseSceneJson } from './scene-json'

export interface FrozenPackages {
  // null: the project takes nothing from npm
  lock: PackageLock | null
  // the lock file's new content, when it has to change
  lockFile?: Uint8Array
  // null: nothing to say, the project asks for no package
  status: ProjectPackages | null
  // something was downloaded this time
  downloaded: number
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

function failure(error: unknown): string {
  const said = error instanceof Error ? error.message : String(error)
  if (!(error instanceof PackageResolveError)) return `The packages could not be installed: ${said}`
  if (error.code === 'network') {
    return 'The packages could not be downloaded: the npm registry cannot be reached. They are downloaded once and kept on this device; reopen the scene when you are online.'
  }
  if (error.code === 'integrity') return `${said}. Nothing from it was kept.`
  return `The packages could not be installed: ${said}`
}

// name -> version of the project's own dependencies, as the lock pins them
function direct(lock: PackageLock): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, ref] of Object.entries(lock.dependencies)) {
    const key = lockedKey(name, ref)
    out[name] = key.slice(key.lastIndexOf('@') + 1)
  }
  return out
}

export async function freezePackages(
  files: ReadonlyMap<string, Uint8Array>,
  store: PackageStore,
  snapshot: SnapshotPackages,
  report: (status: ProjectPackages) => void
): Promise<FrozenPackages> {
  const manifest = parseSceneJson(files.get('package.json'))
  const current = files.get(LOCK_FILE)
  const previous = parseLock(current)
  let announced = false
  try {
    const result = await resolveDependencies({
      dependencies: record(manifest?.dependencies),
      devDependencies: record(manifest?.devDependencies),
      lock: previous,
      store,
      snapshot,
      onProgress: (progress) => {
        if (progress.type !== 'stored' || (progress.reused && !announced)) return
        announced = true
        report({
          state: 'installing',
          progress: { done: progress.done, total: progress.total },
          installed: {},
          total: progress.total,
          warnings: []
        })
      }
    })
    const total = Object.keys(result.lock.packages).length
    const text = serializeLock(result.lock)
    // a project that never asked for a package gets no lock file
    const changed = current === undefined ? total > 0 : new TextDecoder().decode(current) !== text
    return {
      lock: total === 0 ? null : result.lock,
      ...(changed ? { lockFile: new TextEncoder().encode(text) } : {}),
      status:
        total === 0
          ? null
          : {
              state: 'ready',
              installed: direct(result.lock),
              total,
              // the build log already says which SDK the scene is built with
              warnings: result.warnings.filter((warning) => warning.code !== 'sdk-version').map((warning) => warning.message)
            },
      downloaded: result.stats.downloaded
    }
  } catch (error) {
    return {
      // what was frozen before still builds, when this device holds it
      lock: previous ?? null,
      status: { state: 'error', installed: {}, total: 0, warnings: [], message: failure(error) },
      downloaded: 0
    }
  }
}
