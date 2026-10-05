// The signed-in wallet's own prefab library, kept by the project service
// (/prefabs): a folder saved from a project, read back to be placed in another.
import type { PrefabLibraryEntry } from '@dcl-editor/contract'
import { type ManifestFiles, PrefabNameTaken, type PrefabsApi, type RemotePrefab } from '../sync/api'
import { type LibraryFolder, type LibraryTree, type ProjectFiles, parseData, prefabName, prefabSlug } from './prefab-library'

const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'dist'])
// data.json and thumbnails: read on every listing, so kept for the session
const CACHED_BYTES = 300 * 1024
const MAX_NAME = 56
const NAME_ATTEMPTS = 5

// An imported or GitHub-pinned prefab keeps where it came from; anything else becomes the creator's.
function libraryOrigin(data: Record<string, unknown>): Record<string, unknown> {
  const origin = data.origin
  const record = typeof origin === 'object' && origin !== null && !Array.isArray(origin) ? (origin as Record<string, unknown>) : null
  if (record !== null && (record.source === 'import' || record.source === 'github')) return record
  return { ...(record ?? {}), source: 'user' }
}

export function createUserPrefabs(api: PrefabsApi, hash: (bytes: Uint8Array) => Promise<string>) {
  const cached = new Map<string, Promise<Uint8Array>>()
  let remote = new Map<string, RemotePrefab>()

  function blob(name: string, file: { hash: string; size: number }): Promise<Uint8Array> {
    if (file.size > CACHED_BYTES) return api.blob(name, file.hash)
    let bytes = cached.get(file.hash)
    if (bytes === undefined) {
      bytes = api.blob(name, file.hash)
      cached.set(file.hash, bytes)
      bytes.catch(() => cached.delete(file.hash))
    }
    return bytes
  }

  const tree: LibraryTree = {
    async folders() {
      const listed = await api.list()
      remote = new Map(listed.map((prefab) => [prefab.name, prefab]))
      const folders = await Promise.all(
        listed.map(async (prefab): Promise<LibraryFolder | null> => {
          const data = prefab.files['data.json']
          if (data === undefined) return null
          const text = await blob(prefab.name, data).then((bytes) => new TextDecoder().decode(bytes), () => null)
          if (text === null) return null
          const files = Object.fromEntries(Object.entries(prefab.files).map(([rel, file]) => [rel, file.size]))
          return { name: prefab.name, data: text, files }
        })
      )
      return folders.filter((folder): folder is LibraryFolder => folder !== null)
    },
    async read(folder, rel) {
      const file = remote.get(folder.name)?.files[rel]
      if (file === undefined) throw new Error(`${folder.name}/${rel} is not in your library`)
      return blob(folder.name, file)
    }
  }

  async function save(name: string, files: Map<string, Uint8Array>): Promise<void> {
    const manifest: ManifestFiles = {}
    const byHash = new Map<string, Uint8Array>()
    for (const [rel, bytes] of files) {
      const id = await hash(bytes)
      manifest[rel] = { hash: id, size: bytes.length }
      byHash.set(id, bytes)
    }
    const unique = [...byHash].map(([id, bytes]) => ({ hash: id, size: bytes.length }))
    for (const upload of await api.uploads(name, unique)) {
      const bytes = byHash.get(upload.hash)
      if (bytes !== undefined) await api.putBlob(upload, bytes)
    }
    await api.put(name, manifest)
  }

  return {
    tree,

    async copyOut(project: ProjectFiles, folder: string): Promise<PrefabLibraryEntry> {
      const [root, base, extra] = folder.split('/')
      if (root !== 'custom' || base === undefined || extra !== undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base)) {
        throw new Error(`not a prefab folder: ${folder}`)
      }
      const prefix = `${folder}/`
      const files = new Map<string, Uint8Array>()
      for (const [path, bytes] of project.files()) {
        const rel = path.slice(prefix.length)
        if (path.startsWith(prefix) && !rel.split('/').some((segment) => SKIP_DIRS.has(segment))) files.set(rel, bytes)
      }
      const raw = files.get('data.json')
      const data = raw === undefined ? null : parseData(new TextDecoder().decode(raw))
      if (data === null) throw new Error(`${folder} has no readable data.json`)
      const stamped = { ...data, id: typeof data.id === 'string' ? data.id : crypto.randomUUID(), origin: libraryOrigin(data) }
      const text = `${JSON.stringify(stamped, null, 2)}\n`
      files.set('data.json', new TextEncoder().encode(text))

      const wanted = prefabSlug(prefabName(data, base)).slice(0, MAX_NAME).replace(/_+$/, '') || 'prefab'
      const taken = new Set((await api.list()).map((prefab) => prefab.name))
      let n = 1
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
        let name = wanted
        while (taken.has(name)) name = `${wanted}_${++n}`
        try {
          await save(name, files)
          return { ref: `user:${name}`, scope: 'user', data: text }
        } catch (error) {
          if (!(error instanceof PrefabNameTaken)) throw error
          taken.add(name)
        }
      }
      throw new Error('could not find a free name in your library — try again')
    },

    remove: (name: string): Promise<boolean> => api.remove(name)
  }
}
