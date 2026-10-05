import { describe, expect, it, vi } from 'vitest'
import { browserSceneRequest } from './scene'

const { setValue, status } = vi.hoisted(() => {
  const status = new Map<string, string>()
  const setValue = vi.fn(async () => {
    status.set('512:Material', '✓ set')
  })
  return { setValue, status }
})
vi.mock('@scene/state', () => ({
  state: { snapshot: { '512': {} }, frozen: true, selected: new Set(), editStatus: status, activeEntity: null },
  componentKey: (id: string, name: string) => `${id}:${name}`,
  isUiEntity: () => false
}))
vi.mock('@scene/custom-components', () => ({ entityName: () => 'Box' }))
vi.mock('@scene/allowed-components', () => ({ isAllowedComponent: () => true }))
vi.mock('@ui/actions/entities', () => ({ uiAddEntity: vi.fn() }))
vi.mock('@ui/actions/components', () => ({ uiSetComponentValue: setValue }))
vi.mock('@ui/ai/requests', () => ({ runRequestText: vi.fn() }))
vi.mock('@ui/ai/request-format', () => ({ resolveEntityRef: (_: unknown, ref: string) => ref }))

describe('assistant scene requests', () => {
  it('writes a oneof the model gave in the SDK form the way the engine reads it', async () => {
    const green = { r: 0.1, g: 0.8, b: 0.2, a: 1 }
    await browserSceneRequest(
      { type: 'setComponent', to: '512', component: 'Material', value: { material: { $case: 'pbr', pbr: { albedoColor: green } } }, expected: null },
      new AbortController().signal
    )
    expect(setValue).toHaveBeenCalledWith('512:Material', '512', 'Material', JSON.stringify({ material: { pbr: { albedoColor: green } } }))
  })
})
