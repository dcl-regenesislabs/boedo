import { beforeEach, expect, it, vi } from 'vitest'
import { prefabStore, refreshPrefabs, resetProjectPrefabs, groupPrefabCards } from './prefab-store'

const host = vi.hoisted(() => ({
  list: vi.fn<() => Promise<string[]>>(),
  thumbnail: vi.fn<() => Promise<Uint8Array>>()
}))
vi.mock('../engine/datalayer', () => ({
  dataLayerAvailable: () => true,
  dataLayerListFiles: host.list,
  dataLayerReadFileBytes: host.thumbnail,
  probeDataLayer: () => true
}))
vi.mock('../prefabs/storage', () => ({
  prefabFoldersIn: (files: string[]) => files.filter(p => p.endsWith('/data.json')).map(p => p.slice(0, -10)),
  readPrefabFolder: async (folder: string) => ({
    data: { id: folder, name: folder, version: '1.0.0' }, composite: { components: [] }
  })
}))
vi.mock('../prefabs/library', () => ({ libraryAvailable: () => false, listLibrary: async () => [] }))
vi.mock('./views/prefab-options', () => ({ compositeCarriesSpawner: () => false }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  resetProjectPrefabs()
  vi.clearAllMocks()
})

it('lists the new scene instead of retaining the previous scene library', async () => {
  host.list.mockResolvedValueOnce(['custom/old/data.json'])
  await refreshPrefabs()
  expect(prefabStore.items.map(p => p.folder)).toEqual(['custom/old'])
  resetProjectPrefabs()
  expect(prefabStore.loaded).toBe(false)
  expect(prefabStore.items).toEqual([])
  host.list.mockResolvedValueOnce(['custom/new/data.json'])
  await refreshPrefabs()
  expect(prefabStore.items.map(p => p.folder)).toEqual(['custom/new'])
})

it('ignores a listing from a scene that closed while it was loading', async () => {
  const old = deferred<string[]>()
  host.list.mockReturnValueOnce(old.promise)
  const pending = refreshPrefabs()
  resetProjectPrefabs()
  host.list.mockResolvedValueOnce(['custom/new/data.json'])
  await refreshPrefabs()
  old.resolve(['custom/old/data.json'])
  await pending
  expect(prefabStore.items.map(p => p.folder)).toEqual(['custom/new'])
})

it('does not reuse an old scene thumbnail at the same prefab path', async () => {
  const old = deferred<Uint8Array>()
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new')
  host.list.mockResolvedValue(['custom/shared/data.json', 'custom/shared/thumbnail.png'])
  host.thumbnail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(new Uint8Array([2]))
  await refreshPrefabs()
  resetProjectPrefabs()
  await refreshPrefabs()
  old.resolve(new Uint8Array([1]))
  await Promise.resolve()
  expect(host.thumbnail).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenCalledTimes(1)
  expect(prefabStore.items[0].thumbnail).toBe('blob:new')
  create.mockRestore()
})

it('shows game and UI prefabs individually while keeping large asset collections grouped', () => {
  const card = (name: string, group: string) => ({ data: { id: name, name, group, category: 'custom' as const, tags: [] } })
  const game = ['Server Clock', 'Leaderboard', 'Health & Respawn', 'Run Progress'].map(name => card(name, 'Multiplayer Server'))
  const theme = card('UI Theme', 'Scene UI')
  const seats = Array.from({ length: 23 }, (_, i) => card(`Seat ${i}`, 'Seats'))
  const grouped = groupPrefabCards([...game, theme, ...seats], true)
  expect(grouped.singles).toEqual([...game, theme])
  expect([...grouped.groups.keys()]).toEqual(['Seats'])
})
