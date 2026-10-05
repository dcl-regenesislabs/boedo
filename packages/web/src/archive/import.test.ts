import { describe, expect, it } from 'vitest'
import { type ImportEntry, planImport } from './import'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const SCENE = JSON.stringify({ runtimeVersion: '7', display: { title: 'Tower' }, scene: { base: '0,0', parcels: ['0,0'] } })

function entries(files: Record<string, string>, opened: string[] = []): ImportEntry[] {
  return Object.entries(files).map(([path, value]) => ({
    path,
    read: async () => {
      opened.push(path)
      return text(value)
    }
  }))
}

describe('project import', () => {
  it('takes a zipped desktop project: sources kept, the rest never opened, what the editor cannot do said', async () => {
    const opened: string[] = []
    const outcome = await planImport(
      'tower.zip',
      entries(
        {
          'tower/scene.json': SCENE,
          'tower/src/index.ts': 'export {}',
          'tower/server/main.ts': 'export {}',
          'tower/package.json': JSON.stringify({
            dependencies: { 'dcl-npc-toolkit': '^1.0.0' },
            devDependencies: { '@dcl/sdk': 'latest', '@dcl/sdk-commands': 'latest', typescript: '^5' }
          }),
          'tower/node_modules/dep/index.js': 'x',
          'tower/bin/index.js': 'x',
          'tower/.git/HEAD': 'x',
          'tower/.env': 'SECRET=1',
          '__MACOSX/tower/._scene.json': 'x'
        },
        opened
      )
    )
    if (!outcome.ok) throw new Error(outcome.reason)
    const { plan } = outcome
    expect([...plan.files.keys()].sort()).toEqual(['package.json', 'scene.json', 'server/main.ts', 'src/index.ts'])
    expect(opened.some((path) => /node_modules|\.git|\.env|bin\/|__MACOSX/.test(path))).toBe(false)
    expect(plan).toMatchObject({ title: 'Tower', skipped: 4, needsPackages: { 'dcl-npc-toolkit': '^1.0.0' } })
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toMatch(/server\/ folder/)
  })

  it('refuses a scene past the size limits before inflating anything', async () => {
    const opened: string[] = []
    const huge = entries({ 'scene.json': SCENE, 'assets/a.glb': 'x', 'assets/b.glb': 'x' }, opened).map((entry) =>
      entry.path === 'scene.json' ? entry : { ...entry, size: 300 * 1024 * 1024 }
    )
    expect(await planImport('x', huge)).toMatchObject({ ok: false, reason: /add up to more than 500 MB/ })
    expect(opened).toEqual([])
  })

  it('refuses what is not one scene, and warns about a scene that is not SDK7', async () => {
    expect(await planImport('x', entries({ 'readme.md': 'hi' }))).toMatchObject({ ok: false, reason: /no scene\.json/ })
    expect(await planImport('x', entries({ 'a/scene.json': SCENE, 'b/scene.json': SCENE }))).toMatchObject({ ok: false, reason: /several scenes/ })
    const old = await planImport('old', entries({ 'scene.json': JSON.stringify({ main: 'bin/game.js', scene: { base: '0,0', parcels: ['0,0'] } }) }))
    expect(old).toMatchObject({ ok: true, plan: { title: 'old', warnings: [expect.stringMatching(/not an SDK7 scene/)] } })
  })
})
