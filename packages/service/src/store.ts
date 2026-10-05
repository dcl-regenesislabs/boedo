export interface Clock {
  now(): number
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>
  size: number
  etag: string
}

export interface ObjectInfo {
  size: number
  etag: string
  /** ms since epoch */
  modified: number
}

export interface PutOptions {
  /** Reserve a small amount of space for marking an existing project deleted. */
  maintenance?: boolean
  /** A string: write only while the stored etag is this one. null: write only when the key is absent. */
  ifMatch?: string | null
  /** Small string fields kept with the object and returned by `scan`, so a listing needs no reads. */
  metadata?: Record<string, string>
}

export interface ScanOptions {
  /** Only keys sorting after this one. */
  startAfter?: string
  /** At most this many entries (objects plus prefixes) per page; at most 1000. */
  limit?: number
  /** Group keys below the next `/` into `prefixes`. */
  delimiter?: boolean
  /** Return each object's `metadata`. */
  metadata?: boolean
}

export interface ScanPage {
  objects: Array<{ key: string; metadata?: Record<string, string> }>
  /** With `delimiter`: each `prefix + segment + '/'` that has keys below it. */
  prefixes: string[]
  /** More entries sort after the last one returned. */
  truncated: boolean
}

/** Keys are lowercase `[a-z0-9._-]` segments joined by `/`. */
export interface BlobStore {
  get(key: string): Promise<StoredObject | null>
  /** Resolves null when `ifMatch` does not hold; nothing is written then. */
  put(key: string, body: Uint8Array, options?: PutOptions): Promise<{ etag: string } | null>
  head(key: string): Promise<ObjectInfo | null>
  delete(key: string): Promise<void>
  /** Every key under `prefix`, which ends with `/`. */
  list(prefix: string): Promise<string[]>
  /** One page of the keys under `prefix`, in order. */
  scan(prefix: string, options?: ScanOptions): Promise<ScanPage>
}

/** `scan` over a sorted list of keys, for stores that can list everything cheaply. */
export function scanKeys(
  sorted: readonly string[],
  prefix: string,
  options: ScanOptions,
  metadataOf: (key: string) => Record<string, string> | undefined
): ScanPage {
  const limit = Math.min(options.limit ?? 1000, 1000)
  const page: ScanPage = { objects: [], prefixes: [], truncated: false }
  for (const key of sorted) {
    if (!key.startsWith(prefix) || (options.startAfter !== undefined && key <= options.startAfter)) continue
    const slash = options.delimiter ? key.indexOf('/', prefix.length) : -1
    const folder = slash < 0 ? null : key.slice(0, slash + 1)
    if (folder !== null && page.prefixes[page.prefixes.length - 1] === folder) continue
    if (page.objects.length + page.prefixes.length >= limit) {
      page.truncated = true
      break
    }
    if (folder !== null) page.prefixes.push(folder)
    else page.objects.push(options.metadata ? { key, metadata: metadataOf(key) } : { key })
  }
  return page
}

// one key for every storage mutation: purge, uploads and manifest writes must not interleave
export const STORAGE_LOCK = 'storage-mutation'

export type Lock = <T>(key: string, run: () => Promise<T>) => Promise<T>

/** Serializes callers per key within this process. */
export function createLock(): Lock {
  const tails = new Map<string, Promise<void>>()
  return async (key, run) => {
    const prior = tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolve) => (release = resolve))
    tails.set(key, tail)
    await prior
    try {
      return await run()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}

export async function readAll(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer())
}

export function createMemoryStore(clock: Clock = Date): BlobStore {
  const objects = new Map<string, { bytes: Uint8Array; etag: string; modified: number; metadata?: Record<string, string> }>()
  let writes = 0
  return {
    async get(key) {
      const object = objects.get(key)
      if (object == null) return null
      return { body: new Blob([object.bytes as BlobPart]).stream(), size: object.bytes.length, etag: object.etag }
    },
    async put(key, body, options) {
      const current = objects.get(key)
      if (options?.ifMatch !== undefined && (current?.etag ?? null) !== options.ifMatch) return null
      const etag = `m${++writes}`
      objects.set(key, { bytes: body.slice(), etag, modified: clock.now(), metadata: options?.metadata })
      return { etag }
    },
    async head(key) {
      const object = objects.get(key)
      return object == null ? null : { size: object.bytes.length, etag: object.etag, modified: object.modified }
    },
    async delete(key) {
      objects.delete(key)
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
    },
    async scan(prefix, options = {}) {
      return scanKeys([...objects.keys()].sort(), prefix, options, (key) => objects.get(key)?.metadata)
    }
  }
}
