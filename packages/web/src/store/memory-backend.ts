// The store's backend in memory, for tests.
import type { DirEntry, FileEntry, Locks, StoreBackend } from './fs'

const named = (name: string, message: string): Error => Object.assign(new Error(message), { name })

class MemoryFile implements FileEntry {
  readonly kind = 'file'
  bytes = new Uint8Array()
  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const bytes = this.bytes
    return { arrayBuffer: async () => bytes.slice().buffer }
  }
  async createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void> }> {
    let next = new Uint8Array()
    return {
      write: async (data) => {
        next = data.slice()
      },
      // as the real one: the file changes when the stream closes
      close: async () => {
        this.bytes = next
      }
    }
  }
}

class MemoryDir implements DirEntry {
  readonly kind = 'directory'
  private readonly children = new Map<string, MemoryDir | MemoryFile>()

  private child<T extends MemoryDir | MemoryFile>(name: string, create: boolean, kind: new () => T): T {
    const found = this.children.get(name)
    if (found instanceof kind) return found
    if (found !== undefined) throw named('TypeMismatchError', name)
    if (!create) throw named('NotFoundError', name)
    const made = new kind()
    this.children.set(name, made)
    return made
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDir> {
    return this.child(name, options?.create === true, MemoryDir)
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    return this.child(name, options?.create === true, MemoryFile)
  }
  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const found = this.children.get(name)
    if (found === undefined) throw named('NotFoundError', name)
    if (found instanceof MemoryDir && found.children.size > 0 && options?.recursive !== true) {
      throw named('InvalidModificationError', name)
    }
    this.children.delete(name)
  }
  async *entries(): AsyncGenerator<[string, MemoryDir | MemoryFile]> {
    yield* this.children
  }
}

// Web Locks, exclusive mode: one holder per name, the rest wait or, with ifAvailable, get null.
function memoryLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>()
  const held = new Set<string>()
  return {
    request<T>(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T>): Promise<T> {
      if (options.ifAvailable === true && held.has(name)) return callback(null)
      const run = (tails.get(name) ?? Promise.resolve()).then(async () => {
        held.add(name)
        try {
          return await callback({ name })
        } finally {
          held.delete(name)
        }
      })
      held.add(name)
      tails.set(name, run.catch(() => {}))
      return run
    }
  }
}

// one browser profile: every store made from it is another tab
export function memoryProfile(): StoreBackend {
  const root = new MemoryDir()
  return { root: async () => root, locks: memoryLocks() }
}
