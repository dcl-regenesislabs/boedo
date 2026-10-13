import { describe, expect, it, vi } from 'vitest'

const { replies } = vi.hoisted(() => ({ replies: [] as unknown[] }))
vi.mock('@ui/three/client', () => ({
  startThreeWorker: async () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: () => queueMicrotask(() => worker.onmessage?.({ data: replies.shift() })),
      terminate: () => {}
    }
    return worker
  }
}))
import { buildCodeModel } from './code-model'

const built = (extra: Record<string, unknown>) => ({ kind: 'built', glb: new ArrayBuffer(8), clips: [], library: [], ...extra })

describe('a build reply the model script may have forged', () => {
  it('is refused when it names a shared material that is not in the library, or carries an oversized model', async () => {
    replies.push(built({ library: [{ name: 'x/0', png: new ArrayBuffer(4) }] }), built({ glb: new ArrayBuffer(21 * 1024 * 1024) }))
    await expect(buildCodeModel('root.add(x)', new AbortController().signal)).rejects.toThrow(/unknown shared material/)
    await expect(buildCodeModel('root.add(x)', new AbortController().signal)).rejects.toThrow(/over 20 MB/)
  })

  it('passes a well-formed reply through', async () => {
    replies.push(built({ library: [{ name: 'stone', png: new ArrayBuffer(4) }], clips: ['Wag'] }))
    const result = await buildCodeModel('root.add(x)', new AbortController().signal)
    expect(result.library.map((l) => l.name)).toEqual(['stone'])
    expect(result.clips).toEqual(['Wag'])
  })
})
