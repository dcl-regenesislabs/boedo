// The built-in prefabs, served next to editor.js (scripts/prefab-catalog.mjs).
// The catalog is held to the hash written into editor.js, and every file to the
// hash the catalog gives it, so a built-in is exactly what this editor shipped.
import type { LibraryFolder, LibraryTree } from './prefab-library'

export type VerifiedFetch = (url: string, integrity: string, name: string) => Promise<Response>

interface CatalogEntry {
  name: string
  data: string
  files: Record<string, { integrity: string; size: number }>
}

export function createBuiltinPrefabs(base: string, catalogIntegrity: string, load: VerifiedFetch): LibraryTree {
  let catalog: Promise<CatalogEntry[]> | null = null
  // built-ins never change under a running editor
  const read = new Map<string, Promise<Uint8Array>>()

  const entries = (): Promise<CatalogEntry[]> => {
    catalog ??= load(new URL('prefabs/catalog.json', base).href, catalogIntegrity, 'prefabs/catalog.json')
      .then(async (response) => (await response.json()) as CatalogEntry[])
      .catch((error: unknown) => {
        catalog = null
        throw error
      })
    return catalog
  }

  return {
    async folders(): Promise<LibraryFolder[]> {
      return (await entries()).map((entry) => ({
        name: entry.name,
        data: entry.data,
        files: Object.fromEntries(Object.entries(entry.files).map(([rel, file]) => [rel, file.size]))
      }))
    },
    async read(folder, rel) {
      const file = (await entries()).find((entry) => entry.name === folder.name)?.files[rel]
      if (file === undefined) throw new Error(`${folder.name}/${rel} is not a built-in prefab file`)
      const path = `prefabs/${folder.name}/${rel}`
      let bytes = read.get(path)
      if (bytes === undefined) {
        const url = new URL(path.split('/').map(encodeURIComponent).join('/'), base).href
        bytes = load(url, file.integrity, path).then(async (response) => new Uint8Array(await response.arrayBuffer()))
        read.set(path, bytes)
        bytes.catch(() => read.delete(path))
      }
      return bytes
    }
  }
}
