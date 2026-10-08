import { object } from '@dcl-editor/contract'
import { state, componentKey, isUiEntity } from '@scene/state'
import { buildFromSchema, getSchema, type ComponentSchema } from '@scene/schema'
import { cmd } from '@ui/engine/cmd'
import { entityName, NAME_COMPONENT } from '@scene/custom-components'
import { isAllowedComponent } from '@scene/allowed-components'
import { uiAddEntity } from '@ui/actions/entities'
import { uiDeleteComponent, uiSetComponentValue } from '@ui/actions/components'
import { importCatalogFile, loadModelCatalog, modelById, type ModelAsset } from '@ui/assets'
import { sendToScene } from '@ui/engine/bus'
import { runRequestText } from '@ui/ai/requests'
import { resolveEntityRef } from '@ui/ai/request-format'
import { sceneOutline } from '@ui/ai/roster'
import { refreshSceneChecks } from '@ui/features/editor/scene-check-context'
import type { AssistantSceneSettings } from '../shell/scene-json'

function entity(ref: unknown): string {
  if (typeof ref !== 'string') throw new Error('An entity id or unique name is required.')
  const id = resolveEntityRef(state.snapshot, ref)
  if (id === null || Number(id) < 512 || isUiEntity(state.snapshot, id)) throw new Error('No editable entity matches that reference.')
  return id
}

// The engine reads a protobuf oneof as `{ pbr: {...} }`; models often write the SDK's `{ $case: 'pbr', pbr: {...} }`
function toEngineValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toEngineValue)
  if (!object(value)) return value
  if (typeof value.$case === 'string') return { [value.$case]: toEngineValue(value[value.$case]) }
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, toEngineValue(field)]))
}

const schemas = new Map<string, Promise<ComponentSchema | null>>()

function schemaOf(name: string): Promise<ComponentSchema | null> {
  const cached = getSchema(name)
  if (cached !== undefined) return Promise.resolve(cached)
  let pending = schemas.get(name)
  if (pending === undefined) {
    pending = cmd.componentSchema(name).then((reply) => JSON.parse(reply) as ComponentSchema, () => null)
    schemas.set(name, pending)
  }
  return pending
}

// a patch lays its fields over the current value, object by object: {position:{y:3}} moves one axis
function merged(current: unknown, patch: unknown): unknown {
  if (!object(current) || !object(patch)) return patch
  const out: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) out[key] = merged(current[key], value)
  return out
}

async function setComponent(id: string, name: unknown, value: unknown, expected: unknown, patch = false): Promise<void> {
  if (typeof name !== 'string' || !isAllowedComponent(name) || !object(value)) throw new Error('Invalid component update.')
  const previous = state.snapshot[id]?.[name] ?? null
  // a patch needs no inspect first: it is applied to whatever the component holds now
  if (!patch && JSON.stringify(previous) !== JSON.stringify(expected)) throw new Error('This component changed. Inspect the scene and retry.')
  const key = componentKey(id, name)
  let engineValue = toEngineValue(patch ? merged(previous, value) : value)
  // Transform has no engine schema to fill from; every entity already has a whole one
  if (name === 'Transform' && object(engineValue) && object(previous)) engineValue = { ...previous, ...engineValue }
  // the engine refuses a value missing any field, as the inspector's own writes never are
  const schema = await schemaOf(name)
  const built = schema === null ? null : buildFromSchema(key, schema, engineValue)
  await uiSetComponentValue(key, id, name, built?.ok === true ? built.json : JSON.stringify(engineValue))
  if (state.editStatus.get(key) !== '✓ set') throw new Error('The editor could not apply that component.')
}

const MAX_MODEL_MATCHES = 20
const metre = (n: number | undefined) => Math.round((n ?? 0) * 10) / 10
const sizeOf = (a: ModelAsset) => ({ x: metre(a.width), y: metre(a.height), z: metre(a.depth) })
const describe = (a: ModelAsset) => ({
  id: a.id, name: a.name, category: a.subcategory === undefined ? a.category : `${a.category}/${a.subcategory}`, size: sizeOf(a),
  triangles: a.triangles ?? null, kb: Math.round((a.fileSize ?? 0) / 1024), tags: a.tags.slice(0, 6),
  ...((a.animations?.length ?? 0) > 0 ? { animations: a.animations } : {})
})

// words of the query against name, subcategory, tags and description; lighter models first among equals
function findModels(assets: ModelAsset[], query: string, limit: number): ModelAsset[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
  if (words.length === 0) return []
  const scored = assets.map((a) => {
    const name = a.name.toLowerCase()
    const tags = a.tags.join(' ').toLowerCase()
    const text = `${a.subcategory ?? ''} ${a.description ?? ''}`.toLowerCase()
    let score = 0
    for (const w of words) score += (name.includes(w) ? 3 : 0) + (tags.includes(w) ? 2 : 0) + (text.includes(w) ? 1 : 0)
    return { a, score }
  }).filter((s) => s.score > 0)
  scored.sort((p, q) => q.score - p.score || (p.a.triangles ?? 0) - (q.a.triangles ?? 0))
  return scored.slice(0, limit).map((s) => s.a)
}

export type SceneSettingsEditor = (settings: AssistantSceneSettings) => Promise<unknown>

const MAX_BATCH = 200

export async function browserSceneRequest(request: unknown, signal: AbortSignal, settings?: SceneSettingsEditor): Promise<unknown> {
  signal.throwIfAborted()
  if (!object(request)) throw new Error('Invalid scene request.')
  if (request.type === 'batch') {
    if (!Array.isArray(request.requests) || request.requests.length === 0 || request.requests.length > MAX_BATCH) {
      throw new Error(`A batch needs 1–${MAX_BATCH} requests.`)
    }
    // one failure doesn't stop the rest: each later request may not depend on it
    const results: unknown[] = []
    for (const item of request.requests) {
      if (object(item) && item.type === 'batch') throw new Error('Batches do not nest.')
      try {
        results.push({ ok: true, result: await browserSceneRequest(item, signal, settings) })
      } catch (e) {
        signal.throwIfAborted()
        results.push({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return { results }
  }
  if (request.type === 'sceneSettings') {
    if (settings === undefined) throw new Error('Scene settings cannot be changed here.')
    return settings({ permissions: request.permissions, spawnPoints: request.spawnPoints, parcels: request.parcels, base: request.base })
  }
  if (request.type === 'outline') {
    return sceneOutline(state.snapshot, {
      match: typeof request.match === 'string' ? request.match : undefined,
      offset: typeof request.offset === 'number' ? request.offset : undefined
    })
  }
  if (request.type === 'check') {
    // the editor's own scene checks, as the Scene checks card shows them
    const findings = await refreshSceneChecks()
    return {
      findings: findings.map((f) => ({
        level: f.level, title: f.title, detail: f.detail,
        ...(f.entityId === undefined ? {} : { entity: entityName(state.snapshot, f.entityId) ?? f.entityId })
      }))
    }
  }
  if (request.type === 'inspect') {
    // a big scene doesn't fit one answer: match narrows by name, offset pages through the rest
    const match = typeof request.match === 'string' ? request.match.toLowerCase() : ''
    const offset = typeof request.offset === 'number' && request.offset > 0 ? Math.floor(request.offset) : 0
    const entries = Object.entries(state.snapshot).filter(([id]) =>
      Number(id) >= 512 && !isUiEntity(state.snapshot, id) && (entityName(state.snapshot, id) ?? '').toLowerCase().includes(match))
    return {
      selected: [...state.selected], editMode: state.frozen, total: entries.length, offset,
      entities: entries.slice(offset, offset + 150).map(([id, components]) => ({
        id, name: entityName(state.snapshot, id),
        components: Object.fromEntries(Object.entries(components).filter(([name]) => isAllowedComponent(name)))
      }))
    }
  }
  if (request.type === 'findModels') {
    if (typeof request.query !== 'string') throw new Error('findModels needs query: a few words.')
    const limit = Math.min(MAX_MODEL_MATCHES, Math.max(1, Number(request.limit ?? 8) || 8))
    const assets = await loadModelCatalog()
    return { models: findModels(assets, request.query, limit).map(describe), total: assets.length }
  }
  if (!state.frozen) throw new Error('Stop Play before changing the scene.')
  if (request.type === 'placeModel') {
    if (typeof request.id !== 'string') throw new Error('placeModel needs the id of a findModels result.')
    await loadModelCatalog()
    const asset = modelById(request.id)
    if (asset === undefined) throw new Error('No catalog model has that id. Use findModels.')
    const rel = await importCatalogFile(asset)
    // the model's own meshes collide: catalog models carry no collider meshes
    const gltf = { src: rel, visibleMeshesCollisionMask: 3 }
    const pose = Object.fromEntries((['position', 'rotation', 'scale'] as const).filter((k) => object(request[k])).map((k) => [k, request[k]]))
    try {
      if (request.into !== undefined) {
        const id = entity(request.into)
        await setComponent(id, 'GltfContainer', gltf, null, true)
        for (const name of ['MeshRenderer', 'Material', 'MeshCollider']) if (state.snapshot[id]?.[name] !== undefined) uiDeleteComponent(id, name)
        // a stand-in's scale was its size; the model has its own
        await setComponent(id, 'Transform', { scale: { x: 1, y: 1, z: 1 }, ...pose }, null, true)
        return { id, model: rel, size: sizeOf(asset), components: state.snapshot[id] }
      }
      const created = await browserSceneRequest({
        type: 'createEntity', name: request.name ?? asset.name, parent: request.parent,
        components: { Transform: { position: { x: 8, y: 0, z: 8 }, ...pose }, GltfContainer: gltf }
      }, signal, settings)
      return { ...(object(created) ? created : {}), model: rel, size: sizeOf(asset) }
    } finally {
      // new content can re-instance the scene, which drops the editor's pick colliders
      void sendToScene({ type: 'resync' })
    }
  }
  if (request.type === 'createEntity') {
    if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 100) throw new Error('Choose an entity name of 1–100 characters.')
    const parent = request.parent === undefined || request.parent === '0' ? 0 : Number(entity(request.parent))
    const before = new Set(Object.keys(state.snapshot))
    if (request.components !== undefined && !object(request.components)) throw new Error('components must map component names to values.')
    await uiAddEntity(request.name, parent)
    const id = state.activeEntity
    if (id === null || before.has(id)) throw new Error('The entity could not be created.')
    const failed: string[] = []
    for (const [name, value] of Object.entries(request.components ?? {})) {
      try {
        await setComponent(id, name, value, state.snapshot[id]?.[name] ?? null)
      } catch (e) {
        failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { id, components: state.snapshot[id], ...(failed.length > 0 ? { failed } : {}) }
  }
  if (request.type === 'move') {
    // a relative move needs no lookup: "raise it a metre" is one request
    const id = entity(request.to)
    const by = request.by
    if (!object(by) || !['x', 'y', 'z'].some((k) => typeof by[k] === 'number')) throw new Error('move needs by: {x, y, z} in metres.')
    const current = state.snapshot[id]?.Transform
    const position = object(current) && object(current.position) ? current.position : { x: 0, y: 0, z: 0 }
    const next = Object.fromEntries((['x', 'y', 'z'] as const).map((k) => [k, Number(position[k] ?? 0) + (typeof by[k] === 'number' ? by[k] : 0)]))
    await setComponent(id, 'Transform', { position: next }, null, true)
    return { id, position: next }
  }
  if (request.type === 'setComponent') {
    const id = entity(request.to)
    if ('patch' in request) await setComponent(id, request.component, request.patch, null, true)
    else {
      if (!('expected' in request)) throw new Error('Invalid component update.')
      await setComponent(id, request.component, request.value, request.expected)
    }
    return { id, component: request.component, value: state.snapshot[id]?.[String(request.component)] }
  }
  if (request.type === 'removeComponent') {
    const id = entity(request.to)
    const name = request.component
    // isAllowedComponent admits Transform and the name, which every entity must keep
    if (typeof name !== 'string' || !isAllowedComponent(name) || name === 'Transform' || name === NAME_COMPONENT) throw new Error('That component cannot be removed.')
    if (state.snapshot[id]?.[name] === undefined) return { id, component: name, removed: false }
    uiDeleteComponent(id, name)
    return { id, component: name, components: state.snapshot[id] }
  }
  if (!['attachScript', 'setParams', 'placePrefab'].includes(String(request.type))) throw new Error('Unsupported scene request.')
  if (request.type !== 'placePrefab') entity(request.to)
  return runRequestText(JSON.stringify({ version: 1, requests: [request] }), state.activeEntity)
}
