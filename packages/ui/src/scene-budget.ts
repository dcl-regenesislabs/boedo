// The scene against the per-parcel limits; each placed copy of a model counts again.
import { object } from '@dcl-editor/contract'
import { state, isRuntimeEntity, isUiEntity, provenanceBaseline } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { dataLayerPathTick, dataLayerReadFileBytes, dataLayerRealm } from './engine/datalayer'
import { inspectModel } from './model-info'

const MB = 1024 * 1024
// a primitive's triangles as the engine meshes it
const PRIMITIVE_TRIANGLES: Record<string, number> = { box: 12, plane: 2, cylinder: 128, sphere: 960 }

// Soft caps the explorers warn about. Size has none here: what a deployment accepts depends on where it goes.
export function parcelLimits(parcels: number) {
  const log = Math.log2(parcels + 1)
  return { triangles: parcels * 10_000, entities: parcels * 200, bodies: parcels * 300, textures: Math.floor(log * 10) }
}

type Counts = { triangles: number; primitives: number; materials: number; textures: number; bytes: number; shared: string[]; clips: string[]; warnings: string[] }
// The bytes a deployment would carry, from the host that knows the publish rules; without one only
// the placed model files are counted.
let publishedBytes: (() => Promise<number>) | null = null
export function setPublishedSize(measure: (() => Promise<number>) | null): void {
  publishedBytes = measure
}

const counted = new Map<string, { tick: number; counts: Promise<Counts | null> }>()
// another project's files share no paths with this one's
let countedIn: string | null = null

function countFile(src: string): Promise<Counts | null> {
  const realm = dataLayerRealm() ?? ''
  if (realm !== countedIn) {
    counted.clear()
    countedIn = realm
  }
  // only a write or removal of this path can change what it holds
  const tick = dataLayerPathTick(src)
  const cached = counted.get(src)
  if (cached !== undefined && cached.tick === tick) return cached.counts
  const pending: Promise<Counts | null> = dataLayerReadFileBytes(src).then((bytes) => {
    const info = inspectModel(bytes)
    // a texture file beside the model, resolved to its project path so models sharing it count it once
    const dir = src.slice(0, src.lastIndexOf('/') + 1)
    const shared = info.sharedImages.map((uri) => new URL(uri, `file:///${dir}`).pathname.slice(1))
    return { triangles: info.triangles, primitives: info.primitives, materials: info.materials.length, textures: info.textures - shared.length, bytes: bytes.byteLength, shared, clips: info.animations, warnings: info.warnings }
  }).catch(() => {
    // unreadable or not a model: reported as missing, and read again next time
    counted.delete(src)
    return null
  })
  counted.set(src, { tick, counts: pending })
  return pending
}

function authoredEntities(): [string, Record<string, unknown>][] {
  const baseline = provenanceBaseline()
  return Object.entries(state.snapshot)
    .filter(([id]) => Number(id) >= 512 && !isRuntimeEntity(id, baseline) && !isUiEntity(state.snapshot, id))
}

export interface ModelRow {
  src: string
  entities: { id: string; name: string }[]
  triangles: number
  materials: number
  textures: number
  // texture files beside the model, shared with other models
  shared: number
  kb: number
  clips: string[]
  warnings: string[]
}

// One row per model file the scene places, with every entity that places it.
export async function sceneModels(): Promise<ModelRow[]> {
  const bySrc = new Map<string, { id: string; name: string }[]>()
  for (const [id, components] of authoredEntities()) {
    const gltf = components.GltfContainer
    if (!object(gltf) || typeof gltf.src !== 'string') continue
    bySrc.set(gltf.src, [...(bySrc.get(gltf.src) ?? []), { id, name: entityName(state.snapshot, id) ?? `#${id}` }])
  }
  const rows: ModelRow[] = []
  for (const [src, entities] of bySrc) {
    const counts = await countFile(src)
    rows.push(counts === null
      ? { src, entities, triangles: 0, materials: 0, textures: 0, shared: 0, kb: 0, clips: [], warnings: ['The file is missing or not a readable model.'] }
      : { src, entities, triangles: counts.triangles, materials: counts.materials, textures: counts.textures, shared: counts.shared.length, kb: Math.round(counts.bytes / 1024), clips: counts.clips, warnings: counts.warnings })
  }
  return rows.sort((a, b) => b.triangles * b.entities.length - a.triangles * a.entities.length)
}

// What the scene's models already spend of its texture limit, and which shared files they point at:
// a new model's shared file costs nothing when another model already uses it.
export async function sceneTextures(): Promise<{ used: number; limit: number; shared: ReadonlySet<string> }> {
  const files = new Map<string, Counts>()
  for (const [, components] of authoredEntities()) {
    const gltf = components.GltfContainer
    if (!object(gltf) || typeof gltf.src !== 'string' || files.has(gltf.src)) continue
    const counts = await countFile(gltf.src)
    if (counts !== null) files.set(gltf.src, counts)
  }
  const shared = new Set([...files.values()].flatMap((f) => f.shared))
  const used = [...files.values()].reduce((n, f) => n + f.textures, 0) + shared.size
  return { used, limit: parcelLimits(Math.max(1, state.scene?.parcels.length ?? 1)).textures, shared }
}

export async function sceneBudget() {
  const parcels = Math.max(1, state.scene?.parcels.length ?? 1)
  const limits = parcelLimits(parcels)
  const authored = authoredEntities()
  let triangles = 0
  let bodies = 0
  const files = new Map<string, Counts>()
  const materials = new Set<string>()
  for (const [, components] of authored) {
    const gltf = components.GltfContainer
    if (object(gltf) && typeof gltf.src === 'string') {
      const counts = await countFile(gltf.src)
      if (counts !== null) { triangles += counts.triangles; bodies += counts.primitives; files.set(gltf.src, counts) }
    }
    const mesh = components.MeshRenderer
    if (object(mesh) && object(mesh.mesh)) {
      triangles += PRIMITIVE_TRIANGLES[Object.keys(mesh.mesh)[0] ?? ''] ?? 0
      bodies++
    }
    if (components.Material !== undefined) materials.add(JSON.stringify(components.Material))
  }
  const modelBytes = [...files.values()].reduce((n, f) => n + f.bytes, 0)
  const used = {
    triangles,
    entities: authored.length,
    bodies,
    materials: materials.size + [...files.values()].reduce((n, f) => n + f.materials, 0),
    textures: [...files.values()].reduce((n, f) => n + f.textures, 0) + new Set([...files.values()].flatMap((f) => f.shared)).size,
    megabytes: Math.round((publishedBytes !== null ? await publishedBytes().catch(() => modelBytes) : modelBytes) / MB * 10) / 10
  }
  const over = (Object.keys(limits) as (keyof typeof limits)[]).filter((key) => used[key] > limits[key])
  return {
    parcels, used, limits, over,
    megabytesOf: publishedBytes !== null ? 'every file a deployment carries, before the scene build adds its code' : 'placed model files only',
    note: 'soft limits: explorers warn above them. megabytes is the deploy size, uncapped here (see megabytesOf); materials are uncapped.'
  }
}
