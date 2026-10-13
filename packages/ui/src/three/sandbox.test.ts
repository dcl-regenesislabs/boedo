import { describe, expect, it } from 'vitest'
import { lockDown } from './sandbox'

describe('model script sandbox', () => {
  it('removes network and storage globals from the scope and its prototypes', () => {
    class Base { fetch() {} indexedDB = {} }
    Object.defineProperty(Base.prototype, 'caches', { value: {}, configurable: true })
    const scope = Object.assign(new Base(), { WebSocket: class {}, Blob: class {} })
    lockDown(scope)
    const reach = (name: string): unknown => Reflect.get(scope, name) ?? Reflect.get(Object.getPrototypeOf(scope) as object, name)
    expect(['fetch', 'indexedDB', 'caches', 'WebSocket'].map(reach)).toEqual([undefined, undefined, undefined, undefined])
    expect(reach('Blob')).toBeDefined()
  })
})
