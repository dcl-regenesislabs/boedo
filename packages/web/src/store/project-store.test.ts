import { describe, expect, it } from 'vitest'
import { memoryProfile as profile } from './memory-backend'
import { ProjectBusyError, ProjectStore } from './project-store'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const read = async (store: ProjectStore, id: string, path: string): Promise<string> =>
  new TextDecoder().decode(await store.read(id, path))

describe('ProjectStore', () => {
  it('keeps a project’s files across tabs', async () => {
    const backend = profile()
    const store = new ProjectStore(backend)
    const { id } = await store.create('My Scene', [
      ['scene.json', text('{}')],
      ['src/index.ts', text('v1')]
    ])
    expect(id).toMatch(/^my-scene-[a-z0-9]{4}$/)
    await store.write(id, 'src/index.ts', text('v2'))
    await store.write(id, 'assets/models/tree.glb', new Uint8Array([0, 255, 7]))
    expect(await store.remove(id, 'scene.json')).toBe(true)
    expect(await store.remove(id, 'scene.json')).toBe(false)

    const later = new ProjectStore(backend)
    expect((await later.list()).map((project) => project.id)).toEqual([id])
    expect(await later.paths(id)).toEqual(['assets/models/tree.glb', 'src/index.ts'])
    expect(await read(later, id, 'src/index.ts')).toBe('v2')
    expect([...(await later.readAll(id)).get('assets/models/tree.glb') ?? []]).toEqual([0, 255, 7])
    // a second project of the same name gets its own id and folder
    expect((await later.create('My scene', [])).id).not.toBe(id)
  })

  it('never keeps packages, build output, git history or env files', async () => {
    const store = new ProjectStore(profile())
    const refused = [
      'node_modules/@dcl/sdk/index.js',
      'vendor/x/node_modules/y.js',
      'bin/index.js',
      '.git/HEAD',
      '.env',
      '.env.local',
      'server/.env.production',
      '.ENV',
      'src/.Env.local',
      '.env.d/key',
      'NODE_MODULES/x.js',
      'src/\u202ereversed.ts',
      '../other/scene.json',
      '/scene.json'
    ]
    const { id } = await store.create('Scene', [['src/bin/keep.ts', text('ok')], ...refused.map((path) => [path, text('secret')] as const)])
    for (const path of refused) await expect(store.write(id, path, text('secret'))).rejects.toThrow()
    expect(await store.paths(id)).toEqual(['src/bin/keep.ts'])
  })

  it('keeps an assistant chat per wallet and drops it with the project', async () => {
    const store = new ProjectStore(profile())
    const { id } = await store.create('Scene', [['scene.json', text('{}')]])
    const other = await store.create('Other', [])
    await store.setTranscript(id, '0xAbC', [{ role: 'user', text: 'Make a door' }])
    await store.setTranscript(other.id, '0xabc', [{ role: 'user', text: 'Elsewhere' }])
    expect(await store.transcript(id, '0xabc')).toEqual([{ role: 'user', text: 'Make a door' }])
    expect(await store.transcript(id, '0xdef')).toBeNull()
    expect(await store.trash(id)).toBe(true)
    await store.purge(Date.now() + 1)
    expect(await store.transcript(id, '0xabc')).toBeNull()
    expect(await store.transcript(other.id, '0xabc')).toEqual([{ role: 'user', text: 'Elsewhere' }])
  })

  it('a deleted project can be restored until the trash is purged', async () => {
    const store = new ProjectStore(profile())
    const { id } = await store.create('Scene', [['scene.json', text('{}')]])
    const before = Date.now()
    expect(await store.trash(id)).toBe(true)
    expect(await store.list()).toEqual([])
    expect((await store.trashed()).map((project) => project.id)).toEqual([id])

    expect(await store.purge(before)).toEqual([])
    expect(await store.restore(id)).toBe(true)
    expect((await store.list()).map((project) => project.id)).toEqual([id])
    expect(await read(store, id, 'scene.json')).toBe('{}')

    await store.patch(id, { previewId: 'p0123' })
    await store.trash(id)
    // the realm its preview and that preview's storage live under, for the caller to drop
    expect(await store.purge(Date.now() + 1)).toEqual([{ id, previewId: 'p0123' }])
    expect(await store.trashed()).toEqual([])
    await expect(store.read(id, 'scene.json')).rejects.toThrow()
  })

  it('lets one tab at a time edit a project', async () => {
    const backend = profile()
    const here = new ProjectStore(backend)
    const there = new ProjectStore(backend)
    const { id } = await here.create('Scene', [['scene.json', text('{}')]])

    expect(await here.open(id)).toBe(true)
    await here.write(id, 'scene.json', text('{"mine":1}'))
    expect(await there.open(id)).toBe(false)
    await expect(there.write(id, 'scene.json', text('{"theirs":1}'))).rejects.toBeInstanceOf(ProjectBusyError)
    expect(await there.trash(id)).toBe(false)
    expect(await read(there, id, 'scene.json')).toBe('{"mine":1}')

    here.close(id)
    expect(await there.open(id)).toBe(true)
  })
})
