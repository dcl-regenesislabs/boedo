import { afterEach, expect, it, vi } from 'vitest'
import type { AiEvent, AssistantClientMessage } from '@dcl-editor/contract'
import { ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX } from '@dcl-editor/contract'
import { createBrowserAssistant } from './client'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: AssistantClientMessage[] = []
  constructor(readonly url: URL, readonly protocols: string[]) {
    Socket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = Socket.OPEN
      this.onopen?.()
      this.receive({ kind: 'ready', providers: [] })
    })
  }
  send(raw: string) { this.sent.push(JSON.parse(raw) as AssistantClientMessage) }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }) }
  close() { this.readyState = 3; this.onclose?.() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}

function setup(fetch = async () => new Response(JSON.stringify({ token: 'test-ticket' }))) {
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('location', new URL('http://editor.test'))
  let projectId = 'first'
  const scene = vi.fn(async (_request: unknown, _signal: AbortSignal): Promise<unknown> => ({ id: '512' }))
  const assistant = createBrowserAssistant({
    service: 'http://service.test', fetch, wallet: () => 'wallet',
    project: () => ({ id: projectId, tools: {
      files: () => new Map(), write: async () => {}, scene, build: async () => ({ ok: true })
    } })
  })
  const events: AiEvent[] = []
  assistant.shell.onAiEvent((event) => events.push(event))
  return { assistant, events, scene, switchProject() { projectId = 'second' } }
}

afterEach(() => { Socket.instances = []; vi.unstubAllGlobals() })

it('runs each tool call once and refuses requests after the browser project changes', async () => {
  const { assistant, scene, switchProject } = setup()
  try {
    const { turnId } = await assistant.shell.aiSend({ provider: 'claude', text: 'Make a door' })
    const ws = Socket.instances[0]
    expect(ws.protocols).toEqual([ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX + 'test-ticket'])
    expect(ws.url.search).toBe('')
    const call = { kind: 'call', turnId, callId: 'call-1', tool: 'scene_request', args: { request: { type: 'createEntity', name: 'Door' } } }
    ws.receive({ ...call, turnId: 'another-turn' })
    ws.receive(call)
    ws.receive(call)
    await vi.waitFor(() => expect(ws.sent.some((message) => message.kind === 'result' && message.ok)).toBe(true))
    expect(scene).toHaveBeenCalledTimes(1)
    switchProject()
    ws.receive({ ...call, callId: 'call-2' })
    await vi.waitFor(() => expect(ws.sent).toContainEqual(expect.objectContaining({ kind: 'result', callId: 'call-2', ok: false })))
    expect(scene).toHaveBeenCalledTimes(1)
  } finally { assistant.dispose() }
})

it('cancels queued tools, drains an in-flight action, and ignores messages from the old connection', async () => {
  const { assistant, scene, events } = setup()
  const action = deferred<void>()
  scene.mockImplementation(async () => { await action.promise; return { id: '512' } })
  try {
    const { turnId } = await assistant.shell.aiSend({ provider: 'claude', text: 'Make a door' })
    const old = Socket.instances[0]
    const call = { kind: 'call', turnId, callId: 'call-1', tool: 'scene_request', args: { request: { type: 'createEntity', name: 'Door' } } }
    old.receive(call)
    old.receive({ ...call, callId: 'call-2' })
    await vi.waitFor(() => expect(scene).toHaveBeenCalledTimes(1))
    let drained = false
    const reset = assistant.reset().then(() => { drained = true })
    expect(scene.mock.calls[0][1].aborted).toBe(true)
    await Promise.resolve()
    expect(drained).toBe(false)
    action.resolve()
    await reset
    expect(scene).toHaveBeenCalledTimes(1)
    expect(old.sent.some((message) => message.kind === 'result')).toBe(false)
    const next = await assistant.shell.aiSend({ provider: 'claude', text: 'Try again' })
    old.receive({ kind: 'failure', message: 'Old connection failure' })
    expect(events.some((event) => event.kind === 'done' && event.turnId === next.turnId)).toBe(false)
  } finally { action.resolve(); assistant.dispose() }
})

it('does not open a socket when a pending signed connection request is cancelled', async () => {
  const ticket = deferred<Response>()
  const { assistant, events } = setup(() => ticket.promise)
  const sending = assistant.shell.aiSend({ provider: 'claude', text: 'Make a door' })
  await assistant.reset()
  ticket.resolve(new Response(JSON.stringify({ token: 'late-ticket' })))
  const { turnId } = await sending
  expect(Socket.instances).toHaveLength(0)
  expect(events).toContainEqual({ kind: 'done', turnId, ok: false })
  assistant.dispose()
})
