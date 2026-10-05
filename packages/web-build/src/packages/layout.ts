// Where each locked package sits in node_modules: at the top unless another version
// of the same name is already visible from its dependent, then under the dependent.
import { type PackageLock, lockedKey } from './lock'
import { sorted } from './registry'

export interface PackagePlacement {
  // "node_modules/a" or "node_modules/a/node_modules/b"
  dir: string
  key: string
}

export interface PackageLayout {
  placements: PackagePlacement[]
  // locked packages left out because the SDK snapshot owns their name
  shadowed: string[]
}

const MAX_NESTING = 12

export function layoutPackages(lock: PackageLock, snapshotNames: ReadonlySet<string> = new Set()): PackageLayout {
  const placed = new Map<string, string>()
  const placements: PackagePlacement[] = []
  const shadowed = new Set<string>()
  const queue: PackagePlacement[] = []
  const place = (dir: string, key: string): void => {
    placed.set(dir, key)
    placements.push({ dir, key })
    queue.push({ dir, key })
  }
  const want = (fromDir: string, name: string, key: string): void => {
    if (lock.packages[key] === undefined) return
    if (snapshotNames.has(name)) {
      shadowed.add(key)
      return
    }
    for (let dir = fromDir; ; ) {
      const visible = placed.get(`${dir === '' ? '' : dir + '/'}node_modules/${name}`)
      if (visible === key) return
      if (visible !== undefined) {
        if (fromDir.split('/node_modules/').length > MAX_NESTING) throw new Error(`${key} is part of a cycle of conflicting versions`)
        place(`${fromDir}/node_modules/${name}`, key)
        return
      }
      if (dir === '') break
      const parent = dir.lastIndexOf('/node_modules/')
      dir = parent === -1 ? '' : dir.slice(0, parent)
    }
    place('node_modules/' + name, key)
  }

  for (const [name, ref] of sorted(lock.dependencies)) want('', name, lockedKey(name, ref))
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const [name, ref] of sorted(lock.packages[next.key]?.dependencies ?? {})) want(next.dir, name, lockedKey(name, ref))
  }
  return { placements, shadowed: [...shadowed] }
}
