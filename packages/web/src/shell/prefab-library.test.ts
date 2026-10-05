import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { sri, writePrefabCatalog } from '../../scripts/prefab-catalog.mjs'
import { memoryProfile } from '../store/memory-backend'
import { ProjectStore } from '../store/project-store'
import { createBuiltinPrefabs } from './builtin-prefabs'
import { type ProjectFiles, createPrefabLibrary } from './prefab-library'

const BUILTINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../desktop/prefabs')
const BASE = 'https://cdn.example/editor/'
const dist = mkdtempSync(path.join(tmpdir(), 'dcl-editor-prefabs-'))
afterAll(() => rmSync(dist, { recursive: true, force: true }))
const catalog = writePrefabCatalog(BUILTINS, dist)
const text = (value: string): Uint8Array => new TextEncoder().encode(value)

// what the browser does with `integrity`: the bytes served must match it
async function load(url: string, integrity: string): Promise<Response> {
  const bytes = readFileSync(path.join(dist, ...decodeURIComponent(url.slice(BASE.length)).split('/')))
  if (sri(bytes) !== integrity) throw new TypeError('Failed to fetch')
  return new Response(bytes)
}

async function openProject() {
  const store = new ProjectStore(memoryProfile())
  const { id } = await store.create('Scene', [['scene.json', text('{}')]])
  const files = await store.readAll(id)
  const project: ProjectFiles = {
    files: () => files,
    write: async (file, bytes) => {
      await store.write(id, file, bytes)
      files.set(file, bytes)
    },
    remove: async (file) => {
      await store.remove(id, file)
      files.delete(file)
    }
  }
  return { store, id, project }
}

describe('the built-in prefabs on the web', () => {
  const library = createPrefabLibrary({ builtin: createBuiltinPrefabs(BASE, catalog.integrity, load), user: () => null })

  it('lists a built-in and copies it into the project store once', async () => {
    const listed = await library.list()
    const health = listed.find((entry) => entry.ref === 'builtin:health-respawn')
    expect(health).toMatchObject({ scope: 'builtin', thumbnail: expect.stringMatching(/^data:image\/png;base64,/) })
    expect(JSON.parse(health?.data ?? '{}')).toMatchObject({ name: 'Health & Respawn' })

    const { store, id, project } = await openProject()
    expect(await library.copyIn('builtin:health-respawn', project)).toEqual({ folder: 'custom/health_respawn', name: 'Health & Respawn', reused: false })
    expect(await store.paths(id)).toEqual(
      expect.arrayContaining(['custom/health_respawn/data.json', 'custom/health_respawn/composite.json', 'custom/health_respawn/scripts/pure/health.ts'])
    )
    const script = new TextDecoder().decode(await store.read(id, 'custom/health_respawn/scripts/health.ts'))
    expect(script).toContain("from '../../../src/scripts/runtime/game'")

    expect(await library.copyIn('builtin:health-respawn', project)).toEqual({ folder: 'custom/health_respawn', name: 'Health & Respawn', reused: true })
  })

  it("refuses a built-in file that is not the one this editor shipped", async () => {
    const tampered = createPrefabLibrary({
      builtin: createBuiltinPrefabs(BASE, catalog.integrity, async (url, integrity) =>
        url.endsWith('.ts') ? Promise.reject(new TypeError('Failed to fetch')) : load(url, integrity)
      ),
      user: () => null
    })
    const { store, id, project } = await openProject()
    await expect(tampered.copyIn('builtin:health-respawn', project)).rejects.toThrow()
    expect(await store.paths(id)).toEqual(['scene.json'])
  })

  it('updates a copy in place: keeps what the creator added, drops what the last master shipped', async () => {
    const { store, id, project } = await openProject()
    const { folder } = (await library.copyIn('builtin:trigger-zone', project)) ?? { folder: '' }
    await project.write(`${folder}/notes.md`, text('mine'))
    await project.write(`${folder}/scripts/retired.ts`, text('old'))
    await project.write(`${folder}/.origin-hashes.json`, text(JSON.stringify({ 'data.json': 'x', 'scripts/retired.ts': 'y' })))

    expect(await library.updateCopy('builtin:trigger-zone', project)).toBe(folder)
    const paths = await store.paths(id)
    expect(paths).toContain(`${folder}/notes.md`)
    expect(paths).not.toContain(`${folder}/scripts/retired.ts`)
  })
})
