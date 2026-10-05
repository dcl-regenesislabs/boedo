// World storage service (env keys / data / players).
//
// Only meaningful for scenes with authoritativeMultiplayer: true. Storage is
// addressed per SCENE, not per world: sdk-commands' own buildStorageMetadata
// always sends `parcel` alongside the realm, taken from scene.base. Omitting it
// leaves the service to pick a default, which silently reads and writes whatever
// scene happens to stand on that ground. `parcel` is required in the type so no
// call can be built without one. ADR-44 signed like everything else.
import { getHost } from '../../engine/hosted'
import { storageUrl } from './endpoints'
import { signedFetch } from './signed-fetch'

export interface WorldStorageScope {
  realm: string // world name, lowercased
  parcel: string // a parcel of THIS scene's footprint
}
// A preview realm serving the toolchain's own storage routes (sdk-commands
// `start`): the scene's test data, unsigned, with no list of players or env
// keys; it bulk-deletes shared or one player's data.
export interface PreviewStorageScope {
  preview: string // the realm's url, no trailing slash
}
export type StorageScope = WorldStorageScope | PreviewStorageScope

export const isPreviewScope = (s: StorageScope): s is PreviewStorageScope => 'preview' in s

function storageMetadata(s: WorldStorageScope): Record<string, unknown> {
  return { realm: { serverName: s.realm }, realmName: s.realm, parcel: s.parcel }
}

export const STORAGE_PAGE = 50

export interface StoragePage<T> {
  items: T[]
  total: number
  offset: number
}

// friendlier error mapping for the storage service specifically
function storageError(status: number, preview: boolean): Error {
  if (preview && status === 404) return new Error('This preview is not serving its storage — is the scene running?')
  if (status === 401 || status === 403) return new Error('Only the world owner can manage storage')
  if (status === 413) return new Error('That value is too large for the storage service')
  if (status === 429) return new Error('Slowing down — the storage service is rate-limiting, try again in a moment')
  return new Error(`The request failed (${status}) — try again`)
}

interface StorageInit {
  method: string
  headers?: Record<string, string>
  body?: string
}

// the preview's storage answers its server copy alone; the host fetches as that copy
function previewReq(scope: PreviewStorageScope, path: string, init: StorageInit): Promise<Response> {
  const host = getHost()
  return host?.previewStorageFetch !== undefined ? host.previewStorageFetch(path, init) : fetch(`${scope.preview}${path}`, init)
}

async function storageReq(scope: StorageScope, path: string, init: StorageInit): Promise<Response> {
  const res = isPreviewScope(scope)
    ? await previewReq(scope, path, init)
    : await signedFetch(`${storageUrl()}${path}`, init, storageMetadata(scope))
  if (!res.ok) throw storageError(res.status, isPreviewScope(scope))
  return res
}

async function storageList<T>(scope: StorageScope, path: string, offset: number, pick: (b: unknown) => T[]): Promise<StoragePage<T>> {
  const res = await storageReq(scope, `${path}?limit=${STORAGE_PAGE}&offset=${offset}`, { method: 'GET' })
  const body = (await res.json()) as { data?: unknown; pagination?: { total?: number; offset?: number } }
  const items = pick(body.data)
  return {
    items,
    // trust the server's echo over what we asked for — if it ignores offset the
    // pager stays honest instead of relabeling page 1 as page N
    total: body.pagination?.total ?? items.length,
    offset: body.pagination?.offset ?? offset
  }
}

const asStrings = (d: unknown): string[] => (Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [])
const asKV = (d: unknown): Array<{ key: string; value: unknown }> =>
  Array.isArray(d) ? (d as Array<{ key: string; value: unknown }>).filter((x) => typeof x?.key === 'string') : []

// the scene's shared `/values` or one player's `/players/{addr}/values`
const valuesBase = (player?: string): string =>
  player !== undefined ? `/players/${encodeURIComponent(player)}/values` : '/values'

export const listEnvKeys = (scope: WorldStorageScope, offset = 0): Promise<StoragePage<string>> =>
  storageList(scope, '/env', offset, asStrings)
export const listStorageValues = (
  scope: StorageScope,
  offset = 0,
  player?: string
): Promise<StoragePage<{ key: string; value: unknown }>> => storageList(scope, valuesBase(player), offset, asKV)
export const listStoragePlayers = (scope: WorldStorageScope, offset = 0): Promise<StoragePage<string>> =>
  storageList(scope, '/players', offset, asStrings)

// fetch ONE value in full (the list may carry it, but this is the authoritative read)
export async function getStorageValue(scope: StorageScope, key: string, player?: string): Promise<unknown> {
  const res = await storageReq(scope, `${valuesBase(player)}/${encodeURIComponent(key)}`, { method: 'GET' })
  const body = (await res.json()) as { value?: unknown }
  return body.value
}

// create or overwrite a data value (any JSON) — world- or player-scoped
export async function putStorageValue(scope: StorageScope, key: string, value: unknown, player?: string): Promise<void> {
  await storageReq(scope, `${valuesBase(player)}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  })
}

export async function deleteStorageValue(scope: StorageScope, key: string, player?: string): Promise<void> {
  await storageReq(scope, `${valuesBase(player)}/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

export async function putEnvKey(scope: WorldStorageScope, key: string, value: string): Promise<void> {
  await storageReq(scope, `/env/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  })
}

export async function deleteEnvKey(scope: WorldStorageScope, key: string): Promise<void> {
  await storageReq(scope, `/env/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

// wipe a whole collection: all env keys, all shared data, every player's data,
// or one player's data (a preview clears only shared or one player's data)
export async function clearStorage(scope: StorageScope, target: 'env' | 'values' | 'players' | { player: string }): Promise<void> {
  const path = typeof target === 'string' ? `/${target}` : valuesBase(target.player)
  await storageReq(scope, path, { method: 'DELETE', headers: { 'X-Confirm-Delete-All': 'true' } })
}
