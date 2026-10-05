import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { object } from '../../../contract/src/assistant.ts'

export async function seedSetupToken(path: string, value: string, now = Date.now()): Promise<void> {
  const token = value.trim()
  if (!/^sk-ant-oat[\w-]+$/.test(token)) throw new Error('ANTHROPIC_OAUTH_SETUP_TOKEN must contain a token from claude setup-token.')
  let saved: unknown = {}
  try {
    saved = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (!object(error) || error.code !== 'ENOENT') throw new Error('Could not load the assistant OAuth session file.')
  }
  if (!object(saved)) throw new Error('Invalid assistant OAuth session file.')
  const current = saved.anthropic
  if (object(current) && current.type === 'oauth' && current.access === token && current.setupToken === true) return
  saved.anthropic = {
    type: 'oauth', access: token, refresh: '',
    // A setup token is an access token; exchanging it as a refresh token fails.
    expires: now + 365 * 24 * 60 * 60_000, setupToken: true
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(saved), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
