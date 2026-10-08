import { describe, expect, it, vi } from 'vitest'
import { browserSceneRequest } from './scene'
import { state } from '@scene/state'

const { setValue, deleteValue, status } = vi.hoisted(() => {
  const status = new Map<string, string>()
  const setValue = vi.fn(async (key: string) => {
    status.set(key, '✓ set')
  })
  const deleteValue = vi.fn()
  return { setValue, deleteValue, status }
})
vi.mock('@scene/state', () => ({
  state: { snapshot: { '512': {} }, frozen: true, selected: new Set(), editStatus: status, activeEntity: null, schemas: new Map() },
  componentKey: (id: string, name: string) => `${id}:${name}`,
  isUiEntity: () => false
}))
vi.mock('@scene/custom-components', () => ({ entityName: () => 'Box', NAME_COMPONENT: 'core::Name' }))
vi.mock('@ui/engine/cmd', () => ({ cmd: { componentSchema: () => Promise.reject(new Error('no engine')) } }))
vi.mock('@scene/allowed-components', () => ({ isAllowedComponent: () => true }))
vi.mock('@ui/actions/entities', () => ({ uiAddEntity: vi.fn() }))
vi.mock('@ui/actions/components', () => ({ uiSetComponentValue: setValue, uiDeleteComponent: deleteValue }))
vi.mock('@ui/ai/requests', () => ({ runRequestText: vi.fn() }))
vi.mock('@ui/ai/request-format', () => ({ resolveEntityRef: (_: unknown, ref: string) => ref }))
vi.mock('@ui/features/editor/scene-check-context', () => ({
  refreshSceneChecks: async () => [{ id: 'empty-prefab-ref', level: 'blocker', title: 'Nothing picked', detail: 'Pick a prefab', entityId: '512', fix: { label: 'x', action: 'y' } }]
}))

describe('assistant scene requests', () => {
  it('writes a oneof the model gave in the SDK form the way the engine reads it', async () => {
    const green = { r: 0.1, g: 0.8, b: 0.2, a: 1 }
    await browserSceneRequest(
      { type: 'setComponent', to: '512', component: 'Material', value: { material: { $case: 'pbr', pbr: { albedoColor: green } } }, expected: null },
      new AbortController().signal
    )
    expect(setValue).toHaveBeenCalledWith('512:Material', '512', 'Material', JSON.stringify({ material: { pbr: { albedoColor: green } } }))
  })

  it('answers check with the editor\'s findings, naming the entity each one is about', async () => {
    expect(await browserSceneRequest({ type: 'check' }, new AbortController().signal)).toEqual({
      findings: [{ level: 'blocker', title: 'Nothing picked', detail: 'Pick a prefab', entity: 'Box' }]
    })
  })

  it('applies a patch over the current value without an inspect, and keeps the rest', async () => {
    setValue.mockClear()
    state.snapshot['512'] = { Transform: { position: { x: 1, y: 0.5, z: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parent: 0 } }
    await browserSceneRequest(
      { type: 'setComponent', to: '512', component: 'Transform', patch: { position: { y: 3.5 } } },
      new AbortController().signal
    )
    expect(JSON.parse(String((setValue.mock.calls as unknown[][]).at(-1)?.[3]))).toMatchObject({ position: { x: 1, y: 3.5, z: 1 }, scale: { x: 1, y: 1, z: 1 } })
  })

  it('moves an entity by an offset in one request', async () => {
    state.snapshot['512'] = { Transform: { position: { x: 1, y: 0.5, z: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parent: 0 } }
    expect(await browserSceneRequest({ type: 'move', to: '512', by: { y: 2 } }, new AbortController().signal)).toEqual({ id: '512', position: { x: 1, y: 2.5, z: 1 } })
    await expect(browserSceneRequest({ type: 'move', to: '512', by: {} }, new AbortController().signal)).rejects.toThrow('move needs')
  })

  it('removes a component through the editor action, but never Transform or the name', async () => {
    state.snapshot['512'] = { Transform: { position: { x: 1, y: 0.5, z: 1 } }, MeshRenderer: { mesh: { box: {} } } }
    deleteValue.mockImplementation((id: string, name: string) => { delete state.snapshot[id][name] })
    expect(await browserSceneRequest({ type: 'removeComponent', to: '512', component: 'MeshRenderer' }, new AbortController().signal))
      .toEqual({ id: '512', component: 'MeshRenderer', components: { Transform: { position: { x: 1, y: 0.5, z: 1 } } } })
    expect(deleteValue).toHaveBeenCalledWith('512', 'MeshRenderer')
    expect(await browserSceneRequest({ type: 'removeComponent', to: '512', component: 'Material' }, new AbortController().signal)).toEqual({ id: '512', component: 'Material', removed: false })
    for (const component of ['Transform', 'core::Name']) {
      await expect(browserSceneRequest({ type: 'removeComponent', to: '512', component }, new AbortController().signal)).rejects.toThrow('cannot be removed')
    }
    expect(deleteValue).toHaveBeenCalledTimes(1)
  })
})

