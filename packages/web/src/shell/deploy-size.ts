import { LOCK_FILE, publishableFiles } from '@dcl-editor/scene-compiler'

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

// What a publish would upload: the bytes once per content, as publishing stores identical files once, and every
// path as a file, as the deployment's content list and its file limit count them.
export async function publishedSize(files: Map<string, Uint8Array>): Promise<{ bytes: number; files: number }> {
  const dclignore = files.get('.dclignore')
  const kept = publishableFiles(files.keys(), dclignore === undefined ? undefined : new TextDecoder().decode(dclignore)).filter((path) => path !== LOCK_FILE)
  const unique = new Map<string, number>()
  let paths = 0
  for (const path of kept) {
    const bytes = files.get(path)
    if (bytes === undefined) continue
    unique.set(await contentKey(bytes), bytes.byteLength)
    paths++
  }
  return { bytes: [...unique.values()].reduce((total, size) => total + size, 0), files: paths }
}
