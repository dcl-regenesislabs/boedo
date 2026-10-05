import { describe, expect, it } from 'vitest'
import { buildPreviewEntity, publishableFiles } from './preview-entity'
import { contentVersion, decodePreviewId, previewContentId, previewEntityId } from './preview-ids'

// How the engine takes a local scene's content id apart (crates/ipfs b64_split_at_key):
// the project root and machine id either side of "/<content key>".
function engineSplit(hash: string, key: string): [projectRoot: string, machineId: string] | null {
  if (!hash.startsWith('b64-')) return null
  const decoded = Buffer.from(hash.slice(4), 'base64').toString('utf8')
  const normalized = decoded.replace(/\\/g, '/').toLowerCase()
  const versioned = normalized.lastIndexOf(`/${key}\u0000`)
  if (versioned !== -1) {
    const rest = decoded.slice(versioned + key.length + 2)
    const dash = rest.indexOf('-')
    return dash === -1 ? null : [decoded.slice(0, versioned), rest.slice(dash + 1)]
  }
  const marker = `/${key}-`
  const plain = normalized.lastIndexOf(marker)
  return plain === -1 ? null : [decoded.slice(0, plain), decoded.slice(plain + marker.length)]
}

describe('preview ids', () => {
  it('are ids the engine reads as a local scene rooted at the project', async () => {
    const version = await contentVersion(new TextEncoder().encode('glb bytes'))
    expect(version).toMatch(/^\d+$/)
    const hash = previewContentId('my-scene', 'Models/Tree.glb', version)
    expect(engineSplit(hash, 'models/tree.glb')).toEqual(['/preview/my-scene', 'web'])
    expect(decodePreviewId(hash)).toEqual({ projectId: 'my-scene', file: 'Models/Tree.glb', version, machineId: 'web' })
    expect(engineSplit(previewContentId('my-scene', 'a.glb', version, 'u_1f3a'), 'a.glb')).toEqual(['/preview/my-scene', 'u_1f3a'])
  })

  it('keep the entity id stable and change a content id only with its bytes', async () => {
    const [a, b] = await Promise.all(['one', 'two'].map((text) => contentVersion(new TextEncoder().encode(text))))
    expect(previewEntityId('my-scene')).toBe('b64-' + Buffer.from('/preview/my-scene-web').toString('base64'))
    expect(decodePreviewId(previewEntityId('my-scene', 'u_1f3a'))).toEqual({
      projectId: 'my-scene',
      file: '',
      version: undefined,
      machineId: 'u_1f3a'
    })
    expect(previewContentId('my-scene', 'bin/index.js', a)).not.toBe(previewContentId('my-scene', 'bin/index.js', b))
    expect(() => previewEntityId('Not Valid')).toThrow()
    expect(() => previewEntityId('my-scene', 'has-dash')).toThrow()
  })
})

describe('preview entity', () => {
  const sceneJson = { main: 'bin/index.js', scene: { base: '0,0', parcels: ['0,0', '0,1'] } }

  it('lists what the scene deploys, as the engine expects it from entities/active', () => {
    const project = [
      'scene.json',
      'package.json',
      'tsconfig.json',
      '.dclignore',
      'src/index.ts',
      'src/ui.tsx',
      'bin/index.js',
      'main.crdt',
      'Assets/Scene/Models/Tree.glb',
      'assets/scene/main.composite',
      'vendor/asset-packs-stub/dist/index.js',
      'node_modules/pkg/index.js',
      'notes.md'
    ]
    const files = publishableFiles(project, 'vendor\n').map((path) => ({ path, version: '7' }))
    const entity = buildPreviewEntity({ projectId: 'my-scene', sceneJson, files, timestamp: 1234, sdkVersion: '7.25.1' })
    expect(entity).toMatchObject({
      version: 'v3',
      type: 'scene',
      id: previewEntityId('my-scene'),
      pointers: ['0,0', '0,1'],
      timestamp: 1234,
      metadata: { sdkVersion: '7.25.1', main: 'bin/index.js' }
    })
    expect(entity.content.map((entry) => entry.file).sort()).toEqual([
      'assets/scene/main.composite',
      'assets/scene/models/tree.glb',
      'bin/index.js',
      'main.crdt',
      'scene.json'
    ])
    expect(entity.content.every((entry) => entry.hash.startsWith('b64-'))).toBe(true)
  })

  it('refuses two files that deploy under the same name', () => {
    const files = ['Tree.glb', 'tree.glb'].map((path) => ({ path, version: '1' }))
    expect(() => buildPreviewEntity({ projectId: 'my-scene', sceneJson, files, timestamp: 0 })).toThrow(/tree\.glb/)
  })
})
