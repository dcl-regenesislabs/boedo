import type { BlobStore } from './store.ts'

// The part of the Workers R2 binding (R2Bucket in @cloudflare/workers-types) this store uses.
export interface R2ObjectLike {
  key: string
  size: number
  etag: string
  uploaded: Date
  customMetadata?: Record<string, string>
}

export interface R2ListOptions {
  prefix: string
  cursor?: string
  startAfter?: string
  limit?: number
  delimiter?: string
  include?: Array<'customMetadata'>
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>
  get(key: string): Promise<(R2ObjectLike & { body: ReadableStream<Uint8Array> }) | null>
  /** Resolves null when `onlyIf` fails. */
  put(
    key: string,
    value: Uint8Array,
    options?: { onlyIf?: { etagMatches?: string } | Headers; customMetadata?: Record<string, string> }
  ): Promise<R2ObjectLike | null>
  delete(key: string): Promise<void>
  list(options: R2ListOptions): Promise<{ objects: R2ObjectLike[]; delimitedPrefixes?: string[]; truncated: boolean; cursor?: string }>
}

export function createR2Store(bucket: R2BucketLike): BlobStore {
  return {
    async get(key) {
      const object = await bucket.get(key)
      return object == null ? null : { body: object.body, size: object.size, etag: object.etag }
    },
    async put(key, body, options) {
      const ifMatch = options?.ifMatch
      let onlyIf: Headers | { etagMatches: string } | undefined
      if (ifMatch === null) onlyIf = new Headers({ 'if-none-match': '*' })
      else if (ifMatch !== undefined) onlyIf = { etagMatches: ifMatch }
      const written = await bucket.put(key, body, { onlyIf, customMetadata: options?.metadata })
      return written == null ? null : { etag: written.etag }
    },
    async head(key) {
      const object = await bucket.head(key)
      return object == null ? null : { size: object.size, etag: object.etag, modified: object.uploaded.getTime() }
    },
    async delete(key) {
      await bucket.delete(key)
    },
    async list(prefix) {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix, cursor })
        for (const object of page.objects) keys.push(object.key)
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor != null)
      return keys
    },
    async scan(prefix, options = {}) {
      const page = await bucket.list({
        prefix,
        startAfter: options.startAfter,
        limit: Math.min(options.limit ?? 1000, 1000),
        delimiter: options.delimiter ? '/' : undefined,
        include: options.metadata ? ['customMetadata'] : undefined
      })
      return {
        objects: page.objects.map((object) => (options.metadata ? { key: object.key, metadata: object.customMetadata } : { key: object.key })),
        prefixes: page.delimitedPrefixes ?? [],
        truncated: page.truncated
      }
    }
  }
}
