import { keys } from './paths.ts'
import { createLock } from './store.ts'
import type { BlobStore } from './store.ts'

export class StorageFull extends Error {
  constructor() { super('Storage capacity reached') }
}

export async function createQuotaStore(store: BlobStore, limits: { maxStorageBytes: number; maxStorageObjects: number }): Promise<BlobStore> {
  const sizes = new Map<string, number>()
  let bytes = 0
  for (const prefix of ['blobs/', 'wallets/', 'uploads/', 'purge/']) {
    for (const key of await store.list(prefix)) {
      const info = await store.head(key)
      if (info !== null) { sizes.set(key, info.size); bytes += info.size }
    }
  }
  const lock = createLock()
  return {
    get: (key) => store.get(key),
    head: (key) => store.head(key),
    list: (prefix) => store.list(prefix),
    scan: (prefix, options) => store.scan(prefix, options),
    put: (key, body, options) => lock('capacity', async () => {
      const previous = sizes.get(key)
      const nextBytes = bytes - (previous ?? 0) + body.byteLength
      const deletion = options?.maintenance === true && previous !== undefined && body.byteLength <= previous + 64
      if (key !== keys.purgeCursor && !deletion && ((nextBytes > limits.maxStorageBytes && nextBytes > bytes) ||
        (previous === undefined && sizes.size >= limits.maxStorageObjects))) throw new StorageFull()
      const written = await store.put(key, body, options)
      if (written !== null) { sizes.set(key, body.byteLength); bytes = nextBytes }
      return written
    }),
    delete: (key) => lock('capacity', async () => {
      await store.delete(key)
      bytes -= sizes.get(key) ?? 0
      sizes.delete(key)
    })
  }
}
