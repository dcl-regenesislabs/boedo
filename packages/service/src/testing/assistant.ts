import type { AgentFactory } from '../ai/types.ts'

export const assistantFixture: AgentFactory = {
  providers: async () => [{
    id: 'claude', label: 'Test assistant', available: true, models: ['test'], defaultModel: 'test', transport: 'service'
  }],
  async create(_params, call, emit, restore) {
    const prompts = [...(restore ?? [])]
    return {
      async prompt(params) {
        const prefabs = JSON.parse(await call('asset_request', { action: 'search_prefabs', query: 'round' })) as { results: Array<{ name: string }> }
        if (!prefabs.results.some((entry) => entry.name === 'Game Flow')) throw new Error('The browser prefab library was not discoverable')
        const layout = JSON.parse(await call('scene_request', { request: {
          type: 'sceneSettings', parcels: ['0,0', '1,0', '0,1', '1,1'], base: '0,0'
        } })) as { previewReady: boolean }
        if (!layout.previewReady) throw new Error('The preview did not apply the new parcels within the turn')
        const file = JSON.parse(await call('read_file', { path: 'src/index.ts' })) as { content: string; revision: string }
        await call('write_file', {
          path: 'src/index.ts', revision: file.revision,
          content: `// assistant browser round trip\n${file.content}`
        })
        const build = JSON.parse(await call('build', {})) as { ok: boolean }
        if (!build.ok) throw new Error('The browser build failed')
        prompts.push(params.text)
        emit({ text: 'Updated the browser project and verified its build.' })
      },
      abort: async () => {},
      dispose: () => {},
      snapshot: () => [...prompts], takeUsage: () => ({ cost: 0 })
    }
  }
}
