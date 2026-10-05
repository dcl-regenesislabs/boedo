import { describe, expect, it, vi } from 'vitest'
import type { BrowserToolName } from '@dcl-editor/contract'
import { createBrowserTools, sameBytes } from './tools'

function setup() {
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>([['src/scripts/Door.ts', encoder.encode('original')], ['.env.local', encoder.encode('secret')]])
  const scene = vi.fn(async () => ({ attached: ['src/scripts/Door.ts'] }))
  const written = vi.fn(async (_path: string, _content: string, created: boolean) => (created ? { id: '512', name: 'Door' } : null))
  const execute = createBrowserTools({
    files: () => files,
    write: async (path, bytes, expected, signal) => {
      signal.throwIfAborted()
      if (!sameBytes(files.get(path), expected)) throw new Error('This file changed.')
      files.set(path, bytes)
    },
    scene,
    written,
    build: async () => ({ ok: true, diagnostics: [] })
  })
  const run = (tool: BrowserToolName, args: Record<string, unknown> = {}, signal = new AbortController().signal) =>
    execute({ kind: 'call', turnId: 'turn', callId: crypto.randomUUID(), tool, args }, signal)
  return { files, run, encoder, scene, written }
}

describe('assistant browser tools', () => {
  it('rejects an edit when the creator changed the file after the read', async () => {
    const { run, files, encoder } = setup()
    const { revision } = JSON.parse(await run('read_file', { path: 'src/scripts/Door.ts' }))
    files.set('src/scripts/Door.ts', encoder.encode('creator edit'))
    await expect(run('write_file', { path: 'src/scripts/Door.ts', revision, content: 'assistant edit' })).rejects.toThrow('changed')
    expect(new TextDecoder().decode(files.get('src/scripts/Door.ts'))).toBe('creator edit')
    const fresh = JSON.parse(await run('read_file', { path: 'src/scripts/Door.ts' }))
    await run('write_file', { path: 'src/scripts/Door.ts', revision: fresh.revision, content: 'merged edit' })
    expect(new TextDecoder().decode(files.get('src/scripts/Door.ts'))).toBe('merged edit')
  })

  it('creates files without replacing existing files and requires a read before overwriting', async () => {
    const { run } = setup()
    await expect(run('write_file', { path: 'src/scripts/Door.ts', revision: null, content: 'replacement' })).rejects.toThrow('changed')
    await expect(run('write_file', { path: 'src/scripts/Door.ts', revision: 'invented', content: '' })).rejects.toThrow('Read')
    await expect(run('write_file', { path: 'src/scripts/New.ts', revision: null, content: 'new' })).resolves.toContain('"created":true')
  })

  it('tells the model where a newly created script was attached as soon as it is written', async () => {
    const { run, written } = setup()
    expect(JSON.parse(await run('write_file', { path: 'src/scripts/Lamp.ts', revision: null, content: 'v1' }))).toMatchObject({ attached: { id: '512', name: 'Door' } })
    expect(written).toHaveBeenCalledWith('src/scripts/Lamp.ts', 'v1', true)
  })

  it('does not expose secrets, traversal, generated runtime, or direct composite writes', async () => {
    const { run } = setup()
    expect(JSON.parse(await run('list_files'))).toEqual(['src/scripts/Door.ts'])
    for (const path of ['.env', '.env.local', 'src/.env.production', '../secret.ts', '/root.ts', 'src\\secret.ts', '.auth.json']) {
      await expect(run('read_file', { path })).rejects.toThrow('path')
    }
    for (const path of ['main.composite', 'assets/scene/main.composite', 'src/scripts/runtime/game.ts']) {
      await expect(run('write_file', { path, revision: null, content: '' })).rejects.toThrow()
    }
  })

  it('cancels before a scene action and returns build results from the browser', async () => {
    const { run, scene } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(run('scene_request', { request: { type: 'inspect' } }, controller.signal)).rejects.toThrow()
    expect(scene).not.toHaveBeenCalled()
    expect(JSON.parse(await run('build'))).toEqual({ ok: true, diagnostics: [] })
  })

  it('takes a scene request the model sent as JSON text', async () => {
    const { run, scene } = setup()
    await run('scene_request', { request: '{"type":"inspect"}' })
    expect(scene).toHaveBeenCalledWith({ type: 'inspect' }, expect.anything())
  })
})
