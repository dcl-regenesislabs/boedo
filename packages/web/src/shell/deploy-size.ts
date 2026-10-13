import { LOCK_FILE, publishableFiles } from '@dcl-editor/web-build'

// a file's content id, worked out once per version of the file
const contentKeys = new WeakMap<Uint8Array, Promise<string>>()
function contentKey(bytes: Uint8Array): Promise<string> {
  let key = contentKeys.get(bytes)
  if (key === undefined) {
    key = crypto.subtle.digest('SHA-256', new Uint8Array(bytes)).then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''))
    contentKeys.set(bytes, key)
  }
  return key
}

// The bytes and files a publish would upload: what .dclignore keeps, identical files stored once as publishing does by content id.
export async function publishedSize(files: Map<string, Uint8Array>): Promise<{ bytes: number; files: number }> {
  const dclignore = files.get('.dclignore')
  const kept = publishableFiles(files.keys(), dclignore === undefined ? undefined : new TextDecoder().decode(dclignore)).filter((path) => path !== LOCK_FILE)
  const unique = new Map<string, number>()
  for (const path of kept) {
    const bytes = files.get(path)
    if (bytes !== undefined) unique.set(await contentKey(bytes), bytes.byteLength)
  }
  return { bytes: [...unique.values()].reduce((total, size) => total + size, 0), files: unique.size }
}
