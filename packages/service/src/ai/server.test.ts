import { once } from 'node:events'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantServerMessage, BrowserToolCall } from '../../../contract/src/assistant.ts'
import { ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX } from '../../../contract/src/assistant.ts'
import { createTestWallet } from '../testing/wallet.ts'
import { createTestService, TEST_ORIGIN } from '../testing/components.ts'
import type { AgentFactory } from './types.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

async function setup(vars?: Record<string, string>) {
  const factory: AgentFactory = {
    providers: async () => [{ id: 'claude', label: 'Test', available: true, models: ['test'], defaultModel: 'test' }],
    create: async (_params, call, emit) => ({
      prompt: async () => { emit({ text: await call('read_file', { path: 'src/index.ts' }) }) },
      abort: async () => {}, dispose: () => {}, snapshot: () => [], takeUsage: () => ({ cost: 0 })
    })
  }
  const program = await createTestService({ agentFactory: factory, vars })
  const { base } = program
  cleanup.push(program.stop)
  const wallet = await createTestWallet({ origin: TEST_ORIGIN })
  const ticket = async () => {
    const response = await wallet.signedFetch(base + '/assistant/connect', { method: 'POST' })
    return (await response.json() as { token: string }).token
  }
  const socket = async (token: string) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/assistant/socket', [ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX + token], { origin: TEST_ORIGIN })
    const ready = once(ws, 'message')
    await once(ws, 'open')
    return { ws, ready }
  }
  return { base, wallet, ticket, socket }
}

describe('assistant connection authorization', () => {
  it('rejects unsigned and scene-signed requests before issuing a ticket', async () => {
    const { base, wallet } = await setup()
    expect((await fetch(base + '/assistant/connect', { method: 'POST' })).status).toBe(401)
    const headers = wallet.headers('POST', base + '/assistant/connect', {
      metadata: { signer: 'decentraland-kernel-scene', intent: 'dcl:editor:projects', origin: TEST_ORIGIN }
    })
    expect((await fetch(base + '/assistant/connect', { method: 'POST', headers })).status).toBe(403)
  })

  it('uses a ticket once and keeps tool results scoped to their connection', async () => {
    const { ticket, socket } = await setup()
    const token = await ticket()
    const one = await socket(token)
    expect(JSON.parse(String((await one.ready)[0])).kind).toBe('ready')
    const second = await socket(await ticket())
    await second.ready
    const calls: unknown[] = []
    one.ws.on('message', (raw) => calls.push(JSON.parse(raw.toString())))
    const requested = new Promise<BrowserToolCall>((resolve) => {
      one.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()) as AssistantServerMessage; if (m.kind === 'call') resolve(m) })
    })
    const finished = new Promise<unknown[]>((resolve) => {
      one.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.event?.kind === 'done') resolve(calls) })
    })
    one.ws.send(JSON.stringify({ kind: 'prompt', turnId: 'turn', projectId: 'project', params: { provider: 'claude', text: 'Read my file' } }))
    const { callId, turnId } = await requested
    const result = { kind: 'result', callId, turnId, ok: true, text: 'own browser file' }
    const pong = once(second.ws, 'pong')
    second.ws.send(JSON.stringify(result))
    second.ws.ping()
    await pong
    expect(JSON.stringify(calls)).not.toContain('own browser file')
    one.ws.send(JSON.stringify({ ...result, text: 'correct browser' }))
    const done = await finished
    expect(JSON.stringify(done)).toContain('correct browser')
    expect(JSON.stringify(done)).not.toContain('own browser file')
    await ticket()
    const reused = new WebSocket(one.ws.url, [ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX + token], { origin: TEST_ORIGIN })
    const [error] = await once(reused, 'error')
    expect(String(error)).toContain('403')
    expect(one.ws.protocol).toBe(ASSISTANT_PROTOCOL)
  })

  it('serves only the listed wallets when ASSISTANT_WALLETS is set', async () => {
    const { base, wallet } = await setup({ ASSISTANT_WALLETS: '0x0000000000000000000000000000000000000001' })
    const response = await wallet.signedFetch(base + '/assistant/connect', { method: 'POST' })
    expect([response.status, await response.json()]).toEqual([403, { error: 'assistant-not-allowed' }])
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/assistant/socket', { origin: TEST_ORIGIN })
    const [error] = await once(socket, 'error')
    expect(String(error)).toContain('403')
  })

  it('refuses tokenless upgrades without consuming a legitimate connection slot', async () => {
    const { base, ticket, socket } = await setup()
    const token = await ticket()
    const attacker = new WebSocket(base.replace('http:', 'ws:') + '/assistant/socket', { origin: TEST_ORIGIN })
    expect(String((await once(attacker, 'error'))[0])).toContain('403')
    const legitimate = await socket(token)
    expect(JSON.parse(String((await legitimate.ready)[0])).kind).toBe('ready')
  })

  it("holds a wallet to a few unused connect tickets, so a few wallets cannot exhaust everyone's", async () => {
    const { base, wallet } = await setup()
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await wallet.signedFetch(base + '/assistant/connect', { method: 'POST' })).status)
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('reserves global capacity before concurrent handshakes', async () => {
    const { base } = await setup()
    const wallets = await Promise.all(Array.from({ length: 11 }, () => createTestWallet({ origin: TEST_ORIGIN })))
    const tokens: string[] = []
    for (const wallet of wallets) for (let i = 0; i < 3; i++) {
      const response = await wallet.signedFetch(base + '/assistant/connect', { method: 'POST' })
      expect(response.status).toBe(200)
      tokens.push((await response.json() as { token: string }).token)
    }
    const outcomes = await Promise.all(tokens.map((token) => new Promise<string>((resolve) => {
      const socket = new WebSocket(base.replace('http:', 'ws:') + '/assistant/socket',
        [ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX + token], { origin: TEST_ORIGIN })
      socket.once('message', (raw) => resolve((JSON.parse(String(raw)) as { kind: string }).kind))
      socket.once('error', (error) => resolve(String(error)))
    })))
    expect(outcomes.filter((value) => value === 'ready')).toHaveLength(32)
    expect(outcomes.filter((value) => value.includes('429'))).toHaveLength(1)
  })

  it('closes an unfinished message made of excessive tiny fragments', async () => {
    const { ticket, socket } = await setup()
    const { ws, ready } = await socket(await ticket())
    await ready
    const closed = once(ws, 'close')
    for (let i = 0; i < 4097; i++) ws.send('x', { fin: false })
    expect((await closed)[0]).toBe(1008)
  })
})
