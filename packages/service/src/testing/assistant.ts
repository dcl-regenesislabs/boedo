import type { AgentFactory } from '../ai/types.ts'

export const assistantFixture: AgentFactory = {
  providers: async () => [{
    id: 'claude', label: 'Test assistant', available: true, models: ['test'], defaultModel: 'test', transport: 'service'
  }],
  async create(_params, call, emit) {
    return {
      async prompt() {
        const file = JSON.parse(await call('read_file', { path: 'src/index.ts' })) as { content: string; revision: string }
        await call('write_file', {
          path: 'src/index.ts', revision: file.revision,
          content: `// assistant browser round trip\n${file.content}`
        })
        const build = JSON.parse(await call('build', {})) as { ok: boolean }
        if (!build.ok) throw new Error('The browser build failed')
        emit({ text: 'Updated the browser project and verified its build.' })
      },
      abort: async () => {},
      dispose: () => {}
    }
  }
}
