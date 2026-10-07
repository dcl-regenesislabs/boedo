import { once } from 'node:events'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserToolCall } from '../../contract/src/assistant.ts'
import { ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX } from '../../contract/src/assistant.ts'
import { rawCid } from '../../contract/src/cid.ts'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { initComponents } from './components.ts'
import { createMemoryStore } from './store.ts'
import { createTestService, TEST_ORIGIN } from './testing/components.ts'
import { createTestWallet } from './testing/wallet.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0)) await stop() })

describe('component service', () => {
  it('serves signed storage with its prefix, CORS, binary bodies, health probes and metrics', async () => {
    const { base, origin, stop } = await createTestService()
    cleanup.push(stop)
    const wallet = await createTestWallet({ origin: TEST_ORIGIN })
    for (const path of ['/health/live', '/health/startup', '/health/ready', '/svc/health']) {
      expect((await fetch(origin + path)).status).toBe(200)
    }
    expect((await fetch(base + '/projects')).status).toBe(401)
    expect((await fetch(origin + '/projects')).status).toBe(404)
    expect((await wallet.signedFetch(base + '/assistant/providers')).status).toBe(503)
    const preflight = await fetch(base + '/projects/proof/manifest', {
      method: 'OPTIONS',
      headers: {
        origin: TEST_ORIGIN, 'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,x-identity-timestamp,x-identity-auth-chain-0,x-identity-metadata'
      }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN)
    expect((await fetch(base + '/health', { headers: { origin: 'http://foreign.local' } })).status).toBe(403)

    const bytes = new Uint8Array([0, 255, 31, 128, 10, 13])
    const hash = await rawCid(bytes)
    const uploadRequest = await wallet.signedFetch(base + '/projects/proof/uploads', {
      method: 'POST', body: JSON.stringify({ files: [{ hash, size: bytes.length }] })
    })
    expect(uploadRequest.status).toBe(200)
    const { uploads } = await uploadRequest.json() as { uploads: Array<{ url: string }> }
    expect(uploads[0].url).toContain(base + '/blobs/')
    const upload = await fetch(uploads[0].url, { method: 'PUT', body: bytes })
    expect(upload.status).toBe(201)
    const manifest = await wallet.signedFetch(base + '/projects/proof/manifest', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Proof', baseVersion: null, files: { 'image.png': { hash, size: bytes.length } } })
    })
    expect(manifest.status).toBe(200)
    expect(manifest.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN)
    const downloaded = await wallet.signedFetch(base + '/projects/proof/files/' + hash)
    expect(downloaded.headers.get('content-type')).toBe('application/octet-stream')
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes)
    const metrics = await (await fetch(origin + '/metrics')).text()
    expect(metrics).toContain('handler="/svc/projects/:id/manifest",code="200"')
    expect(metrics).not.toContain('handler="/svc/projects/proof')
    expect(metrics).not.toContain(hash)
  })

  it('refuses to start in production without PUBLIC_URL or a metrics token', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const start = (vars: Record<string, string>) => initComponents({
      store: createMemoryStore(),
      config: createConfigComponent({ ALLOWED_ORIGINS: TEST_ORIGIN, TICKET_SECRET: 'test-secret-test-secret-test-secret', ...vars })
    })
    try {
      await expect(start({ WKC_METRICS_BEARER_TOKEN: 'token' })).rejects.toThrow('PUBLIC_URL')
      await expect(start({ PUBLIC_URL: 'https://service.example' })).rejects.toThrow('WKC_METRICS_BEARER_TOKEN')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    [{ STORAGE_WALLETS: '' }, 'STORAGE_WALLETS'],
    [{ STORAGE_WALLETS: 'not-a-wallet' }, 'STORAGE_WALLETS'],
    [{ PUBLIC_URL: 'http://service.example' }, 'HTTPS'],
    [{ PUBLIC_URL: 'https://service.example/incorrect' }, 'BASE_PATH'],
    [{ ALLOWED_ORIGINS: 'http://editor.example' }, 'HTTPS'],
    [{ AI_AUTH_PATH: '/synthetic-storage/.assistant/.auth.json' }, 'outside STORAGE_DIR']
  ] as const)('rejects unsafe production configuration %j', async (vars, message) => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      await expect(initComponents({ store: createMemoryStore(), config: createConfigComponent({
        ALLOWED_ORIGINS: 'https://editor.example', PUBLIC_URL: 'https://service.example',
        TICKET_SECRET: 'synthetic-test-secret-synthetic-test-secret', WKC_METRICS_BEARER_TOKEN: 'synthetic-metrics',
        STORAGE_WALLETS: '*', ASSISTANT_WALLETS: '0x0000000000000000000000000000000000000001',
        STORAGE_DIR: '/synthetic-storage', ...vars
      }) })).rejects.toThrow(message)
    } finally { vi.unstubAllEnvs() }
  })

  it('refuses to start an assistant in production that no wallet list limits', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      await expect(initComponents({ store: createMemoryStore(), config: createConfigComponent({
        ALLOWED_ORIGINS: 'https://editor.example', PUBLIC_URL: 'https://service.example',
        TICKET_SECRET: 'synthetic-test-secret-synthetic-test-secret', WKC_METRICS_BEARER_TOKEN: 'synthetic-metrics',
        STORAGE_WALLETS: '*', STORAGE_DIR: '/synthetic-storage', AI_AUTH_PATH: '/synthetic-secrets/.auth.json'
      }) })).rejects.toThrow('ASSISTANT_WALLETS must list')
    } finally { vi.unstubAllEnvs() }
  })

  it('stops an active browser tool call and disposes the agent before closing the listener', async () => {
    const abort = vi.fn(async () => {})
    const dispose = vi.fn()
    const program = await createTestService({
      agentFactory: {
        providers: async () => [],
        create: async (_params, call) => ({
          prompt: async () => { await call('read_file', { path: 'src/index.ts' }) },
          abort, dispose, snapshot: () => [], takeUsage: () => ({ cost: 0 })
        })
      }
    })
    let stopped = false
    cleanup.push(async () => { if (!stopped) await program.stop() })
    const wallet = await createTestWallet({ origin: TEST_ORIGIN })
    const { token } = await (await wallet.signedFetch(program.base + '/assistant/connect', { method: 'POST' })).json() as { token: string }
    const ws = new WebSocket(program.base.replace('http:', 'ws:') + '/assistant/socket', [ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX + token], { origin: TEST_ORIGIN })
    const ready = once(ws, 'message')
    await once(ws, 'open')
    await ready
    const requested = new Promise<BrowserToolCall>((resolve) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as BrowserToolCall
        if (message.kind === 'call') resolve(message)
      })
    })
    ws.send(JSON.stringify({ kind: 'prompt', turnId: 'turn', projectId: 'proof', params: { provider: 'claude', text: 'Read' } }))
    await requested
    const closed = once(ws, 'close')
    await program.stop()
    stopped = true
    await closed
    expect(abort).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(program.server.listening).toBe(false)
  })
})
