import { expect, it, vi } from 'vitest'
import { context } from 'esbuild-wasm'
import { readFileSync } from 'node:fs'
import { SceneBuildSession } from './scene-build'
import type { SdkSnapshot } from './snapshot'

vi.mock('./composite', () => ({
  isEditorScene: () => false,
  readComposites: () => ({ diagnostics: [], scripts: new Map(), compositeLines: [], maxCompositeEntity: 512 })
}))

it('bundles SDK script utilities containing type-only imports and declarations', async () => {
  const snapshot: SdkSnapshot = {
    files: {},
    meta: {
      sdkVersion: 'test', sdkCommandsVersion: 'test', inspectorVersion: 'test', esbuildVersion: 'test',
      aliases: {}, provided: {}, placeholders: { entrypoint: 'ENTRY', scriptImports: 'IMPORTS', scriptsArray: 'SCRIPTS' },
      entrypoint: { scene: "export { run } from '~sdk/script-utils'", editorScene: '' },
      scriptUtils: "import type { Entity } from '@dcl/ecs'; declare global { var marker: Entity }; export function run(value: Entity) { return value }"
    }
  }
  let release = async () => {}
  const session = new SceneBuildSession({ context: async (options) => {
    const build = await context(options)
    release = () => build.dispose()
    return build
  } }, snapshot)
  const encode = (value: string) => new TextEncoder().encode(value)
  try {
    const result = await session.build(new Map([
      ['scene.json', encode('{"main":"bin/index.js","runtimeVersion":"7"}')],
      ['tsconfig.json', encode('{}')], ['src/index.ts', encode('export function main() {}')]
    ]), {})
    expect(result.failure, JSON.stringify(result.diagnostics)).toBeUndefined()
    expect(result.bundleFile).toBe('bin/index.js')
    expect(result.outputs.get('bin/index.js')?.length).toBeGreaterThan(0)
  } finally { await release() }
})

it('builds an older Blank scene whose asset-packs stub predates the events entry point', async () => {
  const snapshot: SdkSnapshot = {
    files: {},
    meta: {
      sdkVersion: 'test', sdkCommandsVersion: 'test', inspectorVersion: 'test', esbuildVersion: 'test',
      aliases: {}, provided: {}, placeholders: { entrypoint: 'ENTRY', scriptImports: 'IMPORTS', scriptsArray: 'SCRIPTS' },
      entrypoint: { scene: "export { run } from '~sdk/script-utils'", editorScene: '' },
      scriptUtils: "import { getActionEvents } from '@dcl/asset-packs/dist/events'; export function run() { return getActionEvents(512) }"
    }
  }
  const encode = (value: string) => new TextEncoder().encode(value)
  const files = new Map([
    ['scene.json', encode('{"main":"bin/index.js","runtimeVersion":"7"}')],
    ['tsconfig.json', encode('{}')], ['src/index.ts', encode('export function main() {}')],
    ['package.json', encode('{"dependencies":{"@dcl/asset-packs":"file:./vendor/asset-packs-stub"}}')]
  ])
  for (const file of ['package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/scene-entrypoint.js']) {
    const path = `vendor/asset-packs-stub/${file}`
    files.set(path, readFileSync(new URL(`../../desktop/templates/blank/${path}`, import.meta.url)))
  }
  let release = async () => {}
  const session = new SceneBuildSession({ context: async (options) => {
    const build = await context(options)
    release = () => build.dispose()
    return build
  } }, snapshot)
  try {
    const result = await session.build(files, {})
    expect(result.failure, JSON.stringify(result.diagnostics)).toBeUndefined()
    expect(result.outputs.get('bin/index.js')?.length).toBeGreaterThan(0)
  } finally { await release() }
})
