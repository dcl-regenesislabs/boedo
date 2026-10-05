import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSnapshot, installChain } from '../scripts/make-sdk-snapshot.mjs'
import { mountProject } from './project-vfs'
import { type ImportKind, Resolver } from './resolver'
import type { SdkSnapshot } from './snapshot'
import { Vfs } from './vfs'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('resolving a scene against the SDK snapshot', () => {
  let snapshot: SdkSnapshot
  beforeAll(async () => {
    snapshot = (await buildSnapshot()).snapshot
  })

  const project = (packageJson: object): Map<string, Uint8Array> =>
    new Map([
      ['package.json', bytes(JSON.stringify(packageJson))],
      ['tsconfig.json', bytes('{ "extends": "@dcl/sdk/types/tsconfig.ecs7.json", "compilerOptions": { "baseUrl": "." } }')],
      ['src/index.ts', bytes('export {}')],
      ['src/util.ts', bytes('export {}')],
      ['vendor/asset-packs-stub/package.json', bytes('{ "name": "@dcl/asset-packs", "main": "dist/index.js" }')],
      ['vendor/asset-packs-stub/dist/index.js', bytes('')],
      ['vendor/asset-packs-stub/dist/scene-entrypoint.js', bytes('')]
    ])
  const sdk = '/scene/node_modules/@dcl/sdk'

  it('finds everything the generated entry point and the SDK itself import', () => {
    const { resolver } = mountProject(snapshot, project({ dependencies: { '@dcl/asset-packs': 'file:./vendor/asset-packs-stub' } }))
    const cases: [specifier: string, fromDir: string, kind: ImportKind, expected: string][] = [
      ['./util', '/scene/src', 'import', '/scene/src/util.ts'],
      ['src/util', '/scene/src', 'import', '/scene/src/util.ts'],
      ['@dcl/sdk', '/scene/src', 'import', `${sdk}/index.js`],
      ['@dcl/sdk/ecs', '/scene/src', 'import', `${sdk}/ecs.js`],
      ['@dcl/sdk/react-ecs', '/scene/src', 'import', `${sdk}/react-ecs.js`],
      ['@dcl/ecs/dist-cjs/engine/entity', '/scene', 'require', `${sdk}/node_modules/@dcl/ecs/dist-cjs/engine/entity.js`],
      ['protobufjs/minimal', `${sdk}/node_modules/@dcl/ecs/dist/serialization`, 'import', `${sdk}/node_modules/protobufjs/minimal.js`],
      ['react', `${sdk}/node_modules/@dcl/react-ecs/dist`, 'import', '/scene/node_modules/react/index.js'],
      ['@dcl/asset-packs', '/scene', 'require', '/scene/vendor/asset-packs-stub/dist/index.js'],
      ['@dcl/asset-packs/dist/scene-entrypoint', '/scene/src', 'import', '/scene/vendor/asset-packs-stub/dist/scene-entrypoint.js']
    ]
    for (const [specifier, fromDir, kind, expected] of cases) {
      expect(resolver.resolve(specifier, fromDir, kind), specifier).toMatchObject({ kind: 'file', path: expected })
    }
  })

  it('reads the emit options through the tsconfig the scene extends', () => {
    const { tsconfig } = mountProject(snapshot, project({}))
    expect(tsconfig.compilerOptions).toMatchObject({ jsx: 'react', jsxFactory: 'ReactEcs.createElement', useDefineForClassFields: false })
    expect(tsconfig.paths?.baseUrl).toBe('/scene')
  })

  it('falls back to the no-op asset-packs when the project ships none', () => {
    const { resolver, ownAssetPacks } = mountProject(snapshot, project({}))
    expect(ownAssetPacks).toBe(false)
    expect(resolver.resolve('@dcl/asset-packs', '/scene', 'require')).toMatchObject({
      kind: 'file',
      path: '/scene/node_modules/@dcl/asset-packs/dist/index.js'
    })
  })
})

describe('mapping installed files into the snapshot', () => {
  it('walks node_modules nesting with the host separator', () => {
    const repo = 'D:\\a\\editor\\node_modules'
    expect(installChain(`${repo}\\@dcl\\sdk\\node_modules\\@dcl\\ecs\\dist\\index.js`, path.win32)).toEqual({
      dirs: [`${repo}\\@dcl\\sdk`, `${repo}\\@dcl\\sdk\\node_modules\\@dcl\\ecs`],
      inner: 'dist/index.js'
    })
    expect(installChain('/r/node_modules/atom.js/node_modules/react/cjs/react.js', path.posix)).toEqual({
      dirs: ['/r/node_modules/atom.js', '/r/node_modules/atom.js/node_modules/react'],
      inner: 'cjs/react.js'
    })
  })
})

describe('package.json entry rules', () => {
  const vfs = new Vfs()
  const pkg = (name: string, json: object, files: string[]): void => {
    vfs.set(`/app/node_modules/${name}/package.json`, JSON.stringify(json))
    for (const file of files) vfs.set(`/app/node_modules/${name}/${file}`, '')
  }
  pkg('plain', { main: './lib/entry' }, ['lib/entry.js', 'other.js'])
  pkg('dual', { main: 'cjs.js', module: 'esm.js', sideEffects: false }, ['cjs.js', 'esm.js'])
  pkg('browser-entry', { main: 'node.js', browser: 'web.js' }, ['node.js', 'web.js'])
  pkg('browser-map', { main: 'index.js', browser: { fs: false, './node-only.js': './web-only.js' } }, [
    'index.js',
    'node-only.js',
    'web-only.js'
  ])
  pkg(
    'modern',
    {
      main: 'legacy.js',
      exports: {
        '.': { browser: './browser.js', import: './esm.js', require: './cjs.js' },
        './feature/*': { default: './features/*.js' },
        './internal/*': null
      }
    },
    ['legacy.js', 'browser.js', 'esm.js', 'cjs.js', 'features/a.js', 'internal/x.js', 'hidden.js']
  )
  pkg('conditional', { exports: { import: './esm.js', require: './cjs.js' } }, ['esm.js', 'cjs.js'])
  vfs.set('/app/src/index.ts', '')
  vfs.set('/app/src/dir/index.tsx', '')
  vfs.set('/app/src/written-as-js.ts', '')
  const resolver = new Resolver({ vfs, tsconfig: { paths: { '~lib/*': ['src/dir/*'] }, pathsBase: '/app' } })
  const at = (specifier: string, kind: ImportKind = 'import', fromDir = '/app/src'): string => {
    const found = resolver.resolve(specifier, fromDir, kind)
    return found.kind === 'missing' ? 'missing' : `${found.kind}:${found.path.replace('/app/node_modules/', '')}`
  }

  it('picks the file the native bundler would for a browser build', () => {
    expect({
      main: at('plain'),
      subpath: at('plain/other'),
      'module for import': at('dual'),
      'main for require': at('dual', 'require'),
      'browser entry': at('browser-entry'),
      'browser map remap': at('browser-map/node-only'),
      'browser map false': at('fs', 'import', '/app/node_modules/browser-map'),
      'exports browser condition': at('modern'),
      'exports pattern': at('modern/feature/a'),
      'exports null target': at('modern/internal/x'),
      'not exported': at('modern/hidden.js'),
      'exports import condition': at('conditional'),
      'exports require condition': at('conditional', 'require'),
      'directory index': at('./dir'),
      '.js written for a .ts file': at('./written-as-js.js'),
      'tsconfig paths': at('~lib/index'),
      unknown: at('nowhere')
    }).toEqual({
      main: 'file:plain/lib/entry.js',
      subpath: 'file:plain/other.js',
      'module for import': 'file:dual/esm.js',
      'main for require': 'file:dual/cjs.js',
      'browser entry': 'file:browser-entry/web.js',
      'browser map remap': 'file:browser-map/web-only.js',
      'browser map false': 'disabled:fs',
      'exports browser condition': 'file:modern/browser.js',
      'exports pattern': 'file:modern/features/a.js',
      'exports null target': 'missing',
      'not exported': 'missing',
      'exports import condition': 'file:conditional/esm.js',
      'exports require condition': 'file:conditional/cjs.js',
      'directory index': 'file:/app/src/dir/index.tsx',
      '.js written for a .ts file': 'file:/app/src/written-as-js.ts',
      'tsconfig paths': 'file:/app/src/dir/index.tsx',
      unknown: 'missing'
    })
  })

  it('reports a package that declares itself free of side effects', () => {
    expect(resolver.resolve('dual', '/app/src', 'import')).toMatchObject({ sideEffects: false })
    expect(resolver.resolve('plain', '/app/src', 'import')).toMatchObject({ sideEffects: true })
  })
})
