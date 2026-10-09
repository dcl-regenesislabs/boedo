import { describe, expect, it, vi } from 'vitest'
import type { Entity, Transport } from '@dcl/sdk/ecs'

const host = vi.hoisted(() => ({
  sealed: false,
  config: new Map<number, Record<string, string>>(),
  bindings: new Map<number, Record<string, string>>(),
  definitions: new Map<string, unknown>(),
  addTransport: vi.fn<(transport: Transport) => void>(),
  send: vi.fn(async (_request: { data: Uint8Array }) => ({ data: [new Uint8Array([7])] }))
}))
vi.mock('~system/EngineApi', () => ({ crdtSendToRenderer: host.send }))
vi.mock('@dcl/sdk/ecs', () => ({
  Schemas: { String: 'string' },
  engine: {
    getComponentOrNull: (name: string) => host.definitions.get(name) ?? null,
    defineComponent: (name: string) => {
      if (host.sealed) throw new Error('Engine is already sealed')
      const values = name === 'editor::UiTheme' ? host.config : host.bindings
      const component = {
        componentId: name === 'editor::UiTheme' ? 3000 : 3001,
        createOrReplace: (entity: number, value: Record<string, string>) => values.set(entity, value),
        getOrNull: (entity: number) => values.get(entity), has: (entity: number) => values.has(entity),
        deleteFrom: (entity: number) => values.delete(entity)
      }
      host.definitions.set(name, component)
      return component
    },
    addTransport: host.addTransport,
    getEntitiesWith: () => host.config.entries()
  }
}))

import { bindUiTheme, sceneUiTheme, setUiTheme } from '../../runtime-modules/uiTheme'

describe('theme component lifecycle', () => {
  it('renders after the engine seals, propagates one theme and falls back when it is deleted', () => {
    host.sealed = true
    expect(sceneUiTheme().accent).toEqual({ r: 1, g: 45 / 255, b: 85 / 255, a: 1 })
    setUiTheme(512 as Entity, '#59E0AC', 'Light')
    const hud = sceneUiTheme('#FFC459')
    expect(hud).toEqual(sceneUiTheme())
    expect(hud.panel.r).toBeGreaterThan(0.9)
    setUiTheme(512 as Entity, '#0000FF', 'Dark')
    expect(sceneUiTheme().accent).toEqual({ r: 0, g: 0, b: 1, a: 1 })
    host.config.delete(512)
    expect(sceneUiTheme('#FFFFFF').accent).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  it('sends only preview metadata to the renderer and passes returned engine events back to the SDK', async () => {
    bindUiTheme(600 as Entity, { text: { token: 'text', fallbackAccent: '#FF2D55' } })
    bindUiTheme(601 as Entity, { background: { token: 'panel', fallbackAccent: '#FF2D55' } })
    expect(host.addTransport).toHaveBeenCalledOnce()
    const transport = host.addTransport.mock.calls[0][0]
    const message = (componentId: number) => ({ type: 1 as const, entityId: 600 as Entity, componentId, timestamp: 1 })
    expect(transport.filter(message(3001))).toBe(true)
    expect(transport.filter(message(3000))).toBe(false)
    expect(transport.filter(message(1))).toBe(false)
    transport.onmessage = vi.fn()
    await transport.send(new Uint8Array())
    expect(host.send).not.toHaveBeenCalled()
    await transport.send(new Uint8Array([1, 2, 3]))
    expect(transport.onmessage).toHaveBeenCalledWith(new Uint8Array([7]))
    bindUiTheme(600 as Entity, {})
    expect(host.bindings.has(600)).toBe(false)
  })
})
