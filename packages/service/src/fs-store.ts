import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, statfs, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createLock, scanKeys } from './store.ts'
import type { BlobStore, ObjectInfo } from './store.ts'
import { StorageFull } from './quota-store.ts'

const KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** One directory on disk, for local development and tests. Conditional writes hold only within one process. */
export function createFsStore(root: string, minFreeBytes = 256 * 1024 * 1024): BlobStore {
  const base = path.resolve(root)
  const temp = path.join(base, '.tmp')
  // keys never start with a dot, so neither directory can hold one
  const meta = path.join(base, '.meta')
  const lock = createLock()
  let writes = 0

  function file(key: string): string {
    if (!KEY.test(key)) throw new Error(`unsafe key: ${key}`)
    return path.join(base, ...key.split('/'))
  }

  const metaFile = (key: string) => path.join(meta, ...`${key}.json`.split('/'))

  async function pruneDirectories(directory: string): Promise<void> {
    while (directory !== base && directory !== meta) {
      try { await rmdir(directory) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') return
        if (!missing(error)) throw error
      }
      directory = path.dirname(directory)
    }
  }

  async function readMeta(key: string): Promise<Record<string, string> | undefined> {
    try {
      return JSON.parse(await readFile(metaFile(key), 'utf8')) as Record<string, string>
    } catch (error) {
      if (missing(error)) return undefined
      throw error
    }
  }

  async function info(key: string): Promise<ObjectInfo | null> {
    try {
      const s = await stat(file(key), { bigint: true })
      if (!s.isFile()) return null
      // a write always lands as a new inode, so this changes even within one clock tick
      return { size: Number(s.size), etag: `${s.ino}-${s.mtimeNs}-${s.size}`, modified: Number(s.mtimeMs) }
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }

  async function list(prefix: string): Promise<string[]> {
    const dir = prefix.replace(/\/$/, '')
    try {
      const entries = await readdir(file(dir), { recursive: true, withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name).slice(base.length + 1).split(path.sep).join('/'))
        .sort()
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
  }

  // one directory deep: each subdirectory stands for its keys as `<name>/`, which scanKeys groups
  async function level(prefix: string): Promise<string[]> {
    try {
      const entries = await readdir(file(prefix.replace(/\/$/, '')), { withFileTypes: true })
      return entries.map((entry) => `${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`).sort()
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
  }

  return {
    async get(key) {
      const found = await info(key)
      if (found == null) return null
      const body = Readable.toWeb(createReadStream(file(key))) as ReadableStream<Uint8Array>
      return { body, size: found.size, etag: found.etag }
    },
    put(key, body, options) {
      const target = file(key)
      return lock(key, async () => {
        if (options?.ifMatch !== undefined && ((await info(key))?.etag ?? null) !== options.ifMatch) return null
        await mkdir(temp, { recursive: true })
        const space = await statfs(base)
        if (space.bavail * space.bsize - body.byteLength < (options?.maintenance ? 0 : minFreeBytes)) throw new StorageFull()
        await mkdir(path.dirname(target), { recursive: true })
        const staged = path.join(temp, `${process.pid}-${++writes}`)
        if (options?.metadata === undefined) {
          await rm(metaFile(key), { force: true })
        } else {
          await mkdir(path.dirname(metaFile(key)), { recursive: true })
          await writeFile(staged, JSON.stringify(options.metadata))
          await rename(staged, metaFile(key))
        }
        await writeFile(staged, body)
        await rename(staged, target)
        const written = await info(key)
        if (written == null) throw new Error(`write lost: ${key}`)
        return { etag: written.etag }
      })
    },
    head: info,
    async delete(key) {
      await rm(file(key), { force: true })
      await rm(metaFile(key), { force: true })
      await pruneDirectories(path.dirname(file(key)))
      await pruneDirectories(path.dirname(metaFile(key)))
    },
    async scan(prefix, options = {}) {
      const page = scanKeys(options.delimiter ? await level(prefix) : await list(prefix), prefix, options, () => undefined)
      if (options.metadata) for (const object of page.objects) object.metadata = await readMeta(object.key)
      return page
    },
    list
  }
}
