// The npm packages projects are frozen to, unpacked in the Origin Private File
// System next to the projects:
//
//   dcl-editor/packages/<name@version>/…    one folder per package version
//
// They are kept per device and shared by every project on it. A project carries
// only its lock file, which names each package's tarball and sha512: that is
// what is copied to the account and exported, and what any device needs to
// download the same bytes again and check them. The files here are never part
// of a project's own files, so they are not synced, exported or deployed.
import type { PackageStore } from '@dcl-editor/scene-compiler'
import { type DirEntry, type FileEntry, isNotFound } from './fs'

// "@scope/name@1.0.0" as one folder name
const folderOf = (pkgKey: string): string => encodeURIComponent(pkgKey)

function segmentsOf(path: string): string[] {
  const segments = path.split('/')
  if (path === '' || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid package path "${path}"`)
  }
  return segments
}

async function* walk(dir: DirEntry, prefix = ''): AsyncGenerator<string> {
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file') yield prefix + name
    else yield* walk(await dir.getDirectoryHandle(name), `${prefix}${name}/`)
  }
}

const missing = <T>(error: unknown, fallback: T): T => {
  if (isNotFound(error)) return fallback
  throw error
}

export class OpfsPackageStore implements PackageStore {
  // `root` resolves dcl-editor/packages, made on first use
  constructor(private readonly root: () => Promise<DirEntry>) {}

  private async dir(pkgKey: string, create = false): Promise<DirEntry> {
    return (await this.root()).getDirectoryHandle(folderOf(pkgKey), { create })
  }

  async has(pkgKey: string): Promise<boolean> {
    return this.dir(pkgKey).then(
      () => true,
      (error: unknown) => missing(error, false)
    )
  }

  async list(pkgKey: string): Promise<string[]> {
    try {
      const paths: string[] = []
      for await (const path of walk(await this.dir(pkgKey))) paths.push(path)
      return paths
    } catch (error) {
      return missing(error, [])
    }
  }

  async read(pkgKey: string, path: string): Promise<Uint8Array | undefined> {
    try {
      const segments = segmentsOf(path)
      let folder = await this.dir(pkgKey)
      for (const segment of segments.slice(0, -1)) folder = await folder.getDirectoryHandle(segment)
      const file: FileEntry = await folder.getFileHandle(segments[segments.length - 1])
      return new Uint8Array(await (await file.getFile()).arrayBuffer())
    } catch (error) {
      return missing(error, undefined)
    }
  }

  async write(pkgKey: string, path: string, bytes: Uint8Array): Promise<void> {
    const segments = segmentsOf(path)
    let folder = await this.dir(pkgKey, true)
    for (const segment of segments.slice(0, -1)) folder = await folder.getDirectoryHandle(segment, { create: true })
    const stream = await (await folder.getFileHandle(segments[segments.length - 1], { create: true })).createWritable()
    await stream.write(bytes as Uint8Array<ArrayBuffer>)
    await stream.close()
  }

  async remove(pkgKey: string): Promise<void> {
    await (await this.root()).removeEntry(folderOf(pkgKey), { recursive: true }).catch((error: unknown) => missing(error, undefined))
  }

  // every package version on this device
  async keys(): Promise<string[]> {
    const keys: string[] = []
    for await (const [name, entry] of (await this.root()).entries()) if (entry.kind === 'directory') keys.push(decodeURIComponent(name))
    return keys
  }
}
