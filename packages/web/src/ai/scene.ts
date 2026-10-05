import { object } from '@dcl-editor/contract'
import { state, componentKey, isUiEntity } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { isAllowedComponent } from '@scene/allowed-components'
import { uiAddEntity } from '@ui/actions/entities'
import { uiSetComponentValue } from '@ui/actions/components'
import { runRequestText } from '@ui/ai/requests'
import { resolveEntityRef } from '@ui/ai/request-format'

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

export async function browserSceneRequest(request: unknown, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  if (!object(request)) throw new Error('Invalid scene request.')
  if (request.type === 'inspect') {
    const entries = Object.entries(state.snapshot).filter(([id]) => Number(id) >= 512 && !isUiEntity(state.snapshot, id))
    return {
      selected: [...state.selected], editMode: state.frozen, total: entries.length,
      entities: entries.slice(0, 150).map(([id, components]) => ({
        id, name: entityName(state.snapshot, id),
        components: Object.fromEntries(Object.entries(components).filter(([name]) => isAllowedComponent(name)))
      }))
    }
  }
  if (!state.frozen) throw new Error('Stop Play before changing the scene.')
  if (request.type === 'createEntity') {
    if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 100) throw new Error('Choose an entity name of 1–100 characters.')
    const parent = request.parent === undefined || request.parent === '0' ? 0 : Number(entity(request.parent))
    const before = new Set(Object.keys(state.snapshot))
    await uiAddEntity(request.name, parent)
    const id = state.activeEntity
    if (id === null || before.has(id)) throw new Error('The entity could not be created.')
    return { id, components: state.snapshot[id] }
  }
  if (request.type === 'setComponent') {
    const id = entity(request.to)
    const name = request.component
    if (typeof name !== 'string' || !isAllowedComponent(name) || !object(request.value) || !('expected' in request)) throw new Error('Invalid component update.')
    const previous = state.snapshot[id]?.[name] ?? null
    if (JSON.stringify(previous) !== JSON.stringify(request.expected)) throw new Error('This component changed. Inspect the scene and retry.')
    const key = componentKey(id, name)
    await uiSetComponentValue(key, id, name, JSON.stringify(toEngineValue(request.value)))
    if (state.editStatus.get(key) !== '✓ set') throw new Error('The editor could not apply that component.')
    return { id, component: name, value: state.snapshot[id]?.[name] }
  }
  if (!['attachScript', 'setParams', 'placePrefab'].includes(String(request.type))) throw new Error('Unsupported scene request.')
  if (request.type !== 'placePrefab') entity(request.to)
  return runRequestText(JSON.stringify({ version: 1, requests: [request] }), state.activeEntity)
}
