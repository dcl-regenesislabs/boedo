import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { seedSetupToken } from './setup-token.ts'

const directories: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-token-'))
  directories.push(dir)
  return join(dir, '.auth.json')
}
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

it('stores an OAuth access token privately, preserves other providers and rotates on restart', async () => {
  const file = await fixture()
  const codex = { type: 'oauth', access: 'test-codex', refresh: 'test-refresh', expires: 10 }
  await writeFile(file, JSON.stringify({ 'openai-codex': codex }))
  await seedSetupToken(file, 'sk-ant-oat-test-first', 100)
  const first = JSON.parse(await readFile(file, 'utf8'))
  expect(first['openai-codex']).toEqual(codex)
  expect(first.anthropic).toMatchObject({ type: 'oauth', access: 'sk-ant-oat-test-first', refresh: '', setupToken: true })
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  await seedSetupToken(file, 'sk-ant-oat-test-first', 200)
  expect(JSON.parse(await readFile(file, 'utf8')).anthropic.expires).toBe(first.anthropic.expires)
  await seedSetupToken(file, 'sk-ant-oat-test-second', 300)
  const rotated = JSON.parse(await readFile(file, 'utf8'))
  expect(rotated.anthropic.access).toBe('sk-ant-oat-test-second')
  expect(rotated['openai-codex']).toEqual(codex)
})

it('refuses other credentials and does not expose them in errors', async () => {
  const file = await fixture()
  await expect(seedSetupToken(file, 'test-api-key')).rejects.toThrow('claude setup-token')
  await expect(readFile(file)).rejects.toThrow()
})

it('preserves a malformed existing credential file for recovery', async () => {
  const file = await fixture()
  await writeFile(file, '{broken')
  await expect(seedSetupToken(file, 'sk-ant-oat-test-token')).rejects.toThrow('OAuth session file')
  expect(await readFile(file, 'utf8')).toBe('{broken')
})
