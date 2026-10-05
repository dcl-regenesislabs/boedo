import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createPiFactory } from './pi.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function authPath() {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-agent-security-'))
  directories.push(directory)
  return join(directory, '.auth.json')
}

it('creates a browser-only agent with synthetic OAuth credentials without calling a model', async () => {
  const file = await authPath()
  const factory = await createPiFactory(file, undefined, 'sk-ant-oat-synthetic-test-token')
  const providers = await factory.providers()
  const claude = providers.find((provider) => provider.id === 'claude')
  expect(claude?.available).toBe(true)
  expect(providers.find((provider) => provider.id === 'codex')?.available).toBe(false)
  const agent = await factory.create({ provider: 'claude', text: 'Not sent' }, async () => 'unused', () => {})
  await agent.abort()
  agent.dispose()
  const pinned = await createPiFactory(file, claude?.defaultModel)
  const models = await pinned.providers()
  expect(models.find((provider) => provider.id === 'claude')?.models).toEqual([claude?.defaultModel])
  expect(models.find((provider) => provider.id === 'codex')?.models).toEqual([])
})

it('fails closed when the configured model is unknown', async () => {
  await expect(createPiFactory(await authPath(), 'model-that-does-not-exist')).rejects.toThrow('AI_MODEL')
})
