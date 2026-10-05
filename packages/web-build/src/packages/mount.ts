// Frozen packages as the build sees them: files laid out under node_modules, at
// paths that do not change between builds.
import { PROJECT_ROOT, join } from '../vfs'
import { layoutPackages } from './layout'
import type { PackageLock } from './lock'

export type PackageFiles = [pkgKey: string, path: string, bytes: Uint8Array][]

export interface MountedPackages {
  // absolute path -> content
  files: [string, Uint8Array][]
  // names that own a folder directly under node_modules
  topLevel: ReadonlySet<string>
  // locked packages left out because the SDK snapshot owns their name
  shadowed: string[]
  count: number
}

export function mountPackages(lock: PackageLock, files: PackageFiles, snapshotNames: ReadonlySet<string>): MountedPackages {
  const byPackage = new Map<string, [string, Uint8Array][]>()
  for (const [key, path, bytes] of files) {
    const list = byPackage.get(key)
    if (list === undefined) byPackage.set(key, [[path, bytes]])
    else list.push([path, bytes])
  }
  const { placements, shadowed } = layoutPackages(lock, snapshotNames)
  const mounted: [string, Uint8Array][] = []
  const topLevel = new Set<string>()
  for (const { dir, key } of placements) {
    const list = byPackage.get(key)
    if (list === undefined) throw new Error(`${key} is locked, but its files were not given to the build`)
    if (!dir.slice('node_modules/'.length).includes('/node_modules/')) topLevel.add(dir.slice('node_modules/'.length))
    for (const [path, bytes] of list) mounted.push([join(PROJECT_ROOT, `${dir}/${path}`), bytes])
  }
  return { files: mounted, topLevel, shadowed, count: new Set(placements.map((placement) => placement.key)).size }
}
